import { getDb, isOverlapError, type Q } from "./db";
import { AppError, audit } from "./core";
import { getSettings } from "./settings";
import { planSlots, SlotPlanError, type SlotPlanInput } from "./slots";
import { localDate, localDayRange, isValidDate } from "./time";
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
  const db = await getDb();
  const settings = await getSettings();
  const season = await getSeason(i.seasonId);
  if (!season) throw new AppError("not_found", "Season not found", 404);
  if (i.dates.length > 62) throw new AppError("too_many", "Pick at most 62 dates at a time");
  const now = new Date();
  const result: PublishResult = { created: 0, skippedConflicts: [] };
  for (const date of i.dates) {
    if (!isValidDate(date)) throw new AppError("invalid", `Invalid date ${date}`);
    let planned;
    try {
      planned = planSlots({ date, startTime: i.startTime, endTime: i.endTime, durationMin: i.durationMin, bufferMin: i.bufferMin, breaks: i.breaks, tz: settings.timezone });
    } catch (e) {
      if (e instanceof SlotPlanError) throw new AppError("invalid", `${date}: ${e.message}`);
      throw e;
    }
    for (const p of planned) {
      if (p.startsAt <= now) { result.skippedConflicts.push({ startsAt: p.startsAt.toISOString(), reason: "already in the past" }); continue; }
      try {
        await db.tx(async (q) => {
          const clash = await q.query(
            `select 1 from bookings where status in ('hold','confirmed') and tstzrange(starts_at, buffer_end) && tstzrange($1::timestamptz, $2::timestamptz)`,
            [p.startsAt, p.bufferEnd],
          );
          if (clash.rows.length) throw new AppError("overlap", "overlaps a booked session");
          await q.query(`insert into slots(season_id, starts_at, ends_at, buffer_end) values ($1,$2,$3,$4)`, [i.seasonId, p.startsAt, p.endsAt, p.bufferEnd]);
        });
        result.created++;
      } catch (e) {
        if (isOverlapError(e) || (e instanceof AppError && e.code === "overlap"))
          result.skippedConflicts.push({ startsAt: p.startsAt.toISOString(), reason: "overlaps an existing published time" });
        else throw e;
      }
    }
  }
  await audit(db, actor, "slots.publish", null, { seasonId: i.seasonId, dates: i.dates.length, created: result.created });
  return result;
}

export interface OwnerSlot { id: string; seasonId: string; startsAt: string; endsAt: string; state: string; date: string; booking: { id: string; ref: string; status: string } | null }

export async function listOwnerSlots(seasonId: string | null, fromDate: string, toDate: string): Promise<OwnerSlot[]> {
  const db = await getDb();
  const { timezone: tz } = await getSettings();
  const from = localDayRange(fromDate, tz).start, to = localDayRange(toDate, tz).end;
  const r = await db.query(
    `select s.id, s.season_id, s.starts_at, s.ends_at, s.state, b.id as bid, b.ref, b.status as bstatus
       from slots s left join bookings b on b.slot_id = s.id and b.status in ('hold','confirmed')
      where s.starts_at >= $1 and s.starts_at < $2 and ($3::uuid is null or s.season_id = $3)
      order by s.starts_at`,
    [from, to, seasonId],
  );
  return r.rows.map((x) => ({
    id: x.id, seasonId: x.season_id, startsAt: x.starts_at.toISOString(), endsAt: x.ends_at.toISOString(), state: x.state,
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
