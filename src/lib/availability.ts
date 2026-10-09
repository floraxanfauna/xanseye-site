import { getDb, isOverlapError, type Q } from "./db";
import { AppError, audit } from "./core";
import { getSettings } from "./settings";
import { planSlots, SlotPlanError, type PlannedSlot } from "./slots";
import { localDate, localDayRange, isValidDate, zonedToUtc, NonexistentLocalTime, AmbiguousLocalTime } from "./time";
import { getBusy, overlapsBusy } from "./google/busy";
import { getSeason } from "./seasons";

export interface PublicSlot { id: string; startsAt: string; endsAt: string; date: string }

export interface PublicAvailability {
  paused: boolean;
  seasonId: string;
  slots: PublicSlot[];
  /** date -> number of open times; only dates/counts/times, never client info. */
  dates: Record<string, number>;
  /** "ok" | "unchecked" (no Google connected) | "error" (could not verify external calendar) */
  externalCheck: "ok" | "unchecked" | "error";
}

/**
 * What the public may book: explicitly published + future + inside booking rules + not held/booked
 * + not in conflict with owner-selected Google calendars. Free calendar time is never auto-published.
 */
export async function getPublicAvailability(seasonId: string, now = new Date()): Promise<PublicAvailability> {
  const db = await getDb();
  const settings = await getSettings();
  if (settings.paused) return { paused: true, seasonId, slots: [], dates: {}, externalCheck: "ok" };
  const from = new Date(now.getTime() + settings.minNoticeHours * 3600_000);
  const to = new Date(now.getTime() + settings.horizonDays * 86400_000);
  const r = await db.query(
    `select s.id, s.starts_at, s.ends_at from slots s
      where s.season_id = $1 and s.state = 'open' and s.starts_at >= $2 and s.starts_at <= $3
        and not exists (select 1 from bookings b where b.status in ('hold','confirmed')
                         and tstzrange(b.starts_at, b.buffer_end) && tstzrange(s.starts_at, s.buffer_end))
      order by s.starts_at`,
    [seasonId, from, to],
  );

  // max sessions per day (counts holds + confirmed across every season)
  const booked = await db.query(`select starts_at from bookings where status in ('hold','confirmed') and starts_at >= $1 and starts_at <= $2`, [from, to]);
  const perDay = new Map<string, number>();
  for (const b of booked.rows) { const d = localDate(b.starts_at, settings.timezone); perDay.set(d, (perDay.get(d) ?? 0) + 1); }

  let externalCheck: PublicAvailability["externalCheck"] = "unchecked";
  let busy: { s: Date; e: Date }[] = [];
  if (r.rows.length) {
    const b = await getBusy(from, to);
    externalCheck = b.status === "not_connected" ? "unchecked" : b.status === "ok" ? "ok" : "error";
    if (b.status === "ok") busy = b.busy;
  }

  const slots: PublicSlot[] = [];
  const dates: Record<string, number> = {};
  for (const row of r.rows) {
    const date = localDate(row.starts_at, settings.timezone);
    if ((perDay.get(date) ?? 0) >= settings.maxPerDay) continue;
    if (externalCheck === "error") continue; // can't verify: show nothing rather than risk a double-booking
    if (busy.length && overlapsBusy(busy, row.starts_at, row.ends_at)) continue;
    slots.push({ id: row.id, startsAt: row.starts_at.toISOString(), endsAt: row.ends_at.toISOString(), date });
    dates[date] = (dates[date] ?? 0) + 1;
  }
  return { paused: false, seasonId, slots, dates, externalCheck };
}

// ---------------- owner availability editor ----------------

export interface PublishInput {
  seasonId: string;
  dates: string[];
  startTime: string; endTime: string;
  durationMin: number; bufferMin: number;
  breaks?: { start: string; end: string }[];
}

export interface PlanPreviewDay { date: string; slots: { startsAt: string; endsAt: string }[]; error?: string }

export async function previewPlan(i: PublishInput): Promise<PlanPreviewDay[]> {
  const { timezone: tz } = await getSettings();
  return i.dates.map((date) => {
    try {
      const s = planSlots({ date, startTime: i.startTime, endTime: i.endTime, durationMin: i.durationMin, bufferMin: i.bufferMin, breaks: i.breaks, tz });
      return { date, slots: s.map((x) => ({ startsAt: x.startsAt.toISOString(), endsAt: x.endsAt.toISOString() })) };
    } catch (e) {
      if (e instanceof SlotPlanError) return { date, slots: [], error: e.message };
      throw e;
    }
  });
}

