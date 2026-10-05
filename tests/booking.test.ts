import { describe, it, expect, beforeEach } from "vitest";
import { getDb } from "@/lib/db";
import { reserveSlot, applyPaymentEvent, releaseExpiredHolds, saveIntake, cancelBooking, rescheduleBooking, getBookingView, VersionConflict } from "@/lib/booking";
import { getPublicAvailability, publishSlots } from "@/lib/availability";
import { saveSettings, getSettings } from "@/lib/settings";
import { makeSeason, makeSlots, setup, naIntake, fullIntake, count, inDays, FakePayments } from "./helpers";
import { processOutbox } from "@/lib/outbox";

let ctx: Awaited<ReturnType<typeof setup>>;
beforeEach(async () => { ctx = await setup({ google: true }); });

const paidEvent = (bookingId: string, id = "evt_" + Math.random(), over: any = {}) => ({
  id, type: "checkout.session.completed", bookingId, sessionId: `cs_${bookingId}`, paid: true, amountCents: 500, currency: "usd", paymentIntent: "pi_" + bookingId, ...over,
});

async function bookAndPay(slotId: string, intake = fullIntake()) {
  const r = await reserveSlot({ slotId, intake, acceptedTerms: true });
  await applyPaymentEvent(paidEvent(r.bookingId));
  return r;
}

