import { zonedToUtc, addDays, isValidDate, localDate, NonexistentLocalTime, AmbiguousLocalTime } from "./time";

export interface SlotPlanInput {
  date: string;            // YYYY-MM-DD in the venue timezone
  startTime: string;       // HH:MM local
  endTime: string;         // HH:MM local (range end; no slot may run past it)
  durationMin: number;     // session length
  bufferMin: number;       // gap after each session before the next may start
  breaks?: { start: string; end: string }[]; // HH:MM local intervals with no sessions
  tz: string;
}

export interface PlannedSlot { startsAt: Date; endsAt: Date; bufferEnd: Date; localStart: string; localEnd: string }

export class SlotPlanError extends Error {}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * Generate session start/end instants for one local day.
 * Slots step by (duration + buffer) in *elapsed* minutes, so a session is always exactly
 * `durationMin` long even across a DST change. Half-open: a slot may end exactly at the range
 * end, never past it. Throws on bad input, non-existent or repeated local times.
 */
export function planSlots(i: SlotPlanInput): PlannedSlot[] {
  if (!isValidDate(i.date)) throw new SlotPlanError(`Invalid date ${i.date}`);
  if (!HHMM.test(i.startTime) || !HHMM.test(i.endTime)) throw new SlotPlanError("Times must look like 10:00");
  if (!Number.isInteger(i.durationMin) || i.durationMin < 10 || i.durationMin > 480) throw new SlotPlanError("Session length must be 10 to 480 minutes");
  if (!Number.isInteger(i.bufferMin) || i.bufferMin < 0 || i.bufferMin > 240) throw new SlotPlanError("Buffer must be 0 to 240 minutes");

  let rangeStart: Date, rangeEnd: Date;
  try {
    rangeStart = zonedToUtc(i.date, i.startTime, i.tz, "reject");
    rangeEnd = i.endTime === "00:00" ? zonedToUtc(addDays(i.date, 1), "00:00", i.tz, "reject") : zonedToUtc(i.date, i.endTime, i.tz, "reject");
  } catch (e) {
    if (e instanceof NonexistentLocalTime || e instanceof AmbiguousLocalTime) throw new SlotPlanError(e.message + ". Pick a different start or end time.");
    throw e;
  }
  if (rangeEnd <= rangeStart) throw new SlotPlanError("End time must be after start time");
  if (rangeEnd.getTime() - rangeStart.getTime() > 16 * 3600_000) throw new SlotPlanError("A single day range can be at most 16 hours");

  const breaks = (i.breaks ?? []).map((b) => {
    if (!HHMM.test(b.start) || !HHMM.test(b.end)) throw new SlotPlanError("Break times must look like 12:00");
    const s = zonedToUtc(i.date, b.start, i.tz, "earlier");
    const e = zonedToUtc(i.date, b.end, i.tz, "earlier");
    if (e <= s) throw new SlotPlanError("A break must end after it starts");
    return { s, e };
  });

  const out: PlannedSlot[] = [];
  const stepMs = (i.durationMin + i.bufferMin) * 60_000;
  const durMs = i.durationMin * 60_000;
  for (let t = rangeStart.getTime(); t + durMs <= rangeEnd.getTime(); t += stepMs) {
    const s = new Date(t), e = new Date(t + durMs);
    if (breaks.some((b) => s < b.e && e > b.s)) continue; // half-open overlap test
    const bufferEnd = new Date(e.getTime() + i.bufferMin * 60_000);
    out.push({ startsAt: s, endsAt: e, bufferEnd, localStart: s.toISOString(), localEnd: e.toISOString() });
  }
  return out;
}

/** Range-overlap test for half-open intervals. */
export const overlaps = (a: { s: Date; e: Date }, b: { s: Date; e: Date }) => a.s < b.e && b.s < a.e;

export const dayOf = localDate;
