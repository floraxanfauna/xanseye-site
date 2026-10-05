/**
 * Timezone math with no dependencies. Instants are UTC `Date`s; wall-clock times are always
 * interpreted in an explicit IANA zone (default comes from settings, seeded America/Denver).
 * Never hard-code an offset: Mountain Time is MST in winter and MDT in summer.
 */

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function dtf(tz: string): Intl.DateTimeFormat {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    });
    fmtCache.set(tz, f);
  }
  return f;
}

export interface LocalParts { y: number; mo: number; d: number; h: number; mi: number; s: number }

export function localParts(instant: Date, tz: string): LocalParts {
  const o: Record<string, number> = {};
  for (const p of dtf(tz).formatToParts(instant)) if (p.type !== "literal") o[p.type] = Number(p.value);
  return { y: o.year, mo: o.month, d: o.day, h: o.hour === 24 ? 0 : o.hour, mi: o.minute, s: o.second };
}

/** Offset (ms) of `tz` from UTC at `instant`. */
export function tzOffsetMs(instant: Date, tz: string): number {
  const p = localParts(instant, tz);
  const asUtc = Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s);
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

export class NonexistentLocalTime extends Error {
  constructor(public local: string, tz: string) { super(`${local} does not exist in ${tz} (clocks skip forward)`); }
}
export class AmbiguousLocalTime extends Error {
  constructor(public local: string, tz: string) { super(`${local} happens twice in ${tz} (clocks fall back)`); }
}

export type Disambiguation = "earlier" | "later" | "reject";

/**
 * Convert a wall-clock time in `tz` to a UTC instant.
 * - Non-existent times (spring-forward gap) always throw NonexistentLocalTime.
 * - Repeated times (fall-back) follow `disambiguate`; default "reject" so callers must choose.
 */
export function zonedToUtc(date: string, time: string, tz: string, disambiguate: Disambiguation = "reject"): Date {
  const [y, mo, d] = date.split("-").map(Number);
  const [h, mi] = time.split(":").map(Number);
  const guess = Date.UTC(y, mo - 1, d, h, mi, 0);
  const offsets = new Set<number>();
  for (const delta of [-36, -12, 0, 12, 36]) offsets.add(tzOffsetMs(new Date(guess + delta * 3600_000), tz));
  const valid: number[] = [];
  for (const off of offsets) {
    const t = guess - off;
    const p = localParts(new Date(t), tz);
    if (p.y === y && p.mo === mo && p.d === d && p.h === h && p.mi === mi) valid.push(t);
  }
  const uniq = [...new Set(valid)].sort((a, b) => a - b);
  const label = `${date} ${time}`;
  if (uniq.length === 0) throw new NonexistentLocalTime(label, tz);
  if (uniq.length === 1) return new Date(uniq[0]);
  if (disambiguate === "reject") throw new AmbiguousLocalTime(label, tz);
  return new Date(disambiguate === "earlier" ? uniq[0] : uniq[uniq.length - 1]);
}

export const ymd = (p: { y: number; mo: number; d: number }) =>
  `${p.y}-${String(p.mo).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`;

/** Calendar date (YYYY-MM-DD) of an instant in `tz`. */
export function localDate(instant: Date, tz: string): string {
  return ymd(localParts(instant, tz));
}

export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return t.toISOString().slice(0, 10);
}

export function isValidDate(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const t = new Date(date + "T00:00:00Z");
  return !Number.isNaN(t.getTime()) && t.toISOString().slice(0, 10) === date;
}

/** [start, end) instants for the whole local calendar day, correct on 23h/25h days. */
export function localDayRange(date: string, tz: string): { start: Date; end: Date } {
  const start = firstInstantOfLocalDay(date, tz);
  const end = firstInstantOfLocalDay(addDays(date, 1), tz);
  return { start, end };
}

function firstInstantOfLocalDay(date: string, tz: string): Date {
  // Midnight can be skipped by DST in some zones; walk forward to the first valid minute.
  for (let m = 0; m < 180; m++) {
    const hh = String(Math.floor(m / 60)).padStart(2, "0");
    const mm = String(m % 60).padStart(2, "0");
    try { return zonedToUtc(date, `${hh}:${mm}`, tz, "earlier"); } catch (e) { if (!(e instanceof NonexistentLocalTime)) throw e; }
  }
  throw new Error("no valid time in day");
}

export function formatTime(instant: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" }).format(instant);
}
export function formatDateLong(instant: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "long", month: "long", day: "numeric", year: "numeric" }).format(instant);
}
export function formatDateShort(instant: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", month: "short", day: "numeric" }).format(instant);
}
/** "MST" / "MDT" — date-specific, never assumed. */
export function tzAbbrev(instant: Date, tz: string): string {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "short" }).formatToParts(instant);
  return parts.find((p) => p.type === "timeZoneName")?.value ?? tz;
}
/** Friendly zone name, e.g. "Mountain Time". */
export function tzLongName(instant: Date, tz: string): string {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "longGeneric" }).formatToParts(instant);
  return parts.find((p) => p.type === "timeZoneName")?.value ?? tz;
}
export function formatWhen(instant: Date, tz: string): string {
  return `${formatDateLong(instant, tz)} at ${formatTime(instant, tz)} ${tzAbbrev(instant, tz)}`;
}
