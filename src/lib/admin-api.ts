import { z } from "zod";
import { getDb } from "./db";
import { AppError, addTask, audit, enqueue } from "./core";
import { getSettings, saveSettings, type AppSettings } from "./settings";
import { archiveSeason, createSeason, duplicateSeason, getSeason, listSeasons, listVersions, publishSeason, restoreVersion, saveDraft, unpublishSeason } from "./seasons";
import { closeSlots, listOwnerSlots, previewPlan, publishSlots, reopenSlots, publishPlanned, updateSlot, addSlot, removeSlot } from "./availability";
import { planSchedule, validateSchedule, type Schedule } from "./schedule";
import { addDays } from "./time";
import { cancelBooking, getBookingView, rescheduleBooking, balanceSummary } from "./booking";
import { retryJob } from "./outbox";
import { revokeAllAccess } from "./access";
import { contrastIssues, launchGaps } from "./content";
import { getEmailStatus } from "./mail";
import { stripeConfigured, getPaymentProvider } from "./payments";
import { disconnectGoogle, getGoogleIntegration, googleConfigured, googleHealthCheck, listOwnerCalendars, saveGoogleMeta, installGoogleBusyFetcher } from "./google/client";
import { saveAsset, listAssets, deleteAsset } from "./assets";
import { localDate, localDayRange, isValidDate, formatWhen } from "./time";
import { firstNameOf, displayField, emptyIntake } from "./intake";

function emptyErased() {
  const i: any = emptyIntake();
  for (const k of Object.keys(i)) if (k !== "photoRelease") i[k] = { state: "na" };
  return i;
}

export type Actor = { email: string };

const WORKFLOW = ["booked", "photographed", "backed_up", "selecting", "editing", "gallery_sent", "completed"] as const;

const SettingsPatch = z.object({
  demoMode: z.boolean(), paused: z.boolean(), timezone: z.string().refine((t) => { try { new Intl.DateTimeFormat("en-US", { timeZone: t }); return true; } catch { return false; } }, "Unknown timezone"),
  ownerEmail: z.string().email(), depositCents: z.number().int().min(0).max(100000), beautyEditCents: z.number().int().min(0).max(100000),
  holdMinutes: z.number().int().min(30).max(1440), minNoticeHours: z.number().int().min(0).max(24 * 60), horizonDays: z.number().int().min(1).max(730),
  maxPerDay: z.number().int().min(1).max(40), maxPeople: z.number().int().min(1).max(50),
  reminderHours: z.array(z.number().int().min(1).max(24 * 14)).max(5), runSheetLocalTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  retentionDraftDays: z.number().int().min(1).max(365),
  postChecklist: z.array(z.object({ key: z.string().min(1).max(40), label: z.string().min(1).max(80) })).max(12),
  prepChecklist: z.array(z.object({ key: z.string().min(1).max(40), label: z.string().min(1).max(80) })).max(20),
}).partial().strict();

// ---------------------------------------------------------------- reads

export async function overview() {
  const db = await getDb();
  const s = await getSettings();
  const now = new Date();
  const today = localDate(now, s.timezone);
  const { start, end } = localDayRange(today, s.timezone);

  const sessionRows = (await db.query(`select id from bookings where status='confirmed' and starts_at >= $1 order by starts_at limit 60`, [now])).rows;
  const todayRows = (await db.query(`select id from bookings where status='confirmed' and starts_at >= $1 and starts_at < $2 order by starts_at`, [start, end])).rows;
  const toView = async (r: Record<string, any>) => cardOf((await getBookingView(r.id))!, s);
  const [next, todays] = await Promise.all([sessionRows[0] ? toView(sessionRows[0]) : null, Promise.all(todayRows.map(toView))]);

  const tasks = (await db.query(`select t.id, t.kind, t.message, t.created_at, t.booking_id, b.ref from tasks t left join bookings b on b.id = t.booking_id where t.status='open' order by t.created_at desc limit 50`)).rows;
  const jobs = (await db.query(`select status, count(*)::int n from outbox where status in ('blocked','failed','pending') group by status`)).rows;
  const toDeliver = (await db.query(`select count(*)::int n from bookings where status='confirmed' and starts_at < now() and workflow_state not in ('gallery_sent','completed')`)).rows[0].n;
  const mirrorLag = (await db.query(`select count(*)::int n from bookings where status='confirmed' and doc_version < intake_version`)).rows[0].n;
  const season = (await listSeasons()).find((x) => x.status === "published") ?? null;
  const gaps = season ? launchGaps(season.draft) : [];
  const google = await getGoogleIntegration();

  return {
    now: now.toISOString(), timezone: s.timezone, settings: { paused: s.paused, demoMode: s.demoMode },
    next, today: todays, counters: { upcoming: sessionRows.length, needsAttention: tasks.length, toDeliver },
    tasks, jobs: Object.fromEntries(jobs.map((j) => [j.status, j.n])), mirrorLag,
    integrations: await integrationStatus(google),
    launchGaps: gaps, hasPublishedSeason: !!season,
  };
}