export interface PublishResult { created: number; skippedConflicts: { startsAt: string; reason: string }[] }

/** Publish slots. Overlaps with already-published slots or live bookings are skipped and reported, never forced. */
export async function publishSlots(i: PublishInput, actor: string): Promise<PublishResult> {
  const settings = await getSettings();
  if (i.dates.length > 62) throw new AppError("too_many", "Pick at most 62 dates at a time");
  const days: { date: string; slots: PlannedSlot[] }[] = [];
  for (const date of i.dates) {
    if (!isValidDate(date)) throw new AppError("invalid", `Invalid date ${date}`);
    try {
      days.push({ date, slots: planSlots({ date, startTime: i.startTime, endTime: i.endTime, durationMin: i.durationMin, bufferMin: i.bufferMin, breaks: i.breaks, tz: settings.timezone }) });
    } catch (e) {
      if (e instanceof SlotPlanError) throw new AppError("invalid", `${date}: ${e.message}`);
      throw e;
    }
  }
  return publishPlanned(i.seasonId, days, actor);
}

export interface PublishResultX extends PublishResult { alreadyPublished: number; removed: number }

/**
 * Insert already-planned slots. Never forces anything:
 *  - a time that already exists (open OR deliberately closed) is left alone,
 *  - overlaps with published times or live bookings are skipped and reported,
 *  - with replaceUnbooked, open times in the touched dates that nobody has ever booked are removed first.
 */
export async function publishPlanned(seasonId: string, days: { date: string; slots: PlannedSlot[] }[], actor: string, o: { replaceUnbooked?: boolean; quiet?: boolean } = {}): Promise<PublishResultX> {
  const db = await getDb();
  const settings = await getSettings();
  const season = await getSeason(seasonId);
  if (!season) throw new AppError("not_found", "Season not found", 404);
  const now = new Date();
  const result: PublishResultX = { created: 0, skippedConflicts: [], alreadyPublished: 0, removed: 0 };

  if (o.replaceUnbooked && days.length) {
    const lo = localDayRange(days[0].date, settings.timezone).start, hi = localDayRange(days[days.length - 1].date, settings.timezone).end;
    const r = await db.query(
      `delete from slots where season_id=$1 and state='open' and starts_at >= $2 and starts_at < $3 and starts_at > now()
         and not exists (select 1 from bookings b where b.slot_id = slots.id) returning id`,
      [seasonId, lo, hi],
    );
    result.removed = r.rows.length;
    await db.query(`delete from slot_exceptions where season_id=$1 and starts_at >= $2 and starts_at < $3`, [seasonId, lo, hi]);
  }

  for (const day of days) {
    for (const p of day.slots) {
      if (p.startsAt <= now) { if (!o.quiet) result.skippedConflicts.push({ startsAt: p.startsAt.toISOString(), reason: "already in the past" }); continue; }
      try {
        const made = await db.tx(async (q) => {
          const same = await q.query(`select 1 from slots where starts_at=$1 and season_id=$2`, [p.startsAt, seasonId]);
          if (same.rows.length) return false;
          // a time the owner deliberately moved or removed stays gone
          const gone = await q.query(`select 1 from slot_exceptions where season_id=$1 and starts_at=$2`, [seasonId, p.startsAt]);
          if (gone.rows.length) return "skip" as const;
          const clash = await q.query(
            `select 1 from bookings where status in ('hold','confirmed') and tstzrange(starts_at, buffer_end) && tstzrange($1::timestamptz, $2::timestamptz)`,
            [p.startsAt, p.bufferEnd],
          );
          if (clash.rows.length) throw new AppError("overlap", "overlaps a booked session");
          await q.query(`insert into slots(season_id, starts_at, ends_at, buffer_end) values ($1,$2,$3,$4)`, [seasonId, p.startsAt, p.endsAt, p.bufferEnd]);
          return true;
        });
        if (made === "skip") continue;
        if (made) result.created++; else result.alreadyPublished++;
      } catch (e) {
        if (isOverlapError(e) || (e instanceof AppError && e.code === "overlap")) { if (!o.quiet) result.skippedConflicts.push({ startsAt: p.startsAt.toISOString(), reason: "overlaps an existing published time" }); }
        else throw e;
      }
    }
  }
  if (!o.quiet || result.created) await audit(db, actor, "slots.publish", null, { seasonId, dates: days.length, created: result.created, removed: result.removed });
  return result;
}

