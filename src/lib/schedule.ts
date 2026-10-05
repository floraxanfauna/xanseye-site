import { z } from "zod";
import { planSlots, SlotPlanError, type PlannedSlot } from "./slots";
import { addDays, isValidDate, localDate } from "./time";

/**
 * Calendly-style recurring availability. Weekly hours say "I'm usually free these hours";
 * overrides handle one-off dates. Nothing is bookable until the owner publishes it.
 */
const HHMM = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
export const RangeSchema = z.object({ start: HHMM, end: z.union([HHMM, z.literal("24:00")]) });
export type Range = z.infer<typeof RangeSchema>;

export const ScheduleSchema = z.object({
  /** index 0 = Sunday … 6 = Saturday; empty array = not available that weekday */
  weekly: z.array(z.array(RangeSchema).max(4)).length(7),
  durationMin: z.number().int().min(10).max(480),
  bufferMin: z.number().int().min(0).max(240),
  windowFrom: z.string().nullable(),   // first date this schedule applies to
  windowTo: z.string().nullable(),     // last date (null = rolling horizon from settings)
  /** date -> custom ranges, or null = unavailable all day */
  overrides: z.array(z.object({ date: z.string(), ranges: z.array(RangeSchema).max(4).nullable() })).max(366),
  seasonId: z.string().uuid().nullable(),
  autoFill: z.boolean(),               // keep publishing newly-arriving dates automatically
});
export type Schedule = z.infer<typeof ScheduleSchema>;

export const DEFAULT_SCHEDULE: Schedule = {
  // Saturdays 10:00–12:30 as a starting example (index 6 = Saturday)
  weekly: [[], [], [], [], [], [], [{ start: "10:00", end: "12:30" }]],
  durationMin: 30, bufferMin: 15, windowFrom: null, windowTo: null, overrides: [], seasonId: null, autoFill: false,
};

export function validateSchedule(raw: unknown): Schedule {
  const s = ScheduleSchema.parse(raw);
  for (const d of s.weekly) checkRanges(d);
  for (const o of s.overrides) { if (!isValidDate(o.date)) throw new SlotPlanError(`Bad date ${o.date}`); if (o.ranges) checkRanges(o.ranges); }
  for (const d of [s.windowFrom, s.windowTo]) if (d && !isValidDate(d)) throw new SlotPlanError(`Bad date ${d}`);
  if (s.windowFrom && s.windowTo && s.windowTo < s.windowFrom) throw new SlotPlanError("The end date is before the start date");
  return s;
}
function checkRanges(rs: Range[]) {
  const sorted = [...rs].sort((a, b) => a.start.localeCompare(b.start));
  for (let i = 0; i < sorted.length; i++) {
    if (sorted[i].end !== "24:00" && sorted[i].end <= sorted[i].start) throw new SlotPlanError(`A range ends (${sorted[i].end}) before it starts (${sorted[i].start})`);
    if (i && sorted[i].start < sorted[i - 1].end) throw new SlotPlanError("Two time ranges on the same day overlap");
  }
}

export const weekdayOf = (date: string) => new Date(date + "T12:00:00Z").getUTCDay();

/** Ranges that apply on a local date: an override wins over the weekly rule. */
export function rangesFor(s: Schedule, date: string): Range[] {
  const o = s.overrides.find((x) => x.date === date);
  if (o) return o.ranges ?? [];
  return s.weekly[weekdayOf(date)] ?? [];
}

export interface DayPlan { date: string; slots: PlannedSlot[]; error?: string; source: "weekly" | "override" | "off" }

/** Generate concrete slots for every date from..to (inclusive). Errors (e.g. a DST gap) are reported per day, not thrown. */
export function planSchedule(s: Schedule, tz: string, from: string, to: string, todayLocal = localDate(new Date(), tz)): DayPlan[] {
  const out: DayPlan[] = [];
  const first = [from, s.windowFrom ?? from, todayLocal].reduce((a, b) => (a > b ? a : b));
  const last = s.windowTo && s.windowTo < to ? s.windowTo : to;
  for (let d = first, n = 0; d <= last && n < 400; d = addDays(d, 1), n++) {
    const override = s.overrides.find((x) => x.date === d);
    const ranges = rangesFor(s, d);
    if (!ranges.length) { out.push({ date: d, slots: [], source: "off" }); continue; }
    try {
      const slots: PlannedSlot[] = [];
      for (const r of ranges) {
        slots.push(...planSlots({ date: d, startTime: r.start, endTime: r.end === "24:00" ? "00:00" : r.end, durationMin: s.durationMin, bufferMin: s.bufferMin, tz }));
      }
      out.push({ date: d, slots, source: override ? "override" : "weekly" });
    } catch (e) {
      if (e instanceof SlotPlanError) out.push({ date: d, slots: [], error: e.message, source: override ? "override" : "weekly" });
      else throw e;
    }
  }
  return out;
}