function cardOf(v: NonNullable<Awaited<ReturnType<typeof getBookingView>>>, s: AppSettings) {
  const bal = balanceSummary(v.quote, v.intake.beautyEdit.state === "answered" ? v.intake.beautyEdit.value : null, v.paidCents);
  return {
    id: v.id, ref: v.ref, status: v.status, startsAt: v.startsAt, when: formatWhen(v.startsAt, s.timezone), first: firstNameOf(v.intake),
    people: displayField(v.intake, "peopleCount"), purpose: displayField(v.intake, "purposes"), orientation: displayField(v.intake, "orientation"),
    posing: displayField(v.intake, "posing"), beauty: displayField(v.intake, "beautyEdit"), paymentStatus: v.paymentStatus, paidCents: v.paidCents,
    balanceDueCents: bal.balanceDueCents, workflow: v.workflowState, contactMissing: v.contactMissing, docUrl: v.docUrl, synced: { calendar: !!v.calendarEventId, doc: v.docVersion >= v.intakeVersion && !!v.docUrl },
  };
}

async function integrationStatus(google: Awaited<ReturnType<typeof getGoogleIntegration>>) {
  const mail = await getEmailStatus();
  return {
    google: { configured: googleConfigured(), status: google?.status ?? "disconnected", account: google?.account_email ?? null, error: google?.last_error ?? null, calendarId: google?.meta?.calendarId ?? null, conflictCalendarIds: google?.meta?.conflictCalendarIds ?? [], checkedAt: google?.checked_at ?? null },
    stripe: { configured: stripeConfigured(), mode: getPaymentProvider().name === "demo" ? "demo" : getPaymentProvider().live ? "live" : "test" },
    email: mail,
  };
}

export async function listSessions(filter: string) {
  const db = await getDb();
  const s = await getSettings();
  const where = filter === "past" ? `status='confirmed' and starts_at < now()` : filter === "canceled" ? `status in ('canceled','review','expired')` : filter === "all" ? `true` : `status='confirmed' and starts_at >= now() - interval '3 hours'`;
  const rows = (await db.query(`select id from bookings where ${where} order by starts_at ${filter === "past" ? "desc" : "asc"} limit 200`)).rows;
  return (await Promise.all(rows.map(async (r) => cardOf((await getBookingView(r.id))!, s))));
}

export async function sessionDetail(id: string) {
  const db = await getDb();
  const s = await getSettings();
  const v = await getBookingView(id);
  if (!v) throw new AppError("not_found", "Session not found", 404);
  const revisions = (await db.query(`select version, changes, source, created_at from intake_revisions where booking_id=$1 order by version desc`, [id])).rows;
  const payments = (await db.query(`select amount_cents, currency, status, note, created_at from payments where booking_id=$1 order by id`, [id])).rows;
  const audit = (await db.query(`select at, actor, action from audit_events where booking_id=$1 order by id desc limit 30`, [id])).rows;
  const jobs = (await db.query(`select id, kind, status, attempts, last_error, run_at, done_at from outbox where booking_id=$1 order by id desc limit 30`, [id])).rows;
  const notes = (await db.query(`select to_addr, subject, status, provider, created_at from notifications where booking_id=$1 order by id desc limit 20`, [id])).rows;
  const openSlots = await listOwnerSlots(null, localDate(new Date(), s.timezone), localDate(new Date(Date.now() + 120 * 86400_000), s.timezone));
  return {
    ...cardOf(v, s), intake: v.intake, intakeVersion: v.intakeVersion, quote: v.quote, terms: v.terms, ownerNotes: v.ownerNotes, checklist: v.checklist,
    galleryUrl: v.galleryUrl, galleryDue: v.galleryDue, recoveryEmail: v.recoveryEmail, docVersion: v.docVersion, revisions, payments, audit, jobs, notifications: notes,
    freeSlots: openSlots.filter((x) => x.state === "open" && !x.booking && new Date(x.startsAt) > new Date()).slice(0, 200),
    postChecklist: s.postChecklist,
  };
}