export interface OwnerSlot { id: string; seasonId: string; startsAt: string; endsAt: string; bufferEnd: string; state: string; date: string; booking: { id: string; ref: string; status: string } | null }

export async function listOwnerSlots(seasonId: string | null, fromDate: string, toDate: string): Promise<OwnerSlot[]> {
  const db = await getDb();
  const { timezone: tz } = await getSettings();
  const from = localDayRange(fromDate, tz).start, to = localDayRange(toDate, tz).end;
  const r = await db.query(
    `select s.id, s.season_id, s.starts_at, s.ends_at, s.buffer_end, s.state, b.id as bid, b.ref, b.status as bstatus
       from slots s left join bookings b on b.slot_id = s.id and b.status in ('hold','confirmed')
      where s.starts_at >= $1 and s.starts_at < $2 and ($3::uuid is null or s.season_id = $3)
      order by s.starts_at`,
    [from, to, seasonId],
  );
  return r.rows.map((x) => ({
    id: x.id, seasonId: x.season_id, startsAt: x.starts_at.toISOString(), endsAt: x.ends_at.toISOString(), bufferEnd: x.buffer_end.toISOString(), state: x.state,
    date: localDate(x.starts_at, tz), booking: x.bid ? { id: x.bid, ref: x.ref, status: x.bstatus } : null,
  }));
}

/** Close (unpublish) slots. Slots with a live booking are refused: use cancel/reschedule so nothing moves silently. */
export async function closeSlots(slotIds: string[], actor: string): Promise<{ closed: number; refused: { id: string; ref: string }[] }> {
  const db = await getDb();
  const refused: { id: string; ref: string }[] = [];
  let closed = 0;
  await db.tx(async (q) => {
    for (const id of slotIds) {
      const b = await q.query(`select ref from bookings where slot_id=$1 and status in ('hold','confirmed')`, [id]);
      if (b.rows[0]) { refused.push({ id, ref: b.rows[0].ref }); continue; }
      const r = await q.query(`update slots set state='closed' where id=$1 and state='open' returning id`, [id]);
      closed += r.rows.length;
    }
    await audit(q, actor, "slots.close", null, { closed, refused: refused.length });
  });
  return { closed, refused };
}

/** Undo for closeSlots (only succeeds if nothing now overlaps). */
export async function reopenSlots(slotIds: string[], actor: string): Promise<{ reopened: number; failed: number }> {
  const db = await getDb();
  let reopened = 0, failed = 0;
  for (const id of slotIds) {
    try {
      await db.tx(async (q: Q) => {
        const clash = await q.query(
          `select 1 from slots s, bookings b where s.id=$1 and b.status in ('hold','confirmed') and tstzrange(b.starts_at,b.buffer_end) && tstzrange(s.starts_at,s.buffer_end)`,
          [id],
        );
        if (clash.rows.length) throw new AppError("overlap", "booked");
        await q.query(`update slots set state='open' where id=$1`, [id]);
      });
      reopened++;
    } catch (e) {
      if (isOverlapError(e) || e instanceof AppError) failed++; else throw e;
    }
  }
  await audit(db, actor, "slots.reopen", null, { reopened, failed });
  return { reopened, failed };
}

// ---------------- edit single slots ----------------

export interface SlotEdit { date: string; startTime: string; durationMin: number; bufferMin?: number }

function resolveEdit(e: SlotEdit, tz: string, defaultBuffer: number) {
  if (!isValidDate(e.date)) throw new AppError("invalid", "That date isn't valid.", 422);
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(e.startTime)) throw new AppError("invalid", "Start time must look like 10:00.", 422);
  if (!Number.isInteger(e.durationMin) || e.durationMin < 10 || e.durationMin > 480) throw new AppError("invalid", "Session length must be 10 to 480 minutes.", 422);
  const buffer = e.bufferMin ?? defaultBuffer;
  if (!Number.isInteger(buffer) || buffer < 0 || buffer > 240) throw new AppError("invalid", "Break must be 0 to 240 minutes.", 422);
  let start: Date;
  try { start = zonedToUtc(e.date, e.startTime, tz, "earlier"); }
  catch (err) { if (err instanceof NonexistentLocalTime || err instanceof AmbiguousLocalTime) throw new AppError("invalid", `${err.message}. Pick a different time.`, 422); throw err; }
  const end = new Date(start.getTime() + e.durationMin * 60_000);
  return { start, end, bufferEnd: new Date(end.getTime() + buffer * 60_000), buffer };
}

