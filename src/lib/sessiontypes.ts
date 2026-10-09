import { z } from "zod";
import { getDb, type Q } from "./db";
import { AppError, audit } from "./core";
import { RangeSchema, DEFAULT_SCHEDULE, validateSchedule, type Schedule } from "./schedule";
import { addDays, localDate } from "./time";
import { getSettings } from "./settings";

/**
 * A session type is one thing a client can book: its own name, length, price, hours, booking rules,
 * confirmation message, reminders and shareable link. Modeled on how HoneyBook sets up scheduling.
 */
const Reminder = z.object({
  hoursBefore: z.number().int().min(1).max(336),
  subject: z.string().trim().max(150),
  body: z.string().trim().max(2000),   // empty = use the built-in friendly reminder
});

export const TypeConfigSchema = z.object({
  // details
  durationMin: z.number().int().min(10).max(480),
  priceCents: z.number().int().min(0).max(1_000_000).nullable(),      // null = use the season page's price
  depositCents: z.number().int().min(0).max(100_000).nullable(),      // null = use the site-wide deposit
  maxPeople: z.number().int().min(1).max(50),
  location: z.string().trim().max(200),                               // "" = use the season page's location
  instructions: z.string().trim().max(1500),                          // shown to clients while booking
  // availability
  weekly: z.array(z.array(RangeSchema).max(4)).length(7),
  overrides: z.array(z.object({ date: z.string(), ranges: z.array(RangeSchema).max(4).nullable() })).max(366),
  // booking rules
  bufferMin: z.number().int().min(0).max(240),
  intervalMin: z.number().int().min(5).max(480).nullable(),
  minNoticeHours: z.number().int().min(0).max(24 * 90),
  window: z.object({ kind: z.enum(["indefinite", "rolling", "fixed"]), rollingDays: z.number().int().min(1).max(730), from: z.string().nullable(), to: z.string().nullable() }),
  autoFill: z.boolean(),
  // after booking
  confirmationMessage: z.string().trim().max(1500),
  sendConfirmationEmail: z.boolean(),
  allowClientReschedule: z.boolean(),
  allowClientCancel: z.boolean(),
  clientChangeCutoffHours: z.number().int().min(0).max(720),
  reminders: z.array(Reminder).max(2),
});
export type TypeConfig = z.infer<typeof TypeConfigSchema>;

export interface SessionType { id: string; seasonId: string; slug: string; name: string; active: boolean; sortOrder: number; color: string; config: TypeConfig }

export const DEFAULT_REMINDERS = [
  { hoursBefore: 48, subject: "", body: "" },
  { hoursBefore: 24, subject: "", body: "" },
];

export function defaultTypeConfig(over: Partial<TypeConfig> = {}): TypeConfig {
  return {
    durationMin: 30, priceCents: null, depositCents: null, maxPeople: 10, location: "", instructions: "",
    weekly: structuredClone(DEFAULT_SCHEDULE.weekly), overrides: [],
    bufferMin: 15, intervalMin: null, minNoticeHours: 24,
    window: { kind: "indefinite", rollingDays: 60, from: null, to: null }, autoFill: false,
    confirmationMessage: "", sendConfirmationEmail: true, allowClientReschedule: false, allowClientCancel: false, clientChangeCutoffHours: 48,
    reminders: structuredClone(DEFAULT_REMINDERS),
    ...over,
  };
}

export function parseTypeConfig(raw: unknown): TypeConfig {
  return TypeConfigSchema.parse({ ...defaultTypeConfig(), ...(raw as object) });
}

