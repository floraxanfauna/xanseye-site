import { getDb, isOverlapError, isUniqueError, type Q } from "./db";
import { AppError, addTask, audit, enqueue } from "./core";
import { getSettings, type AppSettings } from "./settings";
import { getSeason } from "./seasons";
import type { PageContent } from "./content";
import { IntakeSchema, contactSituation, diffIntake, firstNameOf, unansweredQuestions, type Intake, type FieldChange } from "./intake";
import { getPaymentProvider, type PaymentEvent } from "./payments";
import { checkSlotFree } from "./google/busy";
import { bookingRange, ensureDefaultType, getType, type SessionType } from "./sessiontypes";
import { localDate, localDayRange } from "./time";
import { newRef, newSecret, sha256, logError } from "./util";

// ---------------------------------------------------------------- quote

export interface Quote {
  currency: string;
  depositCents: number;
  sessionPriceCents: number | null;
  beautyEditCents: number;           // total for TWO photos, not per photo
  depositPolicy: PageContent["depositPolicy"];
  contentVersion: number;
  isDemo: boolean;
  durationMin: number | null;
  location: string;
  typeId?: string | null;
  typeName?: string | null;
}
export interface Terms { text: string; refundTerms: string; rescheduleCutoffHours: number | null; acceptedAt: string; contentVersion: number }

/** Snapshot of the prices/policies the client agreed to. Later page edits never rewrite this. */
export function buildQuote(content: PageContent, version: number, s: AppSettings, type?: SessionType | null): Quote {
  const c = type?.config;
  return {
    currency: s.currency, depositCents: c?.depositCents ?? s.depositCents, sessionPriceCents: c?.priceCents ?? content.facts.sessionPriceCents,
    beautyEditCents: s.beautyEditCents, depositPolicy: content.depositPolicy, contentVersion: version, isDemo: s.demoMode,
    durationMin: c?.durationMin ?? content.facts.durationMin, location: c?.location || content.facts.location,
    typeId: type?.id ?? null, typeName: type?.name ?? null,
  };
}

export interface BalanceSummary {
  sessionPriceCents: number | null; depositPaidCents: number; depositCreditedCents: number;
  beautyDueCents: number; balanceDueCents: number | null;
}
/** Deposit and the optional $40 editing add-on are tracked separately; nothing is silently charged. */
export function balanceSummary(q: Quote, beautyChoice: string | null, paidCents: number): BalanceSummary {
  const credited = q.depositPolicy === "credit" ? q.depositCents : 0;
  const beauty = beautyChoice === "yes" ? q.beautyEditCents : 0;
  const balance = q.sessionPriceCents == null ? null : Math.max(0, q.sessionPriceCents - credited) + beauty;
  return { sessionPriceCents: q.sessionPriceCents, depositPaidCents: paidCents, depositCreditedCents: credited, beautyDueCents: beauty, balanceDueCents: balance };
}

// ---------------------------------------------------------------- reserve

export interface ReserveResult {
  bookingId: string; ref: string; claimSecret: string; checkoutUrl: string; provider: "stripe" | "demo"; holdExpiresAt: Date;
}