/** Change one published time (its day, start, length or break). Booked times can't be edited: reschedule the booking instead. */
export async function updateSlot(id: string, e: SlotEdit, actor: string) {
  const db = await getDb();
  const settings = await getSettings();
  await db.tx(async (q) => {
    const cur = (await q.query(`select * from slots where id=$1 for update`, [id])).rows[0];
    if (!cur) throw new AppError("not_found", "That time doesn't exist.", 404);
    const held = (await q.query(`select ref from bookings where slot_id=$1 and status in ('hold','confirmed')`, [id])).rows[0];
    if (held) throw new AppError("booked", `This time is booked (${held.ref}). Reschedule or cancel that booking from Sessions instead.`, 409);
    const defaultBuffer = Math.round((new Date(cur.buffer_end).getTime() - new Date(cur.ends_at).getTime()) / 60000);
    const t = resolveEdit(e, settings.timezone, defaultBuffer);
    if (t.start <= new Date()) throw new AppError("past", "That time is in the past.", 422);
    const clash = await q.query(
      `select 1 from bookings where status in ('hold','confirmed') and tstzrange(starts_at, buffer_end) && tstzrange($1::timestamptz, $2::timestamptz)`,
      [t.start, t.bufferEnd],
    );
    if (clash.rows.length) throw new AppError("overlap", "That overlaps a booked session.", 409);
    try {
      await q.query(`savepoint upd`);
      await q.query(`update slots set starts_at=$2, ends_at=$3, buffer_end=$4 where id=$1`, [id, t.start, t.end, t.bufferEnd]);
      await q.query(`release savepoint upd`);
    } catch (err) {
      await q.query(`rollback to savepoint upd`);
      if (isOverlapError(err)) throw new AppError("overlap", "That overlaps another published time. Move or remove that one first.", 409);
      throw err;
    }
    if (new Date(cur.starts_at).getTime() !== t.start.getTime()) {
      await q.query(`insert into slot_exceptions(season_id, starts_at) values ($1,$2) on conflict do nothing`, [cur.season_id, cur.starts_at]);
      await q.query(`delete from slot_exceptions where season_id=$1 and starts_at=$2`, [cur.season_id, t.start]);
    }
    await audit(q, actor, "slot.update", null, { id });
  });
}

/** Add one extra time on a specific day. */
export async function addSlot(seasonId: string, e: SlotEdit, actor: string) {
  const settings = await getSettings();
  if (!(await getSeason(seasonId))) throw new AppError("not_found", "Season not found", 404);
  const t = resolveEdit(e, settings.timezone, settings.schedule.bufferMin);
  if (t.start <= new Date()) throw new AppError("past", "That time is in the past.", 422);
  await (await getDb()).query(`delete from slot_exceptions where season_id=$1 and starts_at=$2`, [seasonId, t.start]);
  const slot: PlannedSlot = { startsAt: t.start, endsAt: t.end, bufferEnd: t.bufferEnd, localStart: t.start.toISOString(), localEnd: t.end.toISOString() };
  const r = await publishPlanned(seasonId, [{ date: e.date, slots: [slot] }], actor);
  if (r.alreadyPublished) throw new AppError("exists", "There's already a time starting then.", 409);
  if (r.skippedConflicts.length) throw new AppError("overlap", "That overlaps another published time or a booked session.", 409);
}

/** Remove a time. If it was ever booked it is hidden instead, so booking history stays intact. */
export async function removeSlot(id: string, actor: string): Promise<"deleted" | "hidden"> {
  const db = await getDb();
  return db.tx(async (q) => {
    const held = (await q.query(`select ref from bookings where slot_id=$1 and status in ('hold','confirmed')`, [id])).rows[0];
    if (held) throw new AppError("booked", `This time is booked (${held.ref}). Cancel or reschedule that booking first.`, 409);
    const used = (await q.query(`select 1 from bookings where slot_id=$1 limit 1`, [id])).rows.length;
    if (used) { await q.query(`update slots set state='closed' where id=$1`, [id]); await audit(q, actor, "slot.hide", null, { id }); return "hidden" as const; }
    const gone = (await q.query(`delete from slots where id=$1 returning season_id, starts_at`, [id])).rows[0];
    if (gone) await q.query(`insert into slot_exceptions(season_id, starts_at) values ($1,$2) on conflict do nothing`, [gone.season_id, gone.starts_at]);
    await audit(q, actor, "slot.delete", null, { id });
    return "deleted" as const;
  });
}
