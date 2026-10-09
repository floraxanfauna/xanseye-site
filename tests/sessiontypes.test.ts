import { describe, it, expect, beforeEach } from "vitest";
import { getDb } from "@/lib/db";
import { createType, ensureDefaultType, listTypes, updateType, removeType, getType, typeToSchedule, renderTemplate } from "@/lib/sessiontypes";
import { getPublicAvailability, publishPlanned, removeSlot } from "@/lib/availability";
import { planSchedule } from "@/lib/schedule";
import { reserveSlot, applyPaymentEvent, clientChangeRules, clientReschedule, clientCancel, getBookingView } from "@/lib/booking";
import { processOutbox } from "@/lib/outbox";
import { setup, makeSeason, makeSlots, fullIntake, count, inDays, TZ } from "./helpers";

let ctx: Awaited<ReturnType<typeof setup>>;
beforeEach(async () => { ctx = await setup({ google: true }); });
const pay = (id: string, amt = 500) => applyPaymentEvent({ id: "e" + id, type: "checkout.session.completed", bookingId: id, sessionId: "cs", paid: true, amountCents: amt, currency: "usd", paymentIntent: "pi" });

async function twoTypes() {
  const season = await makeSeason();
  const a = (await listTypes({ seasonId: season.id }))[0];
  const b = await createType(season.id, "Family Session", { durationMin: 45, bufferMin: 15, priceCents: 45000, depositCents: 2500, maxPeople: 6, minNoticeHours: 1 });
  return { season, a, b };
}
const slotsFor = async (seasonId: string, typeId: string, date: string, start: string, end: string, dur: number, buf: number) => {
  const sch = { weekly: [[], [], [], [], [], [], []], durationMin: dur, bufferMin: buf, intervalMin: null, windowFrom: null, windowTo: null, overrides: [], seasonId, autoFill: false } as any;
  const days = planSchedule({ ...sch, weekly: Array.from({ length: 7 }, () => [{ start, end }]) }, TZ, date, date, inDays(0));
  await publishPlanned(seasonId, days, "t", { typeId, quiet: true });
  const db = await getDb();
  return (await db.query(`select * from slots where session_type_id=$1 order by starts_at`, [typeId])).rows;
};