export async function reserveSlot(input: { slotId: string; intake: unknown; acceptedTerms: boolean; ip?: string }): Promise<ReserveResult> {
  const db = await getDb();
  const settings = await getSettings();
  if (settings.paused) throw new AppError("paused", "Booking is paused right now. Please check back soon.", 409);
  if (!input.acceptedTerms) throw new AppError("terms", "Please agree to the booking terms to reserve.", 422);

  const parsed = IntakeSchema.safeParse(input.intake);
  if (!parsed.success) throw new AppError("invalid", "Some answers need another look.", 422, { issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) });
  const intake = parsed.data;
  const missing = unansweredQuestions(intake);
  if (missing.length) throw new AppError("unanswered", `Please answer or choose N/A for: ${missing.join(", ")}`, 422, { missing });
  const slot = (await db.query(`select s.*, se.status as season_status, se.published, se.published_version from slots s join seasons se on se.id = s.season_id where s.id = $1`, [input.slotId])).rows[0];
  if (!slot || slot.state !== "open" || slot.season_status !== "published") throw new AppError("slot_unavailable", "That time is no longer available. Please pick another.", 409);
  const now = new Date();
  const type = (await getType(slot.session_type_id ?? (await ensureDefaultType(db, slot.season_id))))!;
  if (!type.active) throw new AppError("slot_unavailable", "That session type isn't open for booking right now.", 409);
  const range = bookingRange(type, settings.horizonDays, settings.timezone, now);
  if (slot.starts_at < range.from || slot.starts_at > range.to)
    throw new AppError("slot_unavailable", "That time is outside the booking window.", 409);
  if (intake.peopleCount.state === "answered" && intake.peopleCount.value > type.config.maxPeople)
    throw new AppError("too_many_people", `This session is for up to ${type.config.maxPeople} people. Message me for larger groups.`, 422);

  // Google conflict check immediately before taking a hold. If it can't be verified, don't take payment.
  const ext = await checkSlotFree(slot.starts_at, slot.ends_at);
  if (ext === "busy") throw new AppError("slot_unavailable", "That time is no longer available. Please pick another.", 409);
  if (ext === "error") throw new AppError("conflict_check_failed", "I couldn't double-check the calendar just now. Please try again in a minute.", 503);

  const content = slot.published as PageContent;
  const quote = buildQuote(content, slot.published_version, settings, type);
  const terms: Terms = {
    text: content.termsText, refundTerms: content.refundTerms, rescheduleCutoffHours: content.rescheduleCutoffHours,
    acceptedAt: now.toISOString(), contentVersion: slot.published_version,
  };

  const provider = getPaymentProvider();
  const stripeExpires = new Date(now.getTime() + (settings.holdMinutes + 1) * 60_000);
  const holdExpires = new Date(stripeExpires.getTime() + 60_000); // Stripe's session always ends first
  const claimSecret = newSecret();
  const email = intake.email.state === "answered" ? intake.email.value : null;

  // ---- atomic reservation: the database exclusion constraint is the final word on double-booking
  let booking!: { id: string; ref: string };
  for (let attempt = 0; ; attempt++) {
    try {
      booking = await db.tx(async (q) => {
        const { start, end } = localDayRange(localDate(slot.starts_at, settings.timezone), settings.timezone);
        const day = await q.query(`select count(*)::int as n from bookings where status in ('hold','confirmed') and starts_at >= $1 and starts_at < $2`, [start, end]);
        if (day.rows[0].n >= settings.maxPerDay) throw new AppError("day_full", "That day is fully booked. Please pick another date.", 409);
        const ref = newRef();
        const r = await q.query(
          `insert into bookings(ref, slot_id, season_id, status, starts_at, ends_at, buffer_end, hold_expires_at, quote, terms, claim_hash,
                                recovery_email, recovery_email_verified, contact_missing, intake_version, session_type_id)
           values ($1,$2,$3,'hold',$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,1,$14) returning id, ref`,
          [ref, slot.id, slot.season_id, slot.starts_at, slot.ends_at, slot.buffer_end, holdExpires, JSON.stringify(quote), JSON.stringify(terms),
           sha256(claimSecret), email, !!email, contactSituation(intake) !== "email", type.id],
        );
        await q.query(`insert into intake_revisions(booking_id, version, data, changes, source) values ($1,1,$2,'[]','client')`, [r.rows[0].id, JSON.stringify(intake)]);
        return r.rows[0] as { id: string; ref: string };
      });
      break;
    } catch (e) {
      if (isOverlapError(e)) throw new AppError("slot_unavailable", "Someone just reserved that time. Please pick another.", 409);
      if (isUniqueError(e) && attempt < 3) continue; // ref collision: try a fresh reference
      throw e;
    }
  }

  // ---- payment (hosted Checkout). The same idempotency key is used on retry.
  const req = {
    bookingId: booking.id, ref: booking.ref, amountCents: quote.depositCents, currency: settings.currency, expiresAt: stripeExpires,
    description: `${type.name} deposit (${booking.ref})`, customerEmail: email ?? undefined, idempotencyKey: `booking-${booking.id}`,
  };
  let checkout;
  try {
    try { checkout = await provider.createCheckout(req); }
    catch { checkout = await provider.createCheckout(req); } // timed-out create may have succeeded; same key returns the same session
  } catch (e) {
    // The client never received a payment URL, so nothing can be paid; release the hold.
    logError("checkout.create", e);
    await db.query(`update bookings set status='expired', hold_expires_at=now() where id=$1 and status='hold'`, [booking.id]);
    throw new AppError("payment_unavailable", "I couldn't start the payment page. Nothing was charged. Please try again in a moment.", 502);
  }
  await db.query(`update bookings set stripe_session_id=$2 where id=$1`, [booking.id, checkout.sessionId]);
  await audit(db, "client", "booking.hold", booking.id, { slot: slot.id });
  return { bookingId: booking.id, ref: booking.ref, claimSecret, checkoutUrl: checkout.url, provider: provider.name, holdExpiresAt: holdExpires };
}

