import { describe, it, expect, beforeEach } from "vitest";
import { getDb } from "@/lib/db";
import { updateSlot, addSlot, removeSlot, getPublicAvailability } from "@/lib/availability";
import { reserveSlot, applyPaymentEvent } from "@/lib/booking";
import { formatTime } from "@/lib/time";
import { processOutbox } from "@/lib/outbox";
import { saveSettings, getSettings } from "@/lib/settings";
import { buildRawMessage } from "@/lib/mail";
import { setup, makeSeason, makeSlots, fullIntake, inDays, count, TZ } from "./helpers";

beforeEach(async () => { await setup({}); });
const pay = (id: string) => applyPaymentEvent({ id: "e" + id, type: "checkout.session.completed", bookingId: id, sessionId: "cs", paid: true, amountCents: 500, currency: "usd", paymentIntent: "pi" });

describe("editing individual times", () => {
  it("moves one time to a new start and length without touching the others", async () => {
    const season = await makeSeason();
    const slots = await makeSlots(season.id, inDays(10), "10:00", "12:00", 30, 0);
    await updateSlot(slots[1].id, { date: inDays(10), startTime: "13:15", durationMin: 45 }, "t");
    const db = await getDb();
    const row = (await db.query(`select starts_at, ends_at from slots where id=$1`, [slots[1].id])).rows[0];
    expect(formatTime(row.starts_at, TZ)).toBe("1:15 PM");
    expect((row.ends_at - row.starts_at) / 60000).toBe(45);
    expect(await count(`select count(*)::int n from slots`)).toBe(4);
    const av = await getPublicAvailability(season.id);
    expect(av.slots.some((s) => s.id === slots[1].id)).toBe(true);
  });

  it("refuses overlaps, past times and impossible daylight-saving times", async () => {
    const season = await makeSeason();
    const slots = await makeSlots(season.id, inDays(10), "10:00", "11:00", 30, 0);
    await expect(updateSlot(slots[1].id, { date: inDays(10), startTime: "10:15", durationMin: 30 }, "t")).rejects.toMatchObject({ code: "overlap" });
    await expect(updateSlot(slots[1].id, { date: inDays(-2), startTime: "10:00", durationMin: 30 }, "t")).rejects.toMatchObject({ code: "past" });
    await expect(updateSlot(slots[1].id, { date: "2027-03-14", startTime: "02:30", durationMin: 30 }, "t")).rejects.toMatchObject({ code: "invalid" });
    await expect(updateSlot(slots[1].id, { date: inDays(10), startTime: "10:00", durationMin: 3 }, "t")).rejects.toMatchObject({ code: "invalid" });
  });

  it("never edits or removes a booked time", async () => {
    const season = await makeSeason();
    const [slot] = await makeSlots(season.id, inDays(10), "10:00", "10:30", 30, 0);
    const r = await reserveSlot({ slotId: slot.id, intake: fullIntake(), acceptedTerms: true });
    await pay(r.bookingId);
    await expect(updateSlot(slot.id, { date: inDays(10), startTime: "11:00", durationMin: 30 }, "t")).rejects.toMatchObject({ code: "booked" });
    await expect(removeSlot(slot.id, "t")).rejects.toMatchObject({ code: "booked" });
  });

  it("adds an extra one-off time, rejecting duplicates and overlaps", async () => {
    const season = await makeSeason();
    await makeSlots(season.id, inDays(10), "10:00", "11:00", 30, 0);
    await addSlot(season.id, { date: inDays(10), startTime: "15:00", durationMin: 60, bufferMin: 10 }, "t");
    expect(await count(`select count(*)::int n from slots`)).toBe(3);
    await expect(addSlot(season.id, { date: inDays(10), startTime: "15:00", durationMin: 60 }, "t")).rejects.toMatchObject({ code: "exists" });
    await expect(addSlot(season.id, { date: inDays(10), startTime: "10:10", durationMin: 20 }, "t")).rejects.toMatchObject({ code: "overlap" });
  });

  it("removes an unused time for good, but only hides one that has booking history", async () => {
    const season = await makeSeason();
    const slots = await makeSlots(season.id, inDays(10), "10:00", "11:00", 30, 0);
    expect(await removeSlot(slots[0].id, "t")).toBe("deleted");
    const r = await reserveSlot({ slotId: slots[1].id, intake: fullIntake(), acceptedTerms: true });
    const db = await getDb();
    await db.query(`update bookings set status='expired' where id=$1`, [r.bookingId]);
    expect(await removeSlot(slots[1].id, "t")).toBe("hidden");
    expect((await db.query(`select state from slots where id=$1`, [slots[1].id])).rows[0].state).toBe("closed");
  });
});

