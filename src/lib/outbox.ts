import { getDb, type Row } from "./db";
import { addTask, enqueue, type JobKind } from "./core";
import { getSettings } from "./settings";
import { getBookingView, type BookingView } from "./booking";
import { getSeason } from "./seasons";
import { getGoogle } from "./google/client";
import { sendEmail, emailStatus } from "./mail";
import * as E from "./emails";
import { firstNameOf } from "./intake";
import { mintToken, manageUrl } from "./access";
import { appUrl, logError } from "./util";
import { localDate, localDayRange } from "./time";
import { releaseExpiredHolds } from "./booking";
import { googleHealthCheck } from "./google/client";

/** A handler either finishes, or reports it can't run yet (integration not connected) without burning retries. */
export class Blocked extends Error {}

const BACKOFF_MIN = [1, 5, 15, 60, 180, 720];
const MAX_ATTEMPTS = BACKOFF_MIN.length;

export interface RunSummary { done: number; blocked: number; retried: number; failed: number; held: { released: number; confirmed: number; skipped: number } }

/**
 * Claim and run due jobs. Safe to call concurrently (SKIP LOCKED) and from cron or after a save.
 * Jobs of the same kind-family for one booking never run at the same time, so an older Doc write
 * can't race a newer one.
 */
export async function processOutbox(limit = 20): Promise<RunSummary> {
  const db = await getDb();
  const held = await releaseExpiredHolds();
  await scheduleDaily();
  // recover jobs stuck "running" after a crash
  await db.query(`update outbox set status='pending' where status='running' and locked_at < now() - interval '10 minutes'`);

  const claimed = (await db.query(
    `update outbox set status='running', attempts=attempts+1, locked_at=now()
      where id in (
        select o.id from outbox o
         where o.status in ('pending','blocked') and o.run_at <= now()
           and not exists (select 1 from outbox r where r.status='running' and r.id <> o.id
                            and r.booking_id is not distinct from o.booking_id and split_part(r.kind,'.',1) = split_part(o.kind,'.',1))
         order by o.run_at, o.id limit $1 for update skip locked)
      returning *`,
    [limit],
  )).rows;

  const sum: RunSummary = { done: 0, blocked: 0, retried: 0, failed: 0, held };
  for (const job of claimed) {
    try {
      if ((await runJob(job)) === "deferred") continue; // re-queued by the handler itself
      await db.query(`update outbox set status='done', done_at=now(), last_error=null where id=$1`, [job.id]);
      sum.done++;
    } catch (e) {
      if (e instanceof Blocked) {
        // not a failure: waiting on setup. Don't count the attempt; look again in 15 minutes.
        await db.query(`update outbox set status='blocked', attempts=attempts-1, run_at=now()+interval '15 minutes', last_error=$2 where id=$1`, [job.id, e.message]);
        sum.blocked++;
        continue;
      }
      logError(`job:${job.kind}`, e);
      const msg = e instanceof Error ? e.message : String(e);
      if (job.attempts >= MAX_ATTEMPTS) {
        await db.query(`update outbox set status='failed', last_error=$2 where id=$1`, [job.id, msg]);
        await addTask(db, "sync_failed", `"${job.kind}" kept failing${job.booking_id ? " for a booking" : ""}: ${msg}. Open Needs attention to retry.`, job.booking_id, `failed:${job.id}`);
        sum.failed++;
      } else {
        await db.query(`update outbox set status='pending', run_at=now()+($2 || ' minutes')::interval, last_error=$3 where id=$1`, [job.id, String(BACKOFF_MIN[job.attempts - 1] ?? 60), msg]);
        sum.retried++;
      }
    }
  }
  return sum;
}

export async function retryJob(id: number) {
  const db = await getDb();
  await db.query(`update outbox set status='pending', attempts=0, run_at=now(), last_error=null where id=$1 and status in ('failed','blocked')`, [id]);
  await db.query(`update tasks set status='done', done_at=now() where dedupe_key=$1`, [`failed:${id}`]);
}

// ---------------------------------------------------------------- scheduled work

/** Daily owner run sheet (shoot days only) and Google health check. Idempotent via dedupe keys. */
export async function scheduleDaily(now = new Date()) {
  const db = await getDb();
  const s = await getSettings();
  const today = localDate(now, s.timezone);
  const [hh, mm] = s.runSheetLocalTime.split(":").map(Number);
  const lp = new Date(now.toLocaleString("en-US", { timeZone: s.timezone }));
  if (lp.getHours() * 60 + lp.getMinutes() < hh * 60 + mm) return;
  const { start, end } = localDayRange(today, s.timezone);
  const n = (await db.query(`select count(*)::int as n from bookings where status='confirmed' and starts_at >= $1 and starts_at < $2`, [start, end])).rows[0].n;
  if (n > 0) await enqueue(db, { kind: "email.owner_run_sheet", bookingId: null, dedupeKey: `runsheet:${today}`, payload: { date: today } });
  const last = (await db.query(`select checked_at from integrations where provider='google'`)).rows[0];
  if (last && (!last.checked_at || now.getTime() - new Date(last.checked_at).getTime() > 24 * 3600_000)) await googleHealthCheck().catch(() => {});
}