// ---------------------------------------------------------------- payment events

export type PaidOutcome = "confirmed" | "already_confirmed" | "duplicate_event" | "review_slot_taken" | "review_mismatch" | "ignored" | "released" | "unknown_booking";

/**
 * Single code path for turning a *verified* payment event into booking state.
 * (Real Stripe webhooks call this after signature verification; the demo pay page calls it too.)
 */
export async function applyPaymentEvent(ev: PaymentEvent): Promise<PaidOutcome> {
  const db = await getDb();
  return db.tx(async (q) => {
    const ins = await q.query(`insert into stripe_events(id, type) values ($1,$2) on conflict (id) do nothing returning id`, [ev.id, ev.type]);
    if (!ins.rows.length) return "duplicate_event" as const;
    if (!ev.bookingId) return "ignored" as const;

    const b = (await q.query(`select * from bookings where id = $1 for update`, [ev.bookingId])).rows[0];
    if (!b) return "unknown_booking" as const;

    if (ev.type === "checkout.session.expired" || (!ev.paid && ev.type.startsWith("checkout.session.async_payment_failed"))) {
      if (b.status === "hold" && b.payment_status === "unpaid") {
        await q.query(`update bookings set status='expired' where id=$1`, [b.id]);
        return "released" as const;
      }
      return "ignored" as const; // out-of-order: a paid/confirmed booking is never released by an expiry event
    }
    if (!ev.paid) return "ignored" as const;
    return applyPaid(q, b, ev);
  });
}