describe("session types", () => {
  it("every season gets a default type, and old slots/bookings are attached to it", async () => {
    const season = await makeSeason();
    const types = await listTypes({ seasonId: season.id });
    expect(types).toHaveLength(1);
    expect(types[0].name).toBe("Mini Session");
    const slots = await makeSlots(season.id);
    expect(slots.every((s) => s.session_type_id === types[0].id)).toBe(true);
  });

  it("each type only offers its own times, but there is still ONE photographer across all types", async () => {
    const { season, a, b } = await twoTypes();
    await slotsFor(season.id, a.id, inDays(10), "10:00", "11:00", 30, 0);
    const avA = await getPublicAvailability(season.id, a.id);
    const avB = await getPublicAvailability(season.id, b.id);
    expect(avA.slots.length).toBe(2);
    expect(avB.slots.length).toBe(0);
    // type B tries the same hour: the overlap protection refuses it
    const days = planSchedule({ ...typeToSchedule(b), weekly: Array.from({ length: 7 }, () => [{ start: "10:00", end: "10:45" }]) }, TZ, inDays(10), inDays(10), inDays(0));
    const out = await publishPlanned(season.id, days, "t", { typeId: b.id });
    expect(out.created).toBe(0);
    expect(out.skippedConflicts.length).toBeGreaterThan(0);
  });

  it("a booking uses its own type's price, deposit, length and people limit", async () => {
    const { season, a, b } = await twoTypes();
    const [slot] = await slotsFor(season.id, b.id, inDays(10), "13:00", "13:45", 45, 15);
    await expect(reserveSlot({ slotId: slot.id, intake: fullIntake({ peopleCount: { state: "answered", value: 9 } }), acceptedTerms: true })).rejects.toMatchObject({ code: "too_many_people" });
    const r = await reserveSlot({ slotId: slot.id, intake: fullIntake({ peopleCount: { state: "answered", value: 5 } }), acceptedTerms: true });
    expect(ctx.pay.createCalls.at(-1)!.amountCents).toBe(2500);
    await pay(r.bookingId, 2500);
    const v = (await getBookingView(r.bookingId))!;
    expect(v.quote).toMatchObject({ typeName: "Family Session", sessionPriceCents: 45000, depositCents: 2500, durationMin: 45 });
    expect(v.typeId).toBe(b.id);
    void a;
  });

  it("per-type minimum notice and booking window are respected", async () => {
    const { season, a } = await twoTypes();
    await slotsFor(season.id, a.id, inDays(2), "10:00", "11:00", 30, 0);
    expect((await getPublicAvailability(season.id, a.id)).slots.length).toBe(2);
    await updateType(a.id, { config: { minNoticeHours: 24 * 5 } }, "t");
    expect((await getPublicAvailability(season.id, a.id)).slots.length).toBe(0);
    await updateType(a.id, { config: { minNoticeHours: 1, window: { kind: "rolling", rollingDays: 1, from: null, to: null } } }, "t");
    expect((await getPublicAvailability(season.id, a.id)).slots.length).toBe(0); // 2 days out is beyond a 1-day rolling window
  });

  it("start times can be spaced wider than length+break, but never closer", async () => {
    const { season, a } = await twoTypes();
    await updateType(a.id, { config: { durationMin: 30, bufferMin: 0, intervalMin: 60 } }, "t");
    const t = (await getType(a.id))!;
    const day = planSchedule({ ...typeToSchedule(t), weekly: Array.from({ length: 7 }, () => [{ start: "10:00", end: "13:00" }]) }, TZ, inDays(9), inDays(9), inDays(0))[0];
    expect(day.slots).toHaveLength(3);
    await expect(updateType(a.id, { config: { durationMin: 30, bufferMin: 15, intervalMin: 30 } }, "t")).rejects.toMatchObject({ code: "invalid" });
    void season;
  });

  it("reminders come from the type: custom count, timing and wording", async () => {
    const { season, a } = await twoTypes();
    await updateType(a.id, { config: { reminders: [{ hoursBefore: 24, subject: "See you soon, {first_name}!", body: "Your {session} is {when}. Manage it: {manage_link}" }] } }, "t");
    const [slot] = await slotsFor(season.id, a.id, inDays(10), "10:00", "10:30", 30, 0);
    const r = await reserveSlot({ slotId: slot.id, intake: fullIntake(), acceptedTerms: true });
    await pay(r.bookingId);
    const rows = (await (await getDb()).query(`select payload from outbox where kind='email.client_reminder'`)).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0].payload.hours).toBe(24);
    expect(renderTemplate("Hi {first_name} {when}", { first_name: "Jane", when: "Sat" })).toBe("Hi Jane Sat");
  });

  it("confirmation message appears in the client email; the email can be switched off per type", async () => {
    const { season, a } = await twoTypes();
    await updateType(a.id, { config: { confirmationMessage: "Wear something cozy. Bring a blanket!" } }, "t");
    const [s1, s2] = await slotsFor(season.id, a.id, inDays(10), "10:00", "11:00", 30, 0);
    const r1 = await reserveSlot({ slotId: s1.id, intake: fullIntake(), acceptedTerms: true });
    await pay(r1.bookingId);
    await processOutbox(); await processOutbox();
    expect(ctx.mail!.sent.find((m) => m.to === "jane@example.com")!.text).toContain("Bring a blanket!");
    await updateType(a.id, { config: { sendConfirmationEmail: false } }, "t");
    const r2 = await reserveSlot({ slotId: s2.id, intake: fullIntake({ email: { state: "answered", value: "second@example.com" } }), acceptedTerms: true });
    await pay(r2.bookingId);
    expect(await count(`select count(*)::int n from outbox where kind='email.client_confirmation' and booking_id=$1`, [r2.bookingId])).toBe(0);
  });

  it("removing a time in one type does not affect another type's times (per-type memory)", async () => {
    const { season, a, b } = await twoTypes();
    const [x] = await slotsFor(season.id, a.id, inDays(10), "10:00", "10:30", 30, 0);
    await removeSlot(x.id, "t");
    const db = await getDb();
    expect((await db.query(`select count(*)::int n from slot_exceptions where session_type_id=$1`, [a.id])).rows[0].n).toBe(1);
    expect((await db.query(`select count(*)::int n from slot_exceptions where session_type_id=$1`, [b.id])).rows[0].n).toBe(0);
  });

  it("deleting a type: unused = deleted, used = switched off, the last one is protected", async () => {
    const { season, a, b } = await twoTypes();
    const [slot] = await slotsFor(season.id, b.id, inDays(10), "10:00", "10:45", 45, 0);
    const r = await reserveSlot({ slotId: slot.id, intake: fullIntake(), acceptedTerms: true });
    await pay(r.bookingId);
    expect(await removeType(b.id, "t")).toBe("deactivated");
    expect((await getType(b.id))!.active).toBe(false);
    expect((await getPublicAvailability(season.id, b.id)).slots).toHaveLength(0);
    const c = await createType(season.id, "Extra");
    expect(await removeType(c.id, "t")).toBe("deleted");
    await removeType(b.id, "t").catch(() => {});
    await expect(removeType(a.id, "t")).resolves.toBeDefined(); // b still exists (inactive) so a may go
    const left = await listTypes({ seasonId: season.id });
    await expect(removeType(left[0].id, "t")).rejects.toMatchObject({ code: "last_type" });
  });
});

