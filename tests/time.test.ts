import { describe, it, expect } from "vitest";
import { zonedToUtc, localDayRange, tzAbbrev, NonexistentLocalTime, AmbiguousLocalTime, formatTime, localDate } from "@/lib/time";
import { planSlots, SlotPlanError } from "@/lib/slots";

const TZ = "America/Denver";

describe("timezone conversion", () => {
  it("uses MDT in summer and MST in winter (never a fixed offset)", () => {
    expect(zonedToUtc("2026-07-07", "10:00", TZ).toISOString()).toBe("2026-07-07T16:00:00.000Z");
    expect(zonedToUtc("2026-11-14", "10:00", TZ).toISOString()).toBe("2026-11-14T17:00:00.000Z");
    expect(tzAbbrev(new Date("2026-07-07T16:00:00Z"), TZ)).toBe("MDT");
    expect(tzAbbrev(new Date("2026-11-14T17:00:00Z"), TZ)).toBe("MST");
  });

  it("rejects the non-existent spring-forward hour (2026-03-08 02:30)", () => {
    expect(() => zonedToUtc("2026-03-08", "02:30", TZ)).toThrow(NonexistentLocalTime);
    expect(zonedToUtc("2026-03-08", "03:00", TZ).toISOString()).toBe("2026-03-08T09:00:00.000Z");
  });

  it("makes the caller choose for the repeated fall-back hour (2026-11-01 01:30)", () => {
    expect(() => zonedToUtc("2026-11-01", "01:30", TZ)).toThrow(AmbiguousLocalTime);
    expect(zonedToUtc("2026-11-01", "01:30", TZ, "earlier").toISOString()).toBe("2026-11-01T07:30:00.000Z");
    expect(zonedToUtc("2026-11-01", "01:30", TZ, "later").toISOString()).toBe("2026-11-01T08:30:00.000Z");
  });

  it("local day is 23h on spring-forward and 25h on fall-back", () => {
    const sf = localDayRange("2026-03-08", TZ);
    expect((sf.end.getTime() - sf.start.getTime()) / 3600_000).toBe(23);
    const fb = localDayRange("2026-11-01", TZ);
    expect((fb.end.getTime() - fb.start.getTime()) / 3600_000).toBe(25);
  });

  it("assigns instants near midnight to the right local date", () => {
    expect(localDate(new Date("2026-11-15T06:59:00Z"), TZ)).toBe("2026-11-14");
    expect(localDate(new Date("2026-11-15T07:00:00Z"), TZ)).toBe("2026-11-15");
  });
});

describe("slot planning", () => {
  it("generates 30 minute sessions with 15 minute buffers", () => {
    const s = planSlots({ date: "2026-11-14", startTime: "10:00", endTime: "12:00", durationMin: 30, bufferMin: 15, tz: TZ });
    expect(s.map((x) => formatTime(x.startsAt, TZ))).toEqual(["10:00 AM", "10:45 AM", "11:30 AM"]);
    // 11:30 session ends exactly 12:00 = range end (allowed, half-open)
    expect(s.at(-1)!.endsAt.toISOString()).toBe("2026-11-14T19:00:00.000Z");
  });

  it("never produces a partial slot past the range end", () => {
    const s = planSlots({ date: "2026-11-14", startTime: "10:00", endTime: "11:20", durationMin: 30, bufferMin: 0, tz: TZ });
    expect(s).toHaveLength(2);
  });

  it("skips sessions that touch a lunch break but allows ones that end exactly at its start", () => {
    const s = planSlots({ date: "2026-11-14", startTime: "11:00", endTime: "14:00", durationMin: 30, bufferMin: 0, breaks: [{ start: "12:00", end: "13:00" }], tz: TZ });
    expect(s.map((x) => formatTime(x.startsAt, TZ))).toEqual(["11:00 AM", "11:30 AM", "1:00 PM", "1:30 PM"]);
  });

  it("keeps sessions exactly the requested length across a DST change", () => {
    const s = planSlots({ date: "2026-03-08", startTime: "01:00", endTime: "04:00", durationMin: 30, bufferMin: 0, tz: TZ });
    for (const x of s) expect(x.endsAt.getTime() - x.startsAt.getTime()).toBe(30 * 60_000);
    expect(s).toHaveLength(2 + 2); // 01:00,01:30, then 03:00,03:30 (02:xx does not exist)
  });

  it("rejects a start time that does not exist and bad input", () => {
    expect(() => planSlots({ date: "2026-03-08", startTime: "02:30", endTime: "04:00", durationMin: 30, bufferMin: 0, tz: TZ })).toThrow(SlotPlanError);
    expect(() => planSlots({ date: "2026-11-14", startTime: "12:00", endTime: "10:00", durationMin: 30, bufferMin: 0, tz: TZ })).toThrow(SlotPlanError);
    expect(() => planSlots({ date: "2026-11-14", startTime: "10:00", endTime: "12:00", durationMin: 3, bufferMin: 0, tz: TZ })).toThrow(SlotPlanError);
    expect(() => planSlots({ date: "2026-02-31", startTime: "10:00", endTime: "12:00", durationMin: 30, bufferMin: 0, tz: TZ })).toThrow(SlotPlanError);
  });
});