async function applyPaid(q: Q, b: any, ev: PaymentEvent): Promise<PaidOutcome> {
  const quote = b.quote as Quote;
  const mismatch = ev.amountCents !== quote.depositCents || ev.currency.toLowerCase() !== quote.currency.toLowerCase();

  if (mismatch) {
    await q.query(`insert into payments(booking_id, stripe_session_id, stripe_payment_intent, amount_cents, currency, status, note) values ($1,$2,$3,$4,$5,'anomaly',$6)`,
      [b.id, ev.sessionId, ev.paymentIntent, ev.amountCents, ev.currency, `Expected ${quote.depositCents} ${quote.currency}`]);
    if (b.status !== "confirmed") await q.query(`update bookings set status='review' where id=$1`, [b.id]);
    await addTask(q, "payment_anomaly", `Payment amount didn't match for ${b.ref} (got ${ev.amountCents} ${ev.currency}, expected ${quote.depositCents}). Check Stripe before doing anything.`, b.id, `anomaly:${b.id}:${ev.sessionId}`);
    await enqueue(q, { kind: "email.owner_alert", bookingId: b.id, dedupeKey: `alert:anomaly:${b.id}:${ev.sessionId}`, payload: { subject: `Payment mismatch on ${b.ref}`, message: "A payment arrived with an unexpected amount. The booking was NOT confirmed. Please review it in Stripe and in the dashboard." } });
    return "review_mismatch";
  }

  if (b.status === "confirmed") {
    if (b.stripe_payment_intent && ev.paymentIntent && b.stripe_payment_intent !== ev.paymentIntent) {
      await q.query(`insert into payments(booking_id, stripe_session_id, stripe_payment_intent, amount_cents, currency, status, note) values ($1,$2,$3,$4,$5,'anomaly','second payment on a confirmed booking')`,
        [b.id, ev.sessionId, ev.paymentIntent, ev.amountCents, ev.currency]);
      await addTask(q, "payment_anomaly", `${b.ref} was paid twice. One payment likely needs a refund in Stripe.`, b.id, `double:${b.id}:${ev.paymentIntent}`);
    }
    return "already_confirmed";
  }

  // hold, or late payment on an expired/canceled/review booking: try to (re)occupy the slot.
  await q.query(`savepoint try_confirm`);
  try {
    await q.query(
      `update bookings set status='confirmed', payment_status='paid', paid_cents=$2, stripe_payment_intent=$3, confirmed_at=now(), hold_expires_at=null where id=$1`,
      [b.id, ev.amountCents, ev.paymentIntent],
    );
    await q.query(`release savepoint try_confirm`);
  } catch (e) {
    await q.query(`rollback to savepoint try_confirm`);
    if (!isOverlapError(e)) throw e;
    // The slot was taken by someone else after this hold lapsed. Never double book.
    await q.query(`update bookings set status='review', payment_status='paid', paid_cents=$2, stripe_payment_intent=$3 where id=$1`, [b.id, ev.amountCents, ev.paymentIntent]);
    await q.query(`insert into payments(booking_id, stripe_session_id, stripe_payment_intent, amount_cents, currency, status, note) values ($1,$2,$3,$4,$5,'anomaly','paid after the hold expired; slot already rebooked')`,
      [b.id, ev.sessionId, ev.paymentIntent, ev.amountCents, ev.currency]);
    await addTask(q, "paid_slot_taken", `${b.ref} paid after their hold expired and the time was already taken. Offer another time or refund the deposit in Stripe.`, b.id, `slot-taken:${b.id}`);
    await enqueue(q, { kind: "email.owner_alert", bookingId: b.id, dedupeKey: `alert:slot-taken:${b.id}`, payload: { subject: `Paid but time was taken: ${b.ref}`, message: "A client's payment arrived after their hold expired and the slot was already rebooked. Please offer another time or refund the deposit." } });
    return "review_slot_taken";
  }

  await q.query(`insert into payments(booking_id, stripe_session_id, stripe_payment_intent, amount_cents, currency, status) values ($1,$2,$3,$4,$5,'paid')`,
    [b.id, ev.sessionId, ev.paymentIntent, ev.amountCents, ev.currency]);
  await onConfirmed(q, b.id);
  return "confirmed";
}

/** Everything that must happen once a booking is truly confirmed. All durable, all idempotent. */
async function onConfirmed(q: Q, bookingId: string) {
  const b = (await q.query(`select * from bookings where id=$1`, [bookingId])).rows[0];
  const rev = (await q.query(`select data from intake_revisions where booking_id=$1 order by version desc limit 1`, [bookingId])).rows[0];
  const intake = rev.data as Intake;
  const settings = await getSettings(q);
  const situation = contactSituation(intake);

  await enqueue(q, { kind: "calendar.upsert", bookingId, dedupeKey: `cal:${bookingId}:i${b.intake_version}` });
  await enqueue(q, { kind: "doc.upsert", bookingId, dedupeKey: `doc:${bookingId}:i${b.intake_version}` });
  await enqueue(q, { kind: "email.owner_new_booking", bookingId, dedupeKey: `owner-new:${bookingId}` });
  const btype = b.session_type_id ? await getType(b.session_type_id, q) : null;
  if (situation === "email" && (btype?.config.sendConfirmationEmail ?? true)) await enqueue(q, { kind: "email.client_confirmation", bookingId, dedupeKey: `client-conf:${bookingId}` });
  await scheduleReminders(q, b, situation === "email", settings);

  if (situation === "phone_only")
    await addTask(q, "contact_followup", `${b.ref} gave a phone number but no email. Email confirmations and reminders can't be sent; text or call them.`, bookingId, `contact:${bookingId}`);
  if (situation === "none")
    await addTask(q, "contact_followup", `${b.ref} gave no contact info. They were shown a private link on screen; you have no way to reach them.`, bookingId, `contact:${bookingId}`);
  await audit(q, "system", "booking.confirmed", bookingId, {});
}