// ---------------------------------------------------------------- handlers

async function runJob(job: Row): Promise<void | "deferred"> {
  const kind = job.kind as JobKind;
  if (kind === "email.owner_run_sheet") return runSheetEmail(job);
  if (kind === "email.owner_alert") return alertEmail(job);
  const view = job.booking_id ? await getBookingView(job.booking_id) : null;
  if (!view) throw new Error("Booking no longer exists");
  switch (kind) {
    case "calendar.upsert": return calendarUpsert(view);
    case "calendar.cancel": return calendarCancel(view);
    case "doc.upsert": return docUpsert(view);
    case "email.owner_new_booking": return ownerNewEmail(job, view);
    case "email.owner_intake_changed": return ownerChangedEmail(job, view);
    case "email.client_confirmation": return clientConfirmEmail(job, view);
    case "email.client_reminder": return clientReminderEmail(job, view);
    case "email.client_verify_email": return clientVerifyEmailJob(job, view);
    case "email.client_manage_link": return clientRecoveryEmail(job, view);
    case "email.client_gallery": return clientGalleryEmail(job, view);
    case "email.client_email_changed": return clientEmailChangedEmail(job, view);
    default: throw new Error(`Unknown job kind ${kind}`);
  }
}

async function ownerTo() { return (await getSettings()).ownerEmail; }

async function deliver(job: Row, to: string, built: E.Built, bookingId: string | null) {
  const r = await sendEmail({ to, subject: built.subject, text: built.text, html: built.html, idempotencyKey: `job-${job.id}-${job.dedupe_key}`, bookingId, outboxId: job.id });
  if (r.status === "blocked") throw new Blocked(r.reason);
}

async function calendarUpsert(b: BookingView) {
  const g = await getGoogle();
  if (!g) throw new Blocked("Google isn't connected yet");
  const db = await getDb();
  const s = await getSettings();
  const people = b.intake.peopleCount.state === "answered" ? `${b.intake.peopleCount.value} people` : "people: N/A";
  const fn = firstNameOf(b.intake);
  const purposeLine = b.intake.purposes.state === "answered" ? `For: ${b.intake.purposes.value.choices.join(", ").replace(/_/g, " ")}` : "";
  const { eventId } = await g.upsertEvent({
    bookingId: b.id,
    summary: `Mini session: ${fn ?? b.ref} (${people})`,
    description: [`Reference: ${b.ref}`, purposeLine, `Details: ${E.adminUrl(b.id)}`].filter(Boolean).join("\n"), // no comfort notes, no client links
    start: b.startsAt, end: b.endsAt, timeZone: s.timezone, location: b.quote.location || undefined,
  });
  await db.query(`update bookings set calendar_event_id=$2, calendar_version=greatest(calendar_version,$3) where id=$1`, [b.id, eventId, b.intakeVersion]);
}

async function calendarCancel(b: BookingView) {
  const g = await getGoogle();
  if (!g) throw new Blocked("Google isn't connected yet");
  await g.cancelEvent(b.id);
}

/** Mirror the CURRENT database state into the owner's Google Doc. Reads latest, so a stale job can't overwrite newer answers. */
async function docUpsert(first: BookingView) {
  const g = await getGoogle();
  if (!g) throw new Blocked("Google isn't connected yet");
  const db = await getDb();
  const s = await getSettings();
  let view = first;
  for (let pass = 0; pass < 3; pass++) {
    const season = await getSeason(view.seasonId);
    const row = (await db.query(`select doc_id, folder_id, doc_version from bookings where id=$1`, [view.id])).rows[0];
    const canceled = view.status === "canceled";
    const fn = firstNameOf(view.intake);
    const res = await g.upsertDoc({
      bookingId: view.id, existingDocId: row.doc_id, existingFolderId: row.folder_id,
      shootDate: localDate(view.startsAt, s.timezone), seasonName: season?.name ?? "Mini Sessions",
      clientFolderName: `${fn ?? view.ref} - ${view.ref}`,
      docTitle: "Session Brief", lines: E.briefLines(view, s.timezone, { seasonName: season?.name ?? "", canceled }),
    });
    await db.query(`update bookings set doc_id=$2, doc_url=$3, folder_id=$4, doc_version=greatest(doc_version,$5) where id=$1`, [view.id, res.docId, res.docUrl, res.folderId, view.intakeVersion]);
    const latest = await getBookingView(view.id);
    if (!latest || latest.intakeVersion === view.intakeVersion) return;
    view = latest; // answers changed while we were writing: write the newest too
  }
}