describe("booking emails", () => {
  it("emails the owner for every confirmed reservation, once, with the time and the answers", async () => {
    const c = await setup({ google: true });
    const season = await makeSeason();
    const slots = await makeSlots(season.id, inDays(10), "10:00", "11:00", 30, 0);
    for (const s of slots) { const r = await reserveSlot({ slotId: s.id, intake: fullIntake(), acceptedTerms: true }); await pay(r.bookingId); }
    await processOutbox(); await processOutbox();
    const toOwner = c.mail!.sent.filter((m) => m.to === "xanflorafauna@gmail.com" && /New booking/.test(m.subject));
    expect(toOwner).toHaveLength(2);
    expect(toOwner[0].text).toMatch(/When: .*(AM|PM)/);
    expect(toOwner[0].text).toContain("Natural laughter");
  });

  it("in demo mode only the owner is ever emailed; clients are never contacted", async () => {
    const c = await setup({ google: true });
    await saveSettings({ ...(await getSettings()), demoMode: true });
    const season = await makeSeason();
    const [slot] = await makeSlots(season.id, inDays(10), "10:00", "10:30", 30, 0);
    const r = await reserveSlot({ slotId: slot.id, intake: fullIntake(), acceptedTerms: true });
    await pay(r.bookingId);
    await processOutbox();
    expect(c.mail!.sent.some((m) => m.to === "jane@example.com")).toBe(false);
    expect(c.mail!.sent.some((m) => m.to === "xanflorafauna@gmail.com")).toBe(true);
    expect(await count(`select count(*)::int n from notifications where status='suppressed_demo'`)).toBeGreaterThan(0);
  });

  it("builds a valid UTF-8 Gmail message (accents, emoji, no header injection)", () => {
    const raw = buildRawMessage({ from: "Xan's Eye <a@b.com>", to: "x@y.com", subject: "Réservation 🌿\r\nBcc: evil@x.com", text: "Hello — plain", html: "<p>Hello — html</p>" });
    const msg = Buffer.from(raw, "base64url").toString("utf8");
    const head = msg.split("\r\n\r\n")[0];
    expect(head).toMatch(/^From: /m);
    expect(head).not.toMatch(/^Bcc:/m);
    const subj = /Subject: =\?UTF-8\?B\?(.+?)\?=/.exec(head)![1];
    expect(Buffer.from(subj, "base64").toString("utf8")).toContain("Réservation 🌿");
    expect(msg).toContain("multipart/alternative");
  });
});

describe("the weekly schedule respects your individual changes", () => {
  it("does not recreate a time you moved or removed, until you choose 'replace unbooked'", async () => {
    const { planSchedule, DEFAULT_SCHEDULE } = await import("@/lib/schedule");
    const { publishPlanned } = await import("@/lib/availability");
    const season = await makeSeason();
    const sch = { ...DEFAULT_SCHEDULE, weekly: [[], [], [], [], [], [], [{ start: "10:00", end: "11:30" }]], durationMin: 30, bufferMin: 0 };
    const plan = () => planSchedule(sch as any, TZ, inDays(1), inDays(40), inDays(0));
    await publishPlanned(season.id, plan(), "t", { quiet: true });
    const db = await getDb();
    const rows = (await db.query(`select id, starts_at from slots order by starts_at limit 3`)).rows;
    const date = new Date(rows[0].starts_at).toLocaleDateString("en-CA", { timeZone: TZ });
    await updateSlot(rows[0].id, { date, startTime: "14:00", durationMin: 30 }, "t");   // moved
    await removeSlot(rows[1].id, "t");                                                  // removed
    const again = await publishPlanned(season.id, plan(), "t", { quiet: true });
    expect(again.created).toBe(0);                                                        // neither comes back
    const starts = (await db.query(`select starts_at from slots`)).rows.map((r) => r.starts_at.getTime());
    const reset = await publishPlanned(season.id, plan(), "t", { quiet: true, replaceUnbooked: true });
    expect(reset.created).toBeGreaterThan(0);                                             // explicit reset restores usual hours
  });
});