async function scheduleReminders(q: Q, b: any, hasEmail: boolean, settings: AppSettings) {
  if (!hasEmail) return;
  const type = b.session_type_id ? await getType(b.session_type_id, q) : null;
  const reminders = type ? type.config.reminders : settings.reminderHours.map((h) => ({ hoursBefore: h, subject: "", body: "" }));
  const now = Date.now();
  for (const r of reminders) {
    const runAt = new Date(new Date(b.starts_at).getTime() - r.hoursBefore * 3600_000);
    if (runAt.getTime() <= now) continue; // never send a reminder for a threshold already past
    await enqueue(q, { kind: "email.client_reminder", bookingId: b.id, dedupeKey: `reminder:${b.id}:${r.hoursBefore}:${new Date(b.starts_at).getTime()}`, payload: { hours: r.hoursBefore, subject: r.subject, body: r.body }, runAt });
  }
}

// ---------------------------------------------------------------- hold cleanup

/** Release expired holds only after reconciling with the payment provider. Never frees a paid booking. */
export async function releaseExpiredHolds(now = new Date()): Promise<{ released: number; confirmed: number; skipped: number }> {
  const db = await getDb();
  const provider = getPaymentProvider();
  const due = (await db.query(`select id, stripe_session_id from bookings where status='hold' and hold_expires_at < $1 order by hold_expires_at limit 100`, [now])).rows;
  let released = 0, confirmed = 0, skipped = 0;
  for (const h of due) {
    try {
      if (h.stripe_session_id && provider.name === "stripe") {
        const s = await provider.getSession(h.stripe_session_id);
        if (s.paid) {
          const out = await applyPaymentEvent({ id: `reconcile:${h.stripe_session_id}`, type: "checkout.session.completed", bookingId: h.id, sessionId: h.stripe_session_id, paid: true, amountCents: s.amountCents, currency: s.currency, paymentIntent: s.paymentIntent });
          if (out === "confirmed" || out === "already_confirmed") confirmed++; else skipped++;
          continue;
        }
        if (s.status === "open") await provider.expireSession(h.stripe_session_id); // stop it being paid after we free the slot
      }
      const r = await db.query(`update bookings set status='expired' where id=$1 and status='hold' and payment_status='unpaid' returning id`, [h.id]);
      if (r.rows.length) { released++; await audit(db, "system", "booking.hold_expired", h.id, {}); }
    } catch (e) {
      skipped++; // provider unreachable: keep the hold, try again next run
      logError("hold.cleanup", e);
    }
  }
  return { released, confirmed, skipped };
}

// ---------------------------------------------------------------- intake saves

export class VersionConflict extends AppError {
  constructor(public currentVersion: number) { super("version_conflict", "This form was changed somewhere else. Please reload to see the latest answers before saving.", 409, { currentVersion }); }
}

export interface SaveResult { changed: boolean; version: number; changes: FieldChange[] }

/**
 * Client saves their intake. A material change commits one new revision plus durable jobs
 * (owner email, Doc mirror, calendar refresh) in the same transaction. A no-op save does nothing.
 */
