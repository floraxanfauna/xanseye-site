import { getDb } from "../db";

/**
 * External conflict source: free/busy of the Google calendars the owner selected.
 * The dedicated "Mini Sessions" calendar is never a conflict source (our own events would block themselves).
 * Apple-only (iCloud) events can NOT be seen here — block those times manually or move them to a selected Google calendar.
 */
export type BusyResult =
  | { status: "not_connected"; busy: [] }
  | { status: "ok"; busy: { s: Date; e: Date }[] }
  | { status: "error"; busy: []; message: string };

type Fetcher = (from: Date, to: Date) => Promise<{ s: Date; e: Date }[]>;
let fetcher: Fetcher | null = null; // installed by google/client.ts at runtime (and by tests)
export function setBusyFetcher(f: Fetcher | null) { fetcher = f; }

const cache = new Map<string, { at: number; value: BusyResult }>();
export function clearBusyCache() { cache.clear(); }

export async function getBusy(from: Date, to: Date): Promise<BusyResult> {
  if (!fetcher) {
    const { installGoogleBusyFetcher } = await import("./client");
    await installGoogleBusyFetcher();
  }
  const f = fetcher;
  if (!f) return { status: "not_connected", busy: [] };
  const key = `${Math.floor(from.getTime() / 3600_000)}:${Math.floor(to.getTime() / 3600_000)}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 60_000) return hit.value;
  try {
    const value: BusyResult = { status: "ok", busy: await f(from, to) };
    cache.set(key, { at: Date.now(), value });
    return value;
  } catch (e) {
    return { status: "error", busy: [], message: e instanceof Error ? e.message : String(e) };
  }
}

export const overlapsBusy = (busy: { s: Date; e: Date }[], start: Date, end: Date) => busy.some((b) => start < b.e && b.s < end);

/** Fresh (uncached) check used immediately before taking a payment hold. */
export async function checkSlotFree(start: Date, end: Date): Promise<"free" | "busy" | "unchecked" | "error"> {
  cache.clear();
  const r = await getBusy(new Date(start.getTime() - 3600_000), new Date(end.getTime() + 3600_000));
  if (r.status === "not_connected") return "unchecked";
  if (r.status === "error") return "error";
  return overlapsBusy(r.busy, start, end) ? "busy" : "free";
}

export async function externalConflictsConfigured(): Promise<boolean> {
  const db = await getDb();
  const r = await db.query(`select status, meta from integrations where provider='google'`);
  return r.rows[0]?.status === "connected";
}