// ---------------------------------------------------------------- writes

export async function sessionAction(id: string, action: string, body: any, actor: Actor) {
  const db = await getDb();
  const v = await getBookingView(id);
  if (!v) throw new AppError("not_found", "Session not found", 404);
  switch (action) {
    case "workflow": {
      if (!WORKFLOW.includes(body.state)) throw new AppError("invalid", "Unknown step", 422);
      await db.query(`update bookings set workflow_state=$2 where id=$1`, [id, body.state]);
      await audit(db, actor.email, "workflow", id, { state: body.state });
      return { ok: true };
    }
    case "notes":
      await db.query(`update bookings set owner_notes=$2 where id=$1`, [id, String(body.notes ?? "").slice(0, 5000)]);
      return { ok: true };
    case "gallery": {
      const url = String(body.url ?? "").trim();
      if (url && !/^https:\/\//i.test(url)) throw new AppError("invalid", "Gallery links must start with https://", 422);
      const due = body.due && isValidDate(body.due) ? body.due : null;
      await db.query(`update bookings set gallery_url=$2, gallery_due=$3 where id=$1`, [id, url || null, due]);
      return { ok: true };
    }
    case "send-gallery": {
      if (!v.galleryUrl) throw new AppError("invalid", "Paste the gallery link first.", 422);
      if (!v.recoveryEmail) throw new AppError("no_email", "This client has no email on file. Send the link another way.", 422);
      await enqueue(db, { kind: "email.client_gallery", bookingId: id, dedupeKey: `gallery:${id}:${Date.now()}` });
      await db.query(`update bookings set workflow_state='gallery_sent' where id=$1`, [id]);
      return { ok: true, queued: true };
    }
    case "cancel": await cancelBooking(id, actor.email, String(body.reason ?? "")); return { ok: true };
    case "reschedule": await rescheduleBooking(id, String(body.slotId ?? ""), actor.email); return { ok: true };
    case "revoke-access": await revokeAllAccess(id); await audit(db, actor.email, "access.revoke", id); return { ok: true };
    case "send-link":
      if (!v.recoveryEmail) throw new AppError("no_email", "No email on file for this client.", 422);
      await enqueue(db, { kind: "email.client_manage_link", bookingId: id, dedupeKey: `owner-link:${id}:${Date.now()}` });
      return { ok: true, queued: true };
    case "refund-handled":
      await db.query(`update bookings set payment_status='refunded' where id=$1 and payment_status='refund_pending'`, [id]);
      await db.query(`update tasks set status='done', done_at=now() where booking_id=$1 and kind in ('refund_decision','paid_slot_taken','payment_anomaly')`, [id]);
      await audit(db, actor.email, "refund.handled", id);
      return { ok: true };
    case "erase": {
      // Privacy deletion: wipe personal answers everywhere we hold them. Money records stay (financial record keeping).
      if (String(body.confirm ?? "").trim().toUpperCase() !== v.ref) throw new AppError("invalid", "Type the booking reference to confirm.", 422);
      const blank = JSON.stringify(emptyErased());
      await db.tx(async (q) => {
        await q.query(`update intake_revisions set data=$2, changes='[]'::jsonb where booking_id=$1`, [id, blank]);
        await q.query(`update bookings set recovery_email=null, contact_missing=true, owner_notes='' where id=$1`, [id]);
        await q.query(`update access_tokens set revoked_at=now() where booking_id=$1 and revoked_at is null`, [id]);
        await q.query(`update access_sessions set revoked_at=now() where booking_id=$1 and revoked_at is null`, [id]);
        await q.query(`update outbox set status='canceled' where booking_id=$1 and kind like 'email.client%' and status in ('pending','blocked')`, [id]);
        await enqueue(q, { kind: "doc.upsert", bookingId: id, dedupeKey: `doc:${id}:erased` });
        await enqueue(q, { kind: "calendar.upsert", bookingId: id, dedupeKey: `cal:${id}:erased` });
        await audit(q, actor.email, "booking.erase_personal_data", id);
      });
      return { ok: true };
    }
    case "retry-sync": {
      const failed = (await db.query(`select id from outbox where booking_id=$1 and status in ('failed','blocked')`, [id])).rows;
      for (const j of failed) await retryJob(j.id);
      await enqueue(db, { kind: "doc.upsert", bookingId: id, dedupeKey: `doc:${id}:manual:${Date.now()}` });
      await enqueue(db, { kind: "calendar.upsert", bookingId: id, dedupeKey: `cal:${id}:manual:${Date.now()}` });
      return { ok: true };
    }
    default: throw new AppError("not_found", "Unknown action", 404);
  }
}

export async function updateSettings(patch: unknown) {
  const parsed = SettingsPatch.safeParse(patch);
  if (!parsed.success) throw new AppError("invalid", parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "), 422);
  const p = parsed.data;
  if (p.demoMode === false) {
    // Going live: the published season must have real values and Stripe must be configured.
    const season = (await listSeasons()).find((x) => x.status === "published");
    if (!season) throw new AppError("not_ready", "Publish a season first.", 422);
    const gaps = launchGaps(season.published ?? season.draft);
    if (gaps.length) throw new AppError("launch_gaps", `Before going live, fill in: ${gaps.map((g) => g.label).join(", ")}`, 422, { gaps });
    if (!stripeConfigured()) throw new AppError("not_ready", "Connect Stripe first (add STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET), or deposits can't be collected.", 422);
  }
  return saveSettings(p as Partial<AppSettings>);
}

export async function uploadAsset(file: File, alt: string) {
  const buf = Buffer.from(await file.arrayBuffer());
  return saveAsset(buf, { alt });
}

export async function googleAction(action: string, body: any) {
  if (action === "calendars") return { calendars: await listOwnerCalendars() };
  if (action === "conflicts") {
    const ids = z.array(z.string().max(300)).max(20).parse(body.ids ?? []);
    const g = await getGoogleIntegration();
    if (!g) throw new AppError("not_connected", "Connect Google first.", 409);
    // never use the app's own calendar as a conflict source
    const kept = [...new Set(ids.filter((i) => i !== g.meta.calendarId))];
    await saveGoogleMeta({ conflictCalendarIds: kept });
    await installGoogleBusyFetcher();
    // read back what was actually stored, so the screen shows the truth
    return { ok: true, ids: (await getGoogleIntegration())?.meta.conflictCalendarIds ?? [] };
  }
  if (action === "disconnect") { await disconnectGoogle(); return { ok: true }; }
  if (action === "check") return { result: await googleHealthCheck() };
  throw new AppError("not_found", "Unknown action", 404);
}

export {
  addTask, createSeason, duplicateSeason, getSeason, listSeasons, listVersions, publishSeason, restoreVersion, saveDraft, unpublishSeason, archiveSeason,
  closeSlots, listOwnerSlots, previewPlan, publishSlots, reopenSlots, updateSlot, addSlot, removeSlot, listAssets, deleteAsset, contrastIssues, launchGaps, retryJob, getSettings,
};

/** Everything needed to rebuild the business records elsewhere. No secrets, tokens or card data are stored or exported. */
export async function exportAll() {
  const db = await getDb();
  const t = async (sql: string) => (await db.query(sql)).rows;
  return {
    exportedAt: new Date().toISOString(),
    settings: await getSettings(),
    seasons: await t(`select id, slug, name, status, draft, published, published_version, published_at from seasons`),
    slots: await t(`select * from slots order by starts_at`),
    bookings: await t(`select id, ref, slot_id, season_id, status, payment_status, starts_at, ends_at, quote, terms, paid_cents, recovery_email, workflow_state, gallery_url, owner_notes, doc_url, created_at, confirmed_at, canceled_at from bookings order by starts_at`),
    intakeRevisions: await t(`select booking_id, version, data, changes, source, created_at from intake_revisions order by booking_id, version`),
    payments: await t(`select * from payments order by id`),
    tasks: await t(`select * from tasks order by id`),
    audit: await t(`select * from audit_events order by id`),
  };
}

// ---------------------------------------------------------------- weekly schedule (Calendly-style)

export async function getSchedule() { return (await getSettings()).schedule; }

export async function saveSchedule(raw: unknown): Promise<Schedule> {
  let sch: Schedule;
  try { sch = validateSchedule(raw); } catch (e: any) {
    throw new AppError("invalid", e?.issues ? e.issues.map((i: any) => `${i.path.join(".")}: ${i.message}`).join("; ") : e.message, 422);
  }
  if (sch.seasonId && !(await getSeason(sch.seasonId))) throw new AppError("invalid", "Choose a season for these times.", 422);
  await saveSettings({ schedule: sch });
  return sch;
}

function windowFor(s: AppSettings, sch: Schedule, now = new Date()) {
  const today = localDate(now, s.timezone);
  const from = sch.windowFrom && sch.windowFrom > today ? sch.windowFrom : today;
  const horizonEnd = localDate(new Date(now.getTime() + s.horizonDays * 86400_000), s.timezone);
  const to = sch.windowTo && sch.windowTo < horizonEnd ? sch.windowTo : horizonEnd;
  return { from, to };
}

/** What the weekly schedule would produce, with how many of those times are already published. */
export async function previewSchedule(raw?: unknown) {
  const s = await getSettings();
  const sch = raw ? validateSchedule(raw) : s.schedule;
  const { from, to } = windowFor(s, sch);
  const days = planSchedule(sch, s.timezone, from, to);
  const db = await getDb();
  const existing = sch.seasonId
    ? (await db.query(`select starts_at from slots where season_id=$1 and state='open' and starts_at > now()`, [sch.seasonId])).rows.map((r) => r.starts_at.getTime())
    : [];
  const have = new Set(existing);
  return {
    from, to, timezone: s.timezone,
    days: days.map((d) => ({
      date: d.date, source: d.source, error: d.error,
      slots: d.slots.map((x) => ({ startsAt: x.startsAt.toISOString(), endsAt: x.endsAt.toISOString(), published: have.has(x.startsAt.getTime()) })),
    })),
  };
}

export async function publishSchedule(body: { seasonId?: string; replaceUnbooked?: boolean }, actor: Actor) {
  const s = await getSettings();
  const sch = s.schedule;
  const seasonId = body.seasonId ?? sch.seasonId;
  if (!seasonId) throw new AppError("invalid", "Choose which season these times belong to.", 422);
  const { from, to } = windowFor(s, sch);
  const days = planSchedule(sch, s.timezone, from, to);
  const bad = days.find((d) => d.error);
  if (bad) throw new AppError("invalid", `${bad.date}: ${bad.error}`, 422);
  const r = await publishPlanned(seasonId, days, actor.email, { replaceUnbooked: !!body.replaceUnbooked });
  if (sch.seasonId !== seasonId) await saveSettings({ schedule: { ...sch, seasonId } });
  return r;
}

/** Called by the worker once a day: keeps newly-arriving dates filled for owners who switched on auto-fill. */
export async function autoFillSchedule() {
  const s = await getSettings();
  const sch = s.schedule;
  if (!sch.autoFill || !sch.seasonId) return null;
  const season = await getSeason(sch.seasonId);
  if (!season || season.status !== "published") return null;
  const { from, to } = windowFor(s, sch);
  return publishPlanned(sch.seasonId, planSchedule(sch, s.timezone, from, to).filter((d) => !d.error), "auto-fill", { quiet: true });
}

export { addDays };