export async function saveIntake(bookingId: string, raw: unknown, expectedVersion: number, source: "client" | "owner" = "client"): Promise<SaveResult> {
  const db = await getDb();
  const settings = await getSettings();
  const parsed = IntakeSchema.safeParse(raw);
  if (!parsed.success) throw new AppError("invalid", "Some answers need another look.", 422, { issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) });
  const next = parsed.data;
  return db.tx(async (q) => {
    const b = (await q.query(`select * from bookings where id=$1 for update`, [bookingId])).rows[0];
    if (!b) throw new AppError("not_found", "Booking not found", 404);
    const btype = b.session_type_id ? await getType(b.session_type_id, q) : null;
    const maxPeople = btype?.config.maxPeople ?? settings.maxPeople;
    if (next.peopleCount.state === "answered" && next.peopleCount.value > maxPeople)
      throw new AppError("too_many_people", `This session is for up to ${maxPeople} people.`, 422);
    if (b.status !== "confirmed" && b.status !== "review") throw new AppError("not_confirmed", "This booking isn't confirmed yet.", 409);
    if (b.intake_version !== expectedVersion) throw new VersionConflict(b.intake_version);

    const prev = (await q.query(`select data from intake_revisions where booking_id=$1 and version=$2`, [bookingId, b.intake_version])).rows[0].data as Intake;
    const changes = diffIntake(prev, next);
    if (!changes.length) return { changed: false, version: b.intake_version, changes: [] };

    const version = b.intake_version + 1;
    await q.query(`insert into intake_revisions(booking_id, version, data, changes, source) values ($1,$2,$3,$4,$5)`, [bookingId, version, JSON.stringify(next), JSON.stringify(changes), source]);
    await q.query(`update bookings set intake_version=$2, contact_missing=$3 where id=$1`, [bookingId, version, contactSituation(next) !== "email"]);

    await enqueue(q, { kind: "email.owner_intake_changed", bookingId, dedupeKey: `intake-changed:${bookingId}:${version}`, payload: { version, changes } });
    await enqueue(q, { kind: "doc.upsert", bookingId, dedupeKey: `doc:${bookingId}:i${version}` });
    await enqueue(q, { kind: "calendar.upsert", bookingId, dedupeKey: `cal:${bookingId}:i${version}` });

    if (changes.some((c) => c.field === "beautyEdit"))
      await addTask(q, "editing_changed", `${b.ref} changed their beauty-editing choice. Review their balance before the gallery.`, bookingId, `beauty:${bookingId}:${version}`);
    if (changes.some((c) => c.field === "email" || c.field === "phone")) {
      // Recovery stays on the previously verified address until the new one is verified.
      if (next.email.state === "answered" && next.email.value !== b.recovery_email)
        await enqueue(q, { kind: "email.client_verify_email", bookingId, dedupeKey: `verify-email:${bookingId}:${version}`, payload: { newEmail: next.email.value } });
      if (contactSituation(next) !== "email")
        await addTask(q, "contact_followup", `${b.ref} no longer has an email on file. Reminders can't be emailed.`, bookingId, `contact:${bookingId}:${version}`);
    }
    await audit(q, source, "intake.save", bookingId, { version, fields: changes.map((c) => c.field) });
    return { changed: true, version, changes };
  });
}

// ---------------------------------------------------------------- cancel / reschedule

export async function cancelBooking(bookingId: string, actor: string, reason = ""): Promise<void> {
  const db = await getDb();
  await db.tx(async (q) => {
    const b = (await q.query(`select * from bookings where id=$1 for update`, [bookingId])).rows[0];
    if (!b) throw new AppError("not_found", "Booking not found", 404);
    if (b.status === "canceled") return;
    const wasPaid = b.payment_status === "paid";
    await q.query(
      `update bookings set status='canceled', canceled_at=now(), hold_expires_at=null, payment_status = case when payment_status='paid' then 'refund_pending' else payment_status end where id=$1`,
      [bookingId],
    );
    // reminders for this booking no longer apply
    await q.query(`update outbox set status='canceled' where booking_id=$1 and kind='email.client_reminder' and status in ('pending','blocked')`, [bookingId]);
    await enqueue(q, { kind: "calendar.cancel", bookingId, dedupeKey: `cal-cancel:${bookingId}` });
    await enqueue(q, { kind: "doc.upsert", bookingId, dedupeKey: `doc:${bookingId}:canceled` });
    if (wasPaid) await addTask(q, "refund_decision", `${b.ref} was canceled. Decide whether to refund their ${(b.paid_cents / 100).toFixed(2)} deposit (see their refund terms), then mark it handled.`, bookingId, `refund:${bookingId}`);
    await audit(q, actor, "booking.cancel", bookingId, { reason });
  });
}

