import { getDb, type Q } from "./db";
import { AppError, audit } from "./core";
import { ContentSchema, defaultContent, launchGaps, contrastIssues, parseContent, THEMES, type PageContent } from "./content";
import { getSettings } from "./settings";
import { ensureDefaultType } from "./sessiontypes";

export interface Season {
  id: string; slug: string; name: string; status: "draft" | "published" | "archived";
  draft: PageContent; published: PageContent | null; publishedVersion: number; publishedAt: Date | null; updatedAt: Date;
}

function rowToSeason(r: any): Season {
  return {
    id: r.id, slug: r.slug, name: r.name, status: r.status,
    draft: parseContent(r.draft), published: r.published ? parseContent(r.published) : null,
    publishedVersion: r.published_version, publishedAt: r.published_at, updatedAt: r.updated_at,
  };
}

export const slugify = (s: string) => s.toLowerCase().replace(/['’]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "season";

export async function listSeasons(): Promise<Season[]> {
  const db = await getDb();
  return (await db.query(`select * from seasons order by (status='archived'), created_at desc`)).rows.map(rowToSeason);
}
export async function getSeason(id: string, q?: Q): Promise<Season | null> {
  const db = q ?? (await getDb());
  const r = await db.query(`select * from seasons where id = $1`, [id]);
  return r.rows[0] ? rowToSeason(r.rows[0]) : null;
}
export async function getSeasonBySlug(slug: string): Promise<Season | null> {
  const db = await getDb();
  const r = await db.query(`select * from seasons where slug = $1`, [slug]);
  return r.rows[0] ? rowToSeason(r.rows[0]) : null;
}
/** The season shown at the stable /mini-sessions URL: the most recently published one. */
export async function getActiveSeason(): Promise<Season | null> {
  const db = await getDb();
  const r = await db.query(`select * from seasons where status='published' order by published_at desc limit 1`);
  return r.rows[0] ? rowToSeason(r.rows[0]) : null;
}

export async function createSeason(name: string, content?: PageContent): Promise<Season> {
  const db = await getDb();
  const base = slugify(name);
  let slug = base, n = 2;
  while ((await db.query(`select 1 from seasons where slug=$1`, [slug])).rows.length) slug = `${base}-${n++}`;
  const c = content ?? defaultContent(name);
  c.title = name;
  const r = await db.query(`insert into seasons(slug, name, draft) values ($1,$2,$3) returning *`, [slug, name, JSON.stringify(c)]);
  await ensureDefaultType(db, r.rows[0].id);
  return rowToSeason(r.rows[0]);
}

export async function duplicateSeason(id: string, newName: string): Promise<Season> {
  const src = await getSeason(id);
  if (!src) throw new AppError("not_found", "Season not found", 404);
  return createSeason(newName, { ...structuredClone(src.draft), title: newName });
}

export async function saveDraft(id: string, raw: unknown): Promise<Season> {
  const db = await getDb();
  const parsed = ContentSchema.safeParse(raw);
  if (!parsed.success) throw new AppError("invalid", parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  const c = parsed.data;
  if (THEMES[c.theme] === undefined && c.theme !== "custom") c.theme = "custom";
  const r = await db.query(`update seasons set draft=$2, name=$3, updated_at=now() where id=$1 returning *`, [id, JSON.stringify(c), c.title]);
  if (!r.rows[0]) throw new AppError("not_found", "Season not found", 404);
  return rowToSeason(r.rows[0]);
}

/** Publish the current draft. Live (non-demo) publishing requires the owner's real business values. */
export async function publishSeason(id: string, actor: string): Promise<Season> {
  const db = await getDb();
  const settings = await getSettings();
  return db.tx(async (q) => {
    const s = await getSeason(id, q);
    if (!s) throw new AppError("not_found", "Season not found", 404);
    const bad = contrastIssues(s.draft.colors);
    if (bad.length) throw new AppError("contrast", `Some colors are hard to read: ${bad.map((b) => `${b.pair} (${b.ratio}:1, needs ${b.need}:1)`).join("; ")}`, 422);
    if (!settings.demoMode) {
      const gaps = launchGaps(s.draft);
      if (gaps.length) throw new AppError("launch_gaps", `Before going live, fill in: ${gaps.map((g) => g.label).join(", ")}`, 422, { gaps });
    }
    const version = s.publishedVersion + 1;
    await q.query(`insert into season_versions(season_id, version, content) values ($1,$2,$3)`, [id, version, JSON.stringify(s.draft)]);
    const r = await q.query(
      `update seasons set published=draft, published_version=$2, published_at=now(), status='published', updated_at=now() where id=$1 returning *`,
      [id, version],
    );
    await audit(q, actor, "season.publish", null, { seasonId: id, version });
    return rowToSeason(r.rows[0]);
  });
}

export async function unpublishSeason(id: string, actor: string) {
  const db = await getDb();
  await db.query(`update seasons set status='draft', updated_at=now() where id=$1`, [id]);
  await audit(db, actor, "season.unpublish", null, { seasonId: id });
}
export async function archiveSeason(id: string, actor: string) {
  const db = await getDb();
  await db.query(`update seasons set status='archived', updated_at=now() where id=$1`, [id]);
  await audit(db, actor, "season.archive", null, { seasonId: id });
}

export async function listVersions(id: string) {
  const db = await getDb();
  return (await db.query(`select version, published_at, content->>'headline' as headline from season_versions where season_id=$1 order by version desc limit 30`, [id])).rows;
}
/** Restore an older published version into the DRAFT (owner reviews, then publishes). */
export async function restoreVersion(id: string, version: number, actor: string): Promise<Season> {
  const db = await getDb();
  const r = await db.query(`select content from season_versions where season_id=$1 and version=$2`, [id, version]);
  if (!r.rows[0]) throw new AppError("not_found", "That version doesn't exist", 404);
  await db.query(`update seasons set draft=$2, updated_at=now() where id=$1`, [id, JSON.stringify(r.rows[0].content)]);
  await audit(db, actor, "season.restore", null, { seasonId: id, version });
  return (await getSeason(id))!;
}
