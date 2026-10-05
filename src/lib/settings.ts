import { getDb, type Q } from "./db";
import { DEFAULT_SCHEDULE, type Schedule } from "./schedule";

export interface ChecklistItem { key: string; label: string }

export interface AppSettings {
  /** While true: demo banner, demo values allowed, mock providers allowed. Must be false to take live bookings. */
  demoMode: boolean;
  paused: boolean;
  timezone: string;
  ownerEmail: string;
  currency: "usd";
  depositCents: number;       // booking deposit, default $5
  beautyEditCents: number;    // TOTAL for two photos, default $40 — not per photo
  holdMinutes: number;        // >= 30 (Stripe Checkout minimum expiry)
  minNoticeHours: number;
  horizonDays: number;
  maxPerDay: number;
  maxPeople: number;
  reminderHours: number[];
  runSheetLocalTime: string;  // HH:MM
  retentionDraftDays: number;
  postChecklist: ChecklistItem[];
  prepChecklist: ChecklistItem[];
  schedule: Schedule;
}

export const DEFAULT_SETTINGS: AppSettings = {
  schedule: DEFAULT_SCHEDULE,
  demoMode: true,
  paused: false,
  timezone: "America/Denver",
  ownerEmail: "xanflorafauna@gmail.com",
  currency: "usd",
  depositCents: 500,
  beautyEditCents: 4000,
  holdMinutes: 30,
  minNoticeHours: 24,
  horizonDays: 120,
  maxPerDay: 6,
  maxPeople: 10,
  reminderHours: [48, 24],
  runSheetLocalTime: "07:00",
  retentionDraftDays: 14,
  postChecklist: [
    { key: "photographed", label: "Photographed" },
    { key: "backed_up", label: "Backed up (2 places)" },
    { key: "selecting", label: "Selecting favorites" },
    { key: "editing", label: "Editing" },
    { key: "gallery_sent", label: "Gallery sent" },
  ],
  prepChecklist: [
    { key: "batteries", label: "Batteries charged" },
    { key: "cards", label: "Memory cards formatted" },
    { key: "lenses", label: "Lenses cleaned" },
    { key: "props", label: "Props / blanket packed" },
    { key: "brief", label: "Read today's session briefs" },
  ],
};

export async function getSettings(q?: Q): Promise<AppSettings> {
  const db = q ?? (await getDb());
  const r = await db.query<{ data: Partial<AppSettings> }>(`select data from app_settings where id = 1`);
  return { ...DEFAULT_SETTINGS, ...(r.rows[0]?.data ?? {}) };
}

export async function saveSettings(patch: Partial<AppSettings>, q?: Q): Promise<AppSettings> {
  const db = q ?? (await getDb());
  const next = { ...(await getSettings(db)), ...patch };
  next.holdMinutes = Math.max(30, Math.min(next.holdMinutes, 1440)); // Stripe Checkout can't expire sooner than 30 min
  next.depositCents = Math.max(0, Math.round(next.depositCents));
  await db.query(
    `insert into app_settings(id, data) values (1, $1) on conflict (id) do update set data = $1, updated_at = now()`,
    [JSON.stringify(next)],
  );
  return next;
}