/** Owner-driven reschedule: same booking, same price snapshot, new slot. History is kept in the audit log. */
export async function rescheduleBooking(bookingId: string, newSlotId: string, actor: string): Promise<void> {
  const db = await getDb();
  const settings = await getSettings();
  await db.tx(async (q) => {
    const b = (await q.query(`select * from bookings where id=$1 for update`, [bookingId])).rows[0];
    if (!b) throw new AppError("not_found", "Booking not found", 404);
    if (b.status !== "confirmed") throw new AppError("not_confirmed", "Only confirmed bookings can be rescheduled.", 409);
    const s = (await q.query(`select * from slots where id=$1`, [newSlotId])).rows[0];
    if (!s || s.state !== "open") throw new AppError("slot_unavailable", "That time isn't open.", 409);
    if (s.id === b.slot_id) throw new AppError("same_slot", "That's already their time.", 422);
    const day = localDayRange(localDate(s.starts_at, settings.timezone), settings.timezone);
    const n = (await q.query(`select count(*)::int as n from bookings where status in ('hold','confirmed') and starts_at >= $1 and starts_at < $2 and id <> $3`, [day.start, day.end, bookingId])).rows[0].n;
    if (n >= settings.maxPerDay) throw new AppError("day_full", "That day is already at your maximum sessions.", 409);
    try {
      await q.query(`savepoint mv`);
      await q.query(`update bookings set slot_id=$2, season_id=$3, starts_at=$4, ends_at=$5, buffer_end=$6 where id=$1`, [bookingId, s.id, s.season_id, s.starts_at, s.ends_at, s.buffer_end]);
      await q.query(`release savepoint mv`);
    } catch (e) {
      await q.query(`rollback to savepoint mv`);
      if (isOverlapError(e)) throw new AppError("slot_unavailable", "That time overlaps another session.", 409);
      throw e;
    }
    const hasEmail = !!b.recovery_email;
    await q.query(`update outbox set status='canceled' where booking_id=$1 and kind='email.client_reminder' and status in ('pending','blocked')`, [bookingId]);
    const moved = { ...b, starts_at: s.starts_at };
    await scheduleReminders(q, moved, hasEmail, settings);
    const stamp = Date.now();
    await enqueue(q, { kind: "calendar.upsert", bookingId, dedupeKey: `cal:${bookingId}:moved:${stamp}` });
    await enqueue(q, { kind: "doc.upsert", bookingId, dedupeKey: `doc:${bookingId}:moved:${stamp}`, payload: { moved: true } });
    if (hasEmail) await enqueue(q, { kind: "email.client_confirmation", bookingId, dedupeKey: `client-conf:${bookingId}:moved:${stamp}`, payload: { rescheduled: true } });
    await audit(q, actor, "booking.reschedule", bookingId, { from: b.slot_id, to: s.id });
  });
}

// ---------------------------------------------------------------- reads

export interface BookingView {
  id: string; ref: string; status: string; paymentStatus: string; startsAt: Date; endsAt: Date; paidCents: number; quote: Quote; terms: Terms;
  intakeVersion: number; intake: Intake; seasonId: string; workflowState: string; checklist: Record<string, boolean>;
  galleryUrl: string | null; galleryDue: string | null; ownerNotes: string; docUrl: string | null; calendarEventId: string | null;
  docVersion: number; recoveryEmail: string | null; contactMissing: boolean; createdAt: Date; slotId: string; typeId: string | null;
}