const slugify = (s: string) => s.toLowerCase().replace(/['’]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 50) || "session";

function rowToType(r: any): SessionType {
  return { id: r.id, seasonId: r.season_id, slug: r.slug, name: r.name, active: r.active, sortOrder: r.sort_order, color: r.color, config: parseTypeConfig(r.config) };
}

export async function listTypes(opts: { seasonId?: string; activeOnly?: boolean } = {}, q?: Q): Promise<SessionType[]> {
  const db = q ?? (await getDb());
  const r = await db.query(
    `select * from session_types where ($1::uuid is null or season_id = $1) and ($2::boolean is false or active) order by sort_order, created_at`,
    [opts.seasonId ?? null, !!opts.activeOnly],
  );
  return r.rows.map(rowToType);
}
export async function getType(id: string, q?: Q): Promise<SessionType | null> {
  const db = q ?? (await getDb());
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const r = await db.query(`select * from session_types where id=$1`, [id]);
  return r.rows[0] ? rowToType(r.rows[0]) : null;
}
export async function getTypeBySlug(slug: string, q?: Q): Promise<SessionType | null> {
  const db = q ?? (await getDb());
  const r = await db.query(`select * from session_types where slug=$1`, [slug]);
  return r.rows[0] ? rowToType(r.rows[0]) : null;
}

async function uniqueSlug(q: Q, name: string): Promise<string> {
  const base = slugify(name);
  let slug = base, n = 2;
  while ((await q.query(`select 1 from session_types where slug=$1`, [slug])).rows.length) slug = `${base}-${n++}`;
  return slug;
}

export async function createType(seasonId: string, name: string, over: Partial<TypeConfig> = {}, q?: Q, color?: string): Promise<SessionType> {
  const db = q ?? (await getDb());
  const clean = name.trim();
  if (!clean) throw new AppError("invalid", "Give the session type a name.", 422);
  if (!(await db.query(`select 1 from seasons where id=$1`, [seasonId])).rows.length) throw new AppError("not_found", "Season not found", 404);
  const slug = await uniqueSlug(db, clean);
  const n = (await db.query(`select coalesce(max(sort_order),-1)+1 as n from session_types where season_id=$1`, [seasonId])).rows[0].n;
  const r = await db.query(
    `insert into session_types(season_id, slug, name, sort_order, color, config) values ($1,$2,$3,$4,$5,$6) returning *`,
    [seasonId, slug, clean, n, color ?? "#1F4D37", JSON.stringify(parseTypeConfig(over))],
  );
  return rowToType(r.rows[0]);
}

/** Every season always has at least one session type, so slots and bookings always have a home. */
export async function ensureDefaultType(q: Q, seasonId: string): Promise<string> {
  const have = (await q.query(`select id from session_types where season_id=$1 order by sort_order, created_at limit 1`, [seasonId])).rows[0];
  let id: string = have?.id;
  if (!id) {
    const s = await getSettings(q);
    const sch = s.schedule ?? DEFAULT_SCHEDULE;
    const season = (await q.query(`select name, draft from seasons where id=$1`, [seasonId])).rows[0];
    const facts = (season?.draft?.facts ?? {}) as { durationMin?: number | null; sessionPriceCents?: number | null; location?: string };
    id = (await createType(seasonId, "Mini Session", {
      durationMin: sch.durationMin ?? facts.durationMin ?? 30, bufferMin: sch.bufferMin, weekly: sch.weekly, overrides: sch.overrides,
      priceCents: facts.sessionPriceCents ?? null, location: "", minNoticeHours: s.minNoticeHours, autoFill: !!sch.autoFill,
      reminders: (s.reminderHours?.length ? s.reminderHours.slice(0, 2) : [48, 24]).map((h: number) => ({ hoursBefore: h, subject: "", body: "" })),
      window: sch.windowFrom || sch.windowTo ? { kind: "fixed", rollingDays: 60, from: sch.windowFrom, to: sch.windowTo } : { kind: "indefinite", rollingDays: 60, from: null, to: null },
    }, q)).id;
  }
  await q.query(`update slots set session_type_id=$2 where season_id=$1 and session_type_id is null`, [seasonId, id]);
  await q.query(`update bookings set session_type_id=$2 where season_id=$1 and session_type_id is null`, [seasonId, id]);
  return id;
}

/** Runs once at startup (after migrations): old seasons get a default type and their slots/bookings are attached to it. */
export async function backfillSessionTypes(db: Q) {
  const seasons = (await db.query(`select id from seasons`)).rows;
  for (const s of seasons) await ensureDefaultType(db, s.id);
}

export interface TypeUpdate { name?: string; color?: string; active?: boolean; sortOrder?: number; config?: Partial<TypeConfig> }

export async function updateType(id: string, patch: TypeUpdate, actor: string): Promise<SessionType> {
  const db = await getDb();
  const cur = await getType(id);
  if (!cur) throw new AppError("not_found", "Session type not found", 404);
  let config: TypeConfig;
  try { config = parseTypeConfig({ ...cur.config, ...(patch.config ?? {}) }); }
  catch (e: any) { throw new AppError("invalid", e?.issues ? e.issues.map((i: any) => `${i.path.join(".")}: ${i.message}`).join("; ") : "Those settings aren't valid.", 422); }
  // availability and spacing must make sense together
  try {
    validateSchedule(typeToSchedule({ ...cur, config }));
  } catch (e: any) { throw new AppError("invalid", e?.issues ? e.issues.map((i: any) => i.message).join("; ") : e.message, 422); }
  if (config.intervalMin != null && config.intervalMin < config.durationMin + config.bufferMin)
    throw new AppError("invalid", `Start times can't be closer together than the session length plus the break (${config.durationMin + config.bufferMin} minutes).`, 422);
  if (config.window.kind === "fixed" && (!config.window.from || !config.window.to || config.window.to < config.window.from))
    throw new AppError("invalid", "Pick a start and end date for the booking window (the end can't be before the start).", 422);
  const name = (patch.name ?? cur.name).trim();
  if (!name) throw new AppError("invalid", "Give the session type a name.", 422);
  if (patch.color && !/^#[0-9a-fA-F]{6}$/.test(patch.color)) throw new AppError("invalid", "Use a color like #1F4D37.", 422);
  const r = await db.query(
    `update session_types set name=$2, color=$3, active=$4, sort_order=$5, config=$6, updated_at=now() where id=$1 returning *`,
    [id, name, patch.color ?? cur.color, patch.active ?? cur.active, patch.sortOrder ?? cur.sortOrder, JSON.stringify(config)],
  );
  await audit(db, actor, "sessiontype.update", null, { id });
  return rowToType(r.rows[0]);
}

export async function duplicateType(id: string, name: string, actor: string): Promise<SessionType> {
  const cur = await getType(id);
  if (!cur) throw new AppError("not_found", "Session type not found", 404);
  const t = await createType(cur.seasonId, name, structuredClone(cur.config), undefined, cur.color);
  await audit(await getDb(), actor, "sessiontype.duplicate", null, { from: id, id: t.id });
  return t;
}

/** Delete a type that was never used; otherwise just switch it off so history stays intact. */
export async function removeType(id: string, actor: string): Promise<"deleted" | "deactivated"> {
  const db = await getDb();
  const t = await getType(id);
  if (!t) throw new AppError("not_found", "Session type not found", 404);
  const others = (await db.query(`select count(*)::int n from session_types where season_id=$1 and id<>$2`, [t.seasonId, id])).rows[0].n;
  if (!others) throw new AppError("last_type", "A season needs at least one session type. Edit this one instead, or add another first.", 409);
  const used = (await db.query(`select (select count(*) from bookings where session_type_id=$1) + (select count(*) from slots s where s.session_type_id=$1 and exists (select 1 from bookings b where b.slot_id=s.id)) as n`, [id])).rows[0].n;
  if (Number(used) > 0) { await db.query(`update session_types set active=false, updated_at=now() where id=$1`, [id]); await audit(db, actor, "sessiontype.deactivate", null, { id }); return "deactivated"; }
  await db.query(`delete from slots where session_type_id=$1`, [id]);
  await db.query(`delete from session_types where id=$1`, [id]);
  await audit(db, actor, "sessiontype.delete", null, { id });
  return "deleted";
}

// ---------------------------------------------------------------- bridges to the schedule engine

export function typeToSchedule(t: SessionType, now = new Date(), tz = "America/Denver"): Schedule {
  const c = t.config;
  const today = localDate(now, tz);
  const w = c.window;
  const windowFrom = w.kind === "fixed" ? w.from : null;
  const windowTo = w.kind === "fixed" ? w.to : w.kind === "rolling" ? addDays(today, w.rollingDays) : null;
  return { weekly: c.weekly, durationMin: c.durationMin, bufferMin: c.bufferMin, intervalMin: c.intervalMin, windowFrom, windowTo, overrides: c.overrides, seasonId: t.seasonId, autoFill: c.autoFill };
}

/** The first and last instants clients may book this type, given its window, minimum notice and the site-wide horizon. */
export function bookingRange(t: SessionType, horizonDays: number, tz: string, now = new Date()): { from: Date; to: Date } {
  const from = new Date(now.getTime() + t.config.minNoticeHours * 3600_000);
  const w = t.config.window;
  let to = new Date(now.getTime() + horizonDays * 86400_000);
  if (w.kind === "rolling") to = new Date(now.getTime() + w.rollingDays * 86400_000);
  void tz;
  return { from, to };
}

// ---------------------------------------------------------------- templates

/** Fill {first_name}, {when}, {where}, {manage_link}, {session} into an owner-written message. */
export function renderTemplate(tpl: string, vars: Record<string, string>): string {
  return tpl.replace(/\{(first_name|when|where|manage_link|session)\}/g, (_, k) => vars[k] ?? "");
}
