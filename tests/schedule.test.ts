import { describe, it, expect, beforeEach } from "vitest";
import { getDb } from "@/lib/db";
import { planSchedule, validateSchedule, DEFAULT_SCHEDULE, weekdayOf, type Schedule } from "@/lib/schedule";
import { publishPlanned, closeSlots } from "@/lib/availability";
import { autoFillSchedule, saveSchedule, previewSchedule, publishSchedule } from "@/lib/admin-api";
import { reserveSlot, applyPaymentEvent } from "@/lib/booking";
import { formatTime } from "@/lib/time";
import { setup, makeSeason, fullIntake, count, TZ } from "./helpers";

const base = (over: Partial<Schedule> = {}): Schedule => ({ ...DEFAULT_SCHEDULE, weekly: [[], [], [], [], [], [], [{ start: "10:00", end: "12:00" }]], durationMin: 30, bufferMin: 0, ...over });
// 2027-01-02 is a Saturday, 2027-01-03 a Sunday
const times = (d: { slots: { startsAt: Date }[] }) => d.slots.map((s) => formatTime(s.startsAt, TZ));

describe("weekly schedule engine", () => {
  it("weekday math is right", () => { expect(weekdayOf("2027-01-02")).toBe(6); expect(weekdayOf("2027-01-03")).toBe(0); });

  it("weekly hours generate only on the chosen weekdays; overrides win", () => {
    const s = base({ overrides: [{ date: "2027-01-09", ranges: null }, { date: "2027-01-16", ranges: [{ start: "14:00", end: "15:00" }] }] });
    const days = planSchedule(s, TZ, "2027-01-01", "2027-01-17", "2027-01-01");
    const by = Object.fromEntries(days.map((d) => [d.date, d]));
    expect(times(by["2027-01-02"])).toEqual(["10:00 AM", "10:30 AM", "11:00 AM", "11:30 AM"]);
    expect(by["2027-01-03"].slots).toHaveLength(0);
    expect(by["2027-01-09"].slots).toHaveLength(0);           // marked unavailable
    expect(times(by["2027-01-16"])).toEqual(["2:00 PM", "2:30 PM"]); // custom hours
  });

  it("supports two ranges in one day (morning + afternoon)", () => {
    const s = base({ weekly: [[], [], [], [], [], [], [{ start: "09:00", end: "10:00" }, { start: "13:00", end: "14:00" }]] });
    const d = planSchedule(s, TZ, "2027-01-02", "2027-01-02", "2027-01-01")[0];
    expect(times(d)).toEqual(["9:00 AM", "9:30 AM", "1:00 PM", "1:30 PM"]);
  });

  it("a nonexistent daylight-saving time is reported for that day instead of crashing", () => {
    const s = base({ weekly: [[{ start: "02:30", end: "04:00" }], [], [], [], [], [], []] }); // Sunday 2027-03-14 is spring-forward
    const d = planSchedule(s, TZ, "2027-03-14", "2027-03-14", "2027-03-01")[0];
    expect(d.error).toMatch(/does not exist/);
    expect(d.slots).toHaveLength(0);
  });

  it("respects the window and never plans the past", () => {
    const s = base({ windowFrom: "2027-01-09", windowTo: "2027-01-16" });
    const dates = planSchedule(s, TZ, "2027-01-01", "2027-02-01", "2027-01-01").filter((d) => d.slots.length).map((d) => d.date);
    expect(dates).toEqual(["2027-01-09", "2027-01-16"]);
    expect(planSchedule(base(), TZ, "2020-01-04", "2020-01-11", "2027-01-01")).toHaveLength(0);
  });

  it("rejects overlapping ranges and backwards ranges", () => {
    expect(() => validateSchedule(base({ weekly: [[], [], [], [], [], [], [{ start: "09:00", end: "11:00" }, { start: "10:00", end: "12:00" }]] }))).toThrow(/overlap/);
    expect(() => validateSchedule(base({ weekly: [[], [], [], [], [], [], [{ start: "12:00", end: "10:00" }]] }))).toThrow(/before/);
  });
});

describe("publishing a schedule", () => {
  beforeEach(async () => { await setup({}); });

  const run = async (seasonId: string, over: Partial<Schedule> = {}) => {
    const d = planSchedule(base(over), TZ, "2027-01-01", "2027-01-31", "2026-12-20");
    return publishPlanned(seasonId, d.filter((x) => !x.error), "t", { quiet: true });
  };

  it("is idempotent, and never re-opens a time the owner closed", async () => {
    const season = await makeSeason();
    const first = await run(season.id);
    expect(first.created).toBe(5 * 4); // 5 Saturdays x 4 slots
    const again = await run(season.id);
    expect(again.created).toBe(0);
    expect(again.alreadyPublished).toBe(20);
    const db = await getDb();
    const one = (await db.query(`select id from slots limit 1`)).rows[0].id;
    await closeSlots([one], "t");
    const third = await run(season.id);
    expect(third.created).toBe(0);
    expect(await count(`select count(*)::int n from slots where state='closed'`)).toBe(1);
  });

  it("replace-unbooked rebuilds the schedule but keeps booked sessions untouched", async () => {
    const season = await makeSeason();
    await run(season.id);
    const db = await getDb();
    const slot = (await db.query(`select * from slots where starts_at > now() + interval '1 day' order by starts_at limit 1`)).rows[0];
    const r = await reserveSlot({ slotId: slot.id, intake: fullIntake(), acceptedTerms: true });
    await applyPaymentEvent({ id: "e1", type: "checkout.session.completed", bookingId: r.bookingId, sessionId: "cs", paid: true, amountCents: 500, currency: "usd", paymentIntent: "pi" });
    const days = planSchedule(base({ weekly: [[], [], [], [], [], [], [{ start: "13:00", end: "14:00" }]] }), TZ, "2027-01-01", "2027-01-31", "2026-12-20");
    const out = await publishPlanned(season.id, days, "t", { replaceUnbooked: true, quiet: true });
    expect(out.removed).toBe(19);
    const v = (await db.query(`select status, starts_at from bookings`)).rows[0];
    expect(v.status).toBe("confirmed");
    expect((await db.query(`select 1 from slots where id=$1`, [slot.id])).rows).toHaveLength(1);
    expect(out.created).toBeGreaterThan(0);
  });

  it("skips times that overlap a live booking instead of forcing them", async () => {
    const season = await makeSeason();
    await run(season.id);
    const db = await getDb();
    const slot = (await db.query(`select * from slots order by starts_at limit 1`)).rows[0];
    await reserveSlot({ slotId: slot.id, intake: fullIntake(), acceptedTerms: true });
    await db.query(`delete from slots where id <> $1`, [slot.id]);
    const days = planSchedule(base({ weekly: [[], [], [], [], [], [], [{ start: "10:15", end: "11:15" }]] }), TZ, "2027-01-02", "2027-01-02", "2026-12-20");
    const out = await publishPlanned(season.id, days, "t");
    expect(out.skippedConflicts.length).toBeGreaterThan(0);
  });

  it("auto-fill only runs when switched on and the season is live", async () => {
    const season = await makeSeason();
    expect(await autoFillSchedule()).toBeNull();
    await saveSchedule({ ...base(), seasonId: season.id, autoFill: true });
    const out = await autoFillSchedule();
    expect(out).toBeTruthy();
    expect(await count(`select count(*)::int n from slots`)).toBeGreaterThan(0);
    const pv = await previewSchedule();
    expect(pv.days.some((d) => d.slots.some((s) => s.published))).toBe(true);
    const again = await publishSchedule({}, { email: "x" });
    expect(again.created).toBe(0);
  });
});