describe("reservation and double-booking", () => {
  it("two clients racing for one slot: exactly one wins", async () => {
    const season = await makeSeason();
    const [slot] = await makeSlots(season.id);
    const results = await Promise.allSettled([
      reserveSlot({ slotId: slot.id, intake: fullIntake(), acceptedTerms: true }),
      reserveSlot({ slotId: slot.id, intake: fullIntake({ name: { state: "answered", value: "Other Person" } }), acceptedTerms: true }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const lost = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(lost.reason.code).toBe("slot_unavailable");
    expect(await count(`select count(*)::int n from bookings where status='hold'`)).toBe(1);
  });

  it("only one calendar event and one doc exist after the winner's jobs are replayed", async () => {
    const season = await makeSeason();
    const [slot] = await makeSlots(season.id);
    const r = await bookAndPay(slot.id);
    await processOutbox(); await processOutbox();
    const db = await getDb();
    // replay: same payment event + same job keys
    await applyPaymentEvent(paidEvent(r.bookingId, "evt_replay"));
    await processOutbox();
    expect(ctx.google!.events.size).toBe(1);
    expect(ctx.google!.docs.size).toBe(1);
    expect(await count(`select count(*)::int n from outbox where kind='calendar.upsert'`)).toBe(1);
    void db;
  });

  it("rejects overlapping slots across seasons and across buffers (database-level)", async () => {
    const a = await makeSeason("Season A");
    const b = await makeSeason("Season B");
    await makeSlots(a.id, inDays(10), "10:00", "10:30", 30, 15); // occupies 10:00-10:45
    const res = await publishSlots({ seasonId: b.id, dates: [inDays(10)], startTime: "10:30", endTime: "11:30", durationMin: 30, bufferMin: 0 }, "t");
    // 10:30 and 11:00 -> 10:30 conflicts with A's buffer, 11:00 is fine
    expect(res.skippedConflicts).toHaveLength(1);
    expect(res.created).toBe(1);
    const db = await getDb();
    await expect(db.query(`insert into slots(season_id, starts_at, ends_at, buffer_end) select season_id, starts_at + interval '5 minutes', ends_at, buffer_end from slots limit 1`)).rejects.toMatchObject({ code: "23P01" });
  });

  it("a booked slot can't be re-published or closed behind the client's back", async () => {
    const season = await makeSeason();
    const [slot] = await makeSlots(season.id);
    const r = await bookAndPay(slot.id);
    const { closeSlots } = await import("@/lib/availability");
    const out = await closeSlots([slot.id], "t");
    expect(out.closed).toBe(0);
    expect(out.refused[0].id).toBe(slot.id);
    const v = await getBookingView(r.bookingId);
    expect(v!.status).toBe("confirmed");
  });

  it("buffer between sessions is enforced for bookings", async () => {
    const season = await makeSeason();
    const slots = await makeSlots(season.id, inDays(10), "10:00", "12:00", 30, 15);
    expect(slots.length).toBeGreaterThanOrEqual(2);
    const r1 = await reserveSlot({ slotId: slots[0].id, intake: fullIntake(), acceptedTerms: true });
    const av = await getPublicAvailability(season.id);
    expect(av.slots.find((s) => s.id === slots[0].id)).toBeUndefined();
    expect(r1.checkoutUrl).toContain("checkout.test");
  });

  it("requires terms, honors the pause switch and max per day", async () => {
    const season = await makeSeason();
    const slots = await makeSlots(season.id);
    await expect(reserveSlot({ slotId: slots[0].id, intake: fullIntake(), acceptedTerms: false })).rejects.toMatchObject({ code: "terms" });
    await saveSettings({ maxPerDay: 1 });
    await reserveSlot({ slotId: slots[0].id, intake: fullIntake(), acceptedTerms: true });
    await expect(reserveSlot({ slotId: slots[1].id, intake: fullIntake(), acceptedTerms: true })).rejects.toMatchObject({ code: "day_full" });
    await saveSettings({ paused: true, maxPerDay: 6 });
    await expect(reserveSlot({ slotId: slots[2].id, intake: fullIntake(), acceptedTerms: true })).rejects.toMatchObject({ code: "paused" });
    expect((await getPublicAvailability(season.id)).paused).toBe(true);
  });

  it("blocks payment (no hold left behind) when Stripe can't create a checkout", async () => {
    const season = await makeSeason();
    const [slot] = await makeSlots(season.id);
    ctx.pay.failCreate = true;
    await expect(reserveSlot({ slotId: slot.id, intake: fullIntake(), acceptedTerms: true })).rejects.toMatchObject({ code: "payment_unavailable" });
    expect(await count(`select count(*)::int n from bookings where status='hold'`)).toBe(0);
    ctx.pay.failCreate = false;
    await reserveSlot({ slotId: slot.id, intake: fullIntake(), acceptedTerms: true }); // slot is bookable again
  });

  it("refuses to take payment when the external calendar can't be verified, and respects busy time", async () => {
    const season = await makeSeason();
    const [slot] = await makeSlots(season.id);
    ctx.google!.down = true;
    await expect(reserveSlot({ slotId: slot.id, intake: fullIntake(), acceptedTerms: true })).rejects.toMatchObject({ code: "conflict_check_failed" });
    ctx.google!.down = false;
    ctx.google!.busy = [{ s: new Date(slot.starts_at.getTime() - 60_000), e: new Date(slot.ends_at.getTime() + 60_000) }];
    await expect(reserveSlot({ slotId: slot.id, intake: fullIntake(), acceptedTerms: true })).rejects.toMatchObject({ code: "slot_unavailable" });
    const { clearBusyCache } = await import("@/lib/google/busy");
    clearBusyCache();
    const av = await getPublicAvailability(season.id);
    expect(av.slots.find((s) => s.id === slot.id)).toBeUndefined();
  });
});

describe("N/A semantics", () => {
  it("every question can be N/A; contact-less booking is flagged and nothing claims an email was sent", async () => {
    const season = await makeSeason();
    const [slot] = await makeSlots(season.id);
    const r = await bookAndPay(slot.id, naIntake());
    const v = (await getBookingView(r.bookingId))!;
    expect(v.status).toBe("confirmed");
    expect(v.intake.email).toEqual({ state: "na" });
    expect(v.contactMissing).toBe(true);
    expect(await count(`select count(*)::int n from tasks where kind='contact_followup'`)).toBe(1);
    await processOutbox();
    expect(ctx.mail!.sent.map((m) => m.subject).some((s) => /you're booked/i.test(s))).toBe(false); // no client email without an address
    expect(await count(`select count(*)::int n from outbox where kind='email.client_confirmation'`)).toBe(0);
    expect(ctx.mail!.sent.some((m) => m.to === "xanflorafauna@gmail.com")).toBe(true); // owner still notified
  });

  it("unanswered (neither answered nor N/A) is rejected, and N/A is never stored as a value", async () => {
    const season = await makeSeason();
    const [slot] = await makeSlots(season.id);
    const bad = fullIntake({ hopes: { state: "unanswered" } });
    await expect(reserveSlot({ slotId: slot.id, intake: bad, acceptedTerms: true })).rejects.toMatchObject({ code: "unanswered" });
    await expect(reserveSlot({ slotId: slot.id, intake: fullIntake({ email: { state: "answered", value: "N/A" } }), acceptedTerms: true })).rejects.toMatchObject({ code: "invalid" });
    await expect(reserveSlot({ slotId: slot.id, intake: fullIntake({ peopleCount: { state: "answered", value: "N/A" as any } }), acceptedTerms: true })).rejects.toMatchObject({ code: "invalid" });
  });

  it("phone-only clients get an owner follow-up task and no email promise", async () => {
    const season = await makeSeason();
    const [slot] = await makeSlots(season.id);
    await bookAndPay(slot.id, fullIntake({ email: { state: "na" }, phone: { state: "answered", value: "(555) 123-4567" } }));
    expect(await count(`select count(*)::int n from tasks where kind='contact_followup' and message like '%phone%'`)).toBe(1);
  });
});

describe("payments", () => {
  it("failed or abandoned checkout never confirms; hold is released only after reconciliation", async () => {
    const season = await makeSeason();
    const [slot] = await makeSlots(season.id);
    const r = await reserveSlot({ slotId: slot.id, intake: fullIntake(), acceptedTerms: true });
    const db = await getDb();
    await db.query(`update bookings set hold_expires_at = now() - interval '1 minute' where id=$1`, [r.bookingId]);
    ctx.pay.failGet = true; // provider unreachable: must NOT release
    let out = await releaseExpiredHolds();
    expect(out).toMatchObject({ released: 0, skipped: 1 });
    ctx.pay.failGet = false;
    out = await releaseExpiredHolds();
    expect(out.released).toBe(1);
    expect((await getBookingView(r.bookingId))).toBeTruthy();
    expect(await count(`select count(*)::int n from bookings where status='confirmed'`)).toBe(0);
    expect(ctx.pay.sessions.get(`cs_${r.bookingId}`)!.status).toBe("expired");
  });

  it("cleanup never frees a paid booking whose webhook is late; it confirms it", async () => {
    const season = await makeSeason();
    const [slot] = await makeSlots(season.id);
    const r = await reserveSlot({ slotId: slot.id, intake: fullIntake(), acceptedTerms: true });
    ctx.pay.markPaid(`cs_${r.bookingId}`);
    const db = await getDb();
    await db.query(`update bookings set hold_expires_at = now() - interval '1 minute' where id=$1`, [r.bookingId]);
    const out = await releaseExpiredHolds();
    expect(out).toMatchObject({ confirmed: 1, released: 0 });
    expect((await getBookingView(r.bookingId))!.status).toBe("confirmed");
  });

  it("a duplicate event is ignored; an out-of-order expiry cannot undo a paid booking", async () => {
    const season = await makeSeason();
    const [slot] = await makeSlots(season.id);
    const r = await reserveSlot({ slotId: slot.id, intake: fullIntake(), acceptedTerms: true });
    expect(await applyPaymentEvent(paidEvent(r.bookingId, "evt_1"))).toBe("confirmed");
    expect(await applyPaymentEvent(paidEvent(r.bookingId, "evt_1"))).toBe("duplicate_event");
    expect(await applyPaymentEvent({ ...paidEvent(r.bookingId, "evt_2"), type: "checkout.session.expired", paid: false })).toBe("ignored");
    expect((await getBookingView(r.bookingId))!.status).toBe("confirmed");
    expect(await count(`select count(*)::int n from payments where booking_id=$1 and status='paid'`, [r.bookingId])).toBe(1);
  });

  it("tampered amount or currency is not confirmed and raises an owner task", async () => {
    const season = await makeSeason();
    const [slot] = await makeSlots(season.id);
    const r = await reserveSlot({ slotId: slot.id, intake: fullIntake(), acceptedTerms: true });
    expect(await applyPaymentEvent(paidEvent(r.bookingId, "e1", { amountCents: 1 }))).toBe("review_mismatch");
    expect((await getBookingView(r.bookingId))!.status).toBe("review");
    expect(await count(`select count(*)::int n from tasks where kind='payment_anomaly'`)).toBe(1);
    const r2 = await reserveSlot({ slotId: (await makeSlots(season.id, inDays(11)))[0].id, intake: fullIntake(), acceptedTerms: true });
    expect(await applyPaymentEvent(paidEvent(r2.bookingId, "e2", { currency: "eur" }))).toBe("review_mismatch");
  });

  it("late payment after the slot was rebooked never double-books; owner gets a task", async () => {
    const season = await makeSeason();
    const [slot] = await makeSlots(season.id);
    const first = await reserveSlot({ slotId: slot.id, intake: fullIntake(), acceptedTerms: true });
    const db = await getDb();
    await db.query(`update bookings set status='expired' where id=$1`, [first.bookingId]); // hold lapsed
    const second = await reserveSlot({ slotId: slot.id, intake: fullIntake({ name: { state: "answered", value: "Second" } }), acceptedTerms: true });
    await applyPaymentEvent(paidEvent(second.bookingId, "e_second"));
    expect(await applyPaymentEvent(paidEvent(first.bookingId, "e_late"))).toBe("review_slot_taken");
    expect((await getBookingView(first.bookingId))!.status).toBe("review");
    expect((await getBookingView(second.bookingId))!.status).toBe("confirmed");
    expect(await count(`select count(*)::int n from bookings where status='confirmed' and slot_id=$1`, [slot.id])).toBe(1);
    expect(await count(`select count(*)::int n from tasks where kind='paid_slot_taken'`)).toBe(1);
  });

  it("quote snapshot is not rewritten when page prices change later", async () => {
    const season = await makeSeason();
    const [slot] = await makeSlots(season.id);
    const r = await bookAndPay(slot.id);
    const { saveDraft, publishSeason, getSeason } = await import("@/lib/seasons");
    const s = (await getSeason(season.id))!;
    await saveDraft(season.id, { ...s.draft, facts: { ...s.draft.facts, sessionPriceCents: 99900 } });
    await publishSeason(season.id, "t");
    const v = (await getBookingView(r.bookingId))!;
    expect(v.quote.sessionPriceCents).toBe(15000);
    expect(v.quote.depositCents).toBe(500);
  });
});

describe("intake saves, notifications and mirrors", () => {
  it("each material save = one revision and one owner email; a no-op save is quiet", async () => {
    const season = await makeSeason();
    const [slot] = await makeSlots(season.id);
    const r = await bookAndPay(slot.id);
    await processOutbox();
    const baseline = ctx.mail!.sent.length;

    const next = fullIntake({ hopes: { state: "answered", value: "Lots of giggles" } });
    expect(await saveIntake(r.bookingId, fullIntake(), 1)).toMatchObject({ changed: false, version: 1 });
    const s1 = await saveIntake(r.bookingId, next, 1);
    expect(s1).toMatchObject({ changed: true, version: 2 });
    await processOutbox(); await processOutbox();
    const changed = ctx.mail!.sent.slice(baseline).filter((m) => /Form updated/.test(m.subject));
    expect(changed).toHaveLength(1);
    expect(changed[0].text).toContain("Lots of giggles");
    expect(changed[0].text).toContain("Natural laughter"); // before value
    expect(await count(`select count(*)::int n from intake_revisions where booking_id=$1`, [r.bookingId])).toBe(2);
    expect(await count(`select count(*)::int n from outbox where kind='email.owner_intake_changed'`)).toBe(1);
    expect(ctx.google!.docs.get(r.bookingId)!.body).toContain("Lots of giggles");
  });

  it("a stale browser can't overwrite newer answers", async () => {
    const season = await makeSeason();
    const [slot] = await makeSlots(season.id);
    const r = await bookAndPay(slot.id);
    await saveIntake(r.bookingId, fullIntake({ hopes: { state: "answered", value: "from phone" } }), 1);
    await expect(saveIntake(r.bookingId, fullIntake({ hopes: { state: "answered", value: "from old laptop tab" } }), 1)).rejects.toBeInstanceOf(VersionConflict);
    expect((await getBookingView(r.bookingId))!.intake.hopes).toEqual({ state: "answered", value: "from phone" });
  });

  it("the Doc mirror always writes the latest answers even if an old job runs late", async () => {
    const season = await makeSeason();
    const [slot] = await makeSlots(season.id);
    const r = await bookAndPay(slot.id);
    await saveIntake(r.bookingId, fullIntake({ hopes: { state: "answered", value: "v2 text" } }), 1);
    await saveIntake(r.bookingId, fullIntake({ hopes: { state: "answered", value: "v3 text" } }), 2);
    await processOutbox(50); await processOutbox(50);
    for (const w of ctx.google!.docWrites) expect(w).not.toContain("Natural laughter v1-only");
    expect(ctx.google!.docs.get(r.bookingId)!.body).toContain("v3 text");
    expect(ctx.google!.docs.get(r.bookingId)!.body).not.toContain("v2 text");
  });

  it("when Google is down the saved answers stay in the database, email still goes out, and sync recovers on retry", async () => {
    const season = await makeSeason();
    const [slot] = await makeSlots(season.id);
    const r = await bookAndPay(slot.id);
    await processOutbox();
    ctx.google!.down = true;
    await saveIntake(r.bookingId, fullIntake({ hopes: { state: "answered", value: "during outage" } }), 1);
    const before = ctx.mail!.sent.length;
    await processOutbox();
    expect((await getBookingView(r.bookingId))!.intake.hopes).toEqual({ state: "answered", value: "during outage" });
    expect(ctx.mail!.sent.slice(before).some((m) => /Form updated/.test(m.subject))).toBe(true); // owner still notified
    expect(await count(`select count(*)::int n from outbox where kind='doc.upsert' and status='pending' and attempts>0`)).toBe(1);
    ctx.google!.down = false;
    const db = await getDb();
    await db.query(`update outbox set run_at=now() where status='pending'`);
    await processOutbox();
    expect(ctx.google!.docs.get(r.bookingId)!.body).toContain("during outage");
  });

  it("when email is down the intake is saved and the email retries later (no loss)", async () => {
    const season = await makeSeason();
    const [slot] = await makeSlots(season.id);
    const r = await bookAndPay(slot.id);
    await processOutbox();
    ctx.mail!.fail = true;
    await saveIntake(r.bookingId, fullIntake({ hopes: { state: "answered", value: "email outage" } }), 1);
    await processOutbox();
    const db = await getDb();
    expect(await count(`select count(*)::int n from outbox where kind='email.owner_intake_changed' and status='pending'`)).toBe(1);
    ctx.mail!.fail = false;
    await db.query(`update outbox set run_at=now() where status='pending'`);
    const before = ctx.mail!.sent.length;
    await processOutbox();
    expect(ctx.mail!.sent.length).toBeGreaterThan(before);
  });

  it("with Google not connected, jobs wait ('blocked') instead of pretending to sync", async () => {
    const c2 = await setup({ google: false });
    const season = await makeSeason();
    const [slot] = await makeSlots(season.id);
    const r = await reserveSlot({ slotId: slot.id, intake: fullIntake(), acceptedTerms: true });
    await applyPaymentEvent(paidEvent(r.bookingId));
    const out = await processOutbox();
    expect(out.blocked).toBeGreaterThanOrEqual(2); // calendar + doc
    const v = (await getBookingView(r.bookingId))!;
    expect(v.docUrl).toBeNull();
    expect(v.calendarEventId).toBeNull();
    const text = c2.mail!.sent.find((m) => /New booking/.test(m.subject))!.text;
    expect(text).toMatch(/Google isn't connected/);
  });

  it("changing the beauty-editing choice adds an owner task and never charges", async () => {
    const season = await makeSeason();
    const [slot] = await makeSlots(season.id);
    const r = await bookAndPay(slot.id);
    await saveIntake(r.bookingId, fullIntake({ beautyEdit: { state: "answered", value: "yes" } }), 1);
    expect(await count(`select count(*)::int n from tasks where kind='editing_changed'`)).toBe(1);
    const v = (await getBookingView(r.bookingId))!;
    expect(v.paidCents).toBe(500);
    const { balanceSummary } = await import("@/lib/booking");
    const b = balanceSummary(v.quote, "yes", v.paidCents);
    expect(b.beautyDueCents).toBe(4000); // $40 TOTAL for two photos, not per photo
    expect(b.balanceDueCents).toBe(15000 - 500 + 4000);
  });
});

describe("cancel and reschedule", () => {
  it("reschedule moves the same booking, keeps price snapshot and history, re-arms reminders and Doc/event", async () => {
    const season = await makeSeason();
    const slotsA = await makeSlots(season.id, inDays(10));
    const slotsB = await makeSlots(season.id, inDays(12));
    const r = await bookAndPay(slotsA[0].id);
    await processOutbox();
    const before = (await getBookingView(r.bookingId))!;
    await rescheduleBooking(r.bookingId, slotsB[0].id, "owner");
    await processOutbox(); await processOutbox();
    const after = (await getBookingView(r.bookingId))!;
    expect(after.startsAt.getTime()).toBe(slotsB[0].starts_at.getTime());
    expect(after.quote).toEqual(before.quote);
    expect(ctx.google!.events.get(r.bookingId).start.getTime()).toBe(slotsB[0].starts_at.getTime());
    expect(ctx.google!.docs.size).toBe(1);
    expect(ctx.google!.docs.get(r.bookingId)!.folderPath).toContain(slotsB[0].starts_at.toISOString().slice(0, 4));
    expect(await count(`select count(*)::int n from audit_events where action='booking.reschedule'`)).toBe(1);
    // old time is free again
    expect((await getPublicAvailability(season.id)).slots.some((s) => s.id === slotsA[0].id)).toBe(true);
    // reminders for the OLD time are canceled
    expect(await count(`select count(*)::int n from outbox where kind='email.client_reminder' and status='canceled'`)).toBeGreaterThan(0);
  });

  it("cancel frees the slot, cancels reminders and the event, flags the refund decision, keeps history", async () => {
    const season = await makeSeason();
    const [slot] = await makeSlots(season.id);
    const r = await bookAndPay(slot.id);
    await processOutbox();
    await cancelBooking(r.bookingId, "owner", "client asked");
    await processOutbox();
    const v = (await getBookingView(r.bookingId))!;
    expect(v.status).toBe("canceled");
    expect(v.paymentStatus).toBe("refund_pending");
    expect(ctx.google!.events.get(r.bookingId).canceled).toBe(true);
    expect(await count(`select count(*)::int n from tasks where kind='refund_decision'`)).toBe(1);
    expect(await count(`select count(*)::int n from intake_revisions where booking_id=$1`, [r.bookingId])).toBe(1);
    expect((await getPublicAvailability(season.id)).slots.some((s) => s.id === slot.id)).toBe(true);
  });

  it("reminders: never scheduled for thresholds already in the past", async () => {
    const season = await makeSeason();
    await saveSettings({ minNoticeHours: 1 });
    const db = await getDb();
    const slots = await makeSlots(season.id, inDays(1)); // ~1 day away: 48h reminder already past
    const r = await bookAndPay(slots[slots.length - 1].id);
    const rows = (await db.query(`select payload from outbox where kind='email.client_reminder' and booking_id=$1`, [r.bookingId])).rows;
    expect(rows.map((x) => x.payload.hours)).not.toContain(48);
    const s = await getSettings();
    expect(s.reminderHours).toContain(48);
  });
});

void FakePayments;