async function ownerNewEmail(job: Row, b: BookingView): Promise<void | "deferred"> {
  const db = await getDb();
  const g = await getGoogle();
  const row = (await db.query(`select doc_url, calendar_event_id from bookings where id=$1`, [b.id])).rows[0];
  // If Google is working, give the doc one short chance to be ready so the first email has the link. Never hold it longer than once.
  if (g && !row.doc_url && !job.payload?.deferred) {
    await db.query(`update outbox set payload = payload || '{"deferred":true}'::jsonb, run_at=now()+interval '45 seconds', status='pending', attempts=attempts-1 where id=$1`, [job.id]);
    return "deferred";
  }
  const s = await getSettings();
  await deliver(job, await ownerTo(), E.ownerNewBooking(b, s.timezone, { docUrl: row.doc_url, calendarSynced: !!row.calendar_event_id, googleConnected: !!g }), b.id);
}

async function ownerChangedEmail(job: Row, b: BookingView) {
  const db = await getDb();
  const s = await getSettings();
  const version = job.payload.version as number;
  // Use the revision that this job is about for the "what changed" list, but the full CURRENT answers.
  const rev = (await db.query(`select changes, created_at from intake_revisions where booking_id=$1 and version=$2`, [b.id, version])).rows[0];
  const row = (await db.query(`select doc_url from bookings where id=$1`, [b.id])).rows[0];
  await deliver(job, await ownerTo(), E.ownerIntakeChanged(b, s.timezone, version, rev.changes, { docUrl: row.doc_url, savedAt: rev.created_at }), b.id);
}

async function clientConfirmEmail(job: Row, b: BookingView) {
  if (!b.recoveryEmail) return; // no destination: never pretend
  const s = await getSettings();
  const season = await getSeason(b.seasonId);
  const link = manageUrl(await mintToken(b.id, "manage"));
  await deliver(job, b.recoveryEmail, E.clientConfirmation(b, s.timezone, { manageLink: link, rescheduled: !!job.payload?.rescheduled, siteName: season?.published?.siteName ?? season?.draft.siteName ?? "Xan's Eye Photography", ownerEmail: s.ownerEmail }), b.id);
}

async function clientReminderEmail(job: Row, b: BookingView) {
  if (b.status !== "confirmed" || !b.recoveryEmail) return;
  const s = await getSettings();
  const season = await getSeason(b.seasonId);
  const link = manageUrl(await mintToken(b.id, "manage"));
  await deliver(job, b.recoveryEmail, E.clientReminder(b, s.timezone, job.payload.hours, { manageLink: link, siteName: season?.published?.siteName ?? "Xan's Eye Photography", prep: season?.published?.prepNotes ?? "" }), b.id);
}

async function clientVerifyEmailJob(job: Row, b: BookingView) {
  const s = await getSettings();
  const season = await getSeason(b.seasonId);
  const raw = await mintToken(b.id, "verify_email", { email: job.payload.newEmail });
  await deliver(job, job.payload.newEmail, E.clientVerifyEmail(`${appUrl()}/manage/verify#${raw}`, season?.published?.siteName ?? "Xan's Eye Photography"), b.id);
  void s;
}

async function clientRecoveryEmail(job: Row, b: BookingView) {
  if (!b.recoveryEmail) return;
  const season = await getSeason(b.seasonId);
  const raw = await mintToken(b.id, "recovery");
  await deliver(job, b.recoveryEmail, E.clientRecovery(manageUrl(raw), season?.published?.siteName ?? "Xan's Eye Photography"), b.id);
}

async function clientGalleryEmail(job: Row, b: BookingView) {
  if (!b.recoveryEmail || !b.galleryUrl) return;
  const season = await getSeason(b.seasonId);
  await deliver(job, b.recoveryEmail, E.clientGallery(b.galleryUrl, season?.published?.siteName ?? "Xan's Eye Photography", firstNameOf(b.intake)), b.id);
}

async function clientEmailChangedEmail(job: Row, b: BookingView) {
  const season = await getSeason(b.seasonId);
  if (job.payload.oldEmail) await deliver(job, job.payload.oldEmail, E.clientEmailChangedNotice(season?.published?.siteName ?? "Xan's Eye Photography"), b.id);
}

async function alertEmail(job: Row) {
  await deliver(job, await ownerTo(), E.ownerAlert(job.payload.subject, job.payload.message, job.booking_id ? E.adminUrl(job.booking_id) : `${appUrl()}/admin`), job.booking_id);
}

async function runSheetEmail(job: Row) {
  const s = await getSettings();
  const db = await getDb();
  const { start, end } = localDayRange(job.payload.date, s.timezone);
  const ids = (await db.query(`select id from bookings where status='confirmed' and starts_at >= $1 and starts_at < $2 order by starts_at`, [start, end])).rows;
  const views = (await Promise.all(ids.map((r) => getBookingView(r.id)))).filter(Boolean) as BookingView[];
  await deliver(job, await ownerTo(), E.ownerRunSheet(job.payload.date, views, s.timezone), null);
}

export { emailStatus };