describe("clients changing their own booking", () => {
  async function booked(cfg: any, startInDays = 10) {
    const { season, a, b } = await twoTypes();
    await updateType(a.id, { config: cfg }, "t");
    const slots = await slotsFor(season.id, a.id, inDays(startInDays), "10:00", "12:00", 30, 0);
    const other = await slotsFor(season.id, b.id, inDays(startInDays + 1), "10:00", "10:45", 45, 0);
    const r = await reserveSlot({ slotId: slots[0].id, intake: fullIntake(), acceptedTerms: true });
    await pay(r.bookingId);
    return { season, a, slots, other, bookingId: r.bookingId };
  }

  it("is off by default: the rules say changes go through the owner", async () => {
    const { bookingId } = await booked({});
    expect(await clientChangeRules(bookingId)).toMatchObject({ canReschedule: false, canCancel: false });
    await expect(clientCancel(bookingId)).rejects.toMatchObject({ code: "not_allowed" });
  });

  it("reschedule: only to open times of the same type, calendar/doc/reminders follow, owner is alerted", async () => {
    const { slots, other, bookingId } = await booked({ allowClientReschedule: true, clientChangeCutoffHours: 48 });
    await processOutbox();
    await expect(clientReschedule(bookingId, other[0].id)).rejects.toMatchObject({ code: "slot_unavailable" }); // other type
    await clientReschedule(bookingId, slots[2].id);
    await processOutbox(); await processOutbox();
    const v = (await getBookingView(bookingId))!;
    expect(v.slotId).toBe(slots[2].id);
    expect(ctx.google!.events.get(bookingId).start.getTime()).toBe(slots[2].starts_at.getTime());
    expect(ctx.mail!.sent.some((m) => /moved their session/.test(m.subject))).toBe(true);
    await expect(clientCancel(bookingId)).rejects.toMatchObject({ code: "not_allowed" }); // cancel toggle is off
  });

  it("cancel: frees the time, flags the refund decision, alerts the owner", async () => {
    const { slots, bookingId } = await booked({ allowClientCancel: true });
    await clientCancel(bookingId, "sick kiddo");
    await processOutbox();
    expect((await getBookingView(bookingId))!.status).toBe("canceled");
    expect(await count(`select count(*)::int n from tasks where kind='refund_decision'`)).toBe(1);
    expect(ctx.mail!.sent.some((m) => /canceled their session/.test(m.subject) && /sick kiddo/.test(m.text))).toBe(true);
    expect((await getPublicAvailability((await getBookingView(bookingId))!.seasonId, (await getBookingView(bookingId))!.typeId)).slots.some((s) => s.id === slots[0].id)).toBe(true);
  });

  it("inside the notice period clients can't change it themselves", async () => {
    const { bookingId } = await booked({ allowClientReschedule: true, allowClientCancel: true, clientChangeCutoffHours: 24 * 30 });
    const rules = await clientChangeRules(bookingId);
    expect(rules).toMatchObject({ canReschedule: false, canCancel: false });
    expect(rules.reason).toMatch(/within 720 hours/);
  });
});