export async function getBookingView(bookingId: string, q?: Q): Promise<BookingView | null> {
  const db = q ?? (await getDb());
  const b = (await db.query(`select * from bookings where id=$1`, [bookingId])).rows[0];
  if (!b) return null;
  const rev = (await db.query(`select data from intake_revisions where booking_id=$1 and version=$2`, [bookingId, b.intake_version])).rows[0];
  return {
    id: b.id, ref: b.ref, status: b.status, paymentStatus: b.payment_status, startsAt: b.starts_at, endsAt: b.ends_at, paidCents: b.paid_cents,
    quote: b.quote, terms: b.terms, intakeVersion: b.intake_version, intake: rev.data, seasonId: b.season_id, workflowState: b.workflow_state,
    checklist: b.checklist, galleryUrl: b.gallery_url, galleryDue: b.gallery_due ? String(b.gallery_due).slice(0, 10) : null, ownerNotes: b.owner_notes,
    docUrl: b.doc_url, calendarEventId: b.calendar_event_id, docVersion: b.doc_version, recoveryEmail: b.recovery_email,
    contactMissing: b.contact_missing, createdAt: b.created_at, slotId: b.slot_id, typeId: b.session_type_id ?? null,
  };
}

export { firstNameOf, getSeason };

// ---------------------------------------------------------------- client self-service (within the owner's rules)

export interface ClientChangeRules { canReschedule: boolean; canCancel: boolean; cutoffHours: number; reason: string | null }

/** What a client may do to their own booking, per the session type's toggles and notice period. */
export async function clientChangeRules(bookingId: string, now = new Date()): Promise<ClientChangeRules> {
  const v = await getBookingView(bookingId);
  if (!v) throw new AppError("not_found", "Booking not found", 404);
  const t = v.typeId ? await getType(v.typeId) : null;
  const cutoff = t?.config.clientChangeCutoffHours ?? 48;
  const none = (reason: string) => ({ canReschedule: false, canCancel: false, cutoffHours: cutoff, reason });
  if (v.status !== "confirmed") return none("This booking isn't active.");
  if (!t || (!t.config.allowClientReschedule && !t.config.allowClientCancel)) return none("Changes are handled by me directly.");
  const hoursLeft = (new Date(v.startsAt).getTime() - now.getTime()) / 3600_000;
  if (hoursLeft < cutoff) return none(`It's within ${cutoff} hours of your session, so changes now go through me directly.`);
  return { canReschedule: t.config.allowClientReschedule, canCancel: t.config.allowClientCancel, cutoffHours: cutoff, reason: null };
}

/** Client picks another open time of the SAME session type. Price snapshot and history stay; calendar, Doc and reminders follow. */
export async function clientReschedule(bookingId: string, newSlotId: string): Promise<void> {
  const rules = await clientChangeRules(bookingId);
  if (!rules.canReschedule) throw new AppError("not_allowed", rules.reason ?? "Rescheduling isn't available for this session.", 403);
  const v = (await getBookingView(bookingId))!;
  const { getPublicAvailability } = await import("./availability");
  const av = await getPublicAvailability(v.seasonId, v.typeId);
  if (!av.slots.some((s) => s.id === newSlotId && s.id !== v.slotId)) throw new AppError("slot_unavailable", "That time isn't available. Please pick another.", 409);
  await rescheduleBooking(bookingId, newSlotId, "client");
  const db = await getDb();
  await enqueue(db, { kind: "email.owner_alert", bookingId, dedupeKey: `alert:client-moved:${bookingId}:${Date.now()}`, payload: { subject: `${v.ref} moved their session`, message: "A client moved their own session to a new time (allowed by your session settings). Their calendar event, Google Doc and reminders were updated." } });
}

export async function clientCancel(bookingId: string, reason = ""): Promise<void> {
  const rules = await clientChangeRules(bookingId);
  if (!rules.canCancel) throw new AppError("not_allowed", rules.reason ?? "Canceling isn't available for this session.", 403);
  const v = (await getBookingView(bookingId))!;
  await cancelBooking(bookingId, "client", reason);
  const db = await getDb();
  await enqueue(db, { kind: "email.owner_alert", bookingId, dedupeKey: `alert:client-canceled:${bookingId}`, payload: { subject: `${v.ref} canceled their session`, message: `A client canceled their own session${reason ? `: "${reason.slice(0, 300)}"` : ""}. The time is open again. Decide on their deposit per your refund terms (see Needs attention).` } });
}
