import { type NextRequest } from "next/server";
import { z } from "zod";
import { handle, json, readJson, assertSameOrigin } from "@/lib/http";
import { requireOwner } from "@/lib/auth";
import { AppError, audit } from "@/lib/core";
import { getDb } from "@/lib/db";
import * as A from "@/lib/admin-api";
import { contrastIssues, launchGaps } from "@/lib/content";

type Ctx = { params: Promise<{ path: string[] }> };

const PublishSchema = z.object({
  seasonId: z.string().uuid(),
  dates: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).min(1).max(62),
  startTime: z.string(), endTime: z.string(),
  durationMin: z.number().int(), bufferMin: z.number().int(),
  breaks: z.array(z.object({ start: z.string(), end: z.string() })).max(6).optional(),
});

/** Every admin request re-verifies the owner on the server. Writes also require a same-origin request. */
export const GET = handle(async (req: NextRequest, ctx: Ctx) => {
  await requireOwner();
  const p = (await ctx.params).path;
  const q = req.nextUrl.searchParams;
  const [a, b, c] = p;
  if (a === "overview") return json(await A.overview());
  if (a === "schedule" && !b) return json({ schedule: await A.getSchedule() });
  if (a === "schedule" && b === "preview") return json(await A.previewSchedule());
  if (a === "export") {
    const data = await A.exportAll();
    return new Response(JSON.stringify(data, null, 2), { headers: { "Content-Type": "application/json", "Content-Disposition": `attachment; filename="xanseye-minis-export-${new Date().toISOString().slice(0, 10)}.json"`, "Cache-Control": "no-store" } });
  }
  if (a === "seasons" && !b) return json({ seasons: await A.listSeasons() });
  if (a === "season" && b && !c) {
    const s = await A.getSeason(b);
    if (!s) throw new AppError("not_found", "Season not found", 404);
    return json({ season: s, contrast: contrastIssues(s.draft.colors), gaps: launchGaps(s.draft) });
  }
  if (a === "season" && b && c === "versions") return json({ versions: await A.listVersions(b) });
  if (a === "slots") {
    const from = q.get("from"), to = q.get("to");
    if (!from || !to) throw new AppError("invalid", "from and to are required", 422);
    return json({ slots: await A.listOwnerSlots(q.get("season"), from, to) });
  }
  if (a === "sessions") return json({ sessions: await A.listSessions(q.get("filter") ?? "upcoming") });
  if (a === "session" && b) return json(await A.sessionDetail(b));
  if (a === "settings") return json({ settings: await A.getSettings() });
  if (a === "assets") return json({ assets: await A.listAssets() });
  if (a === "notifications") return json({ notifications: (await (await getDb()).query(`select id, to_addr, subject, body_text, provider, status, created_at from notifications order by id desc limit 60`)).rows });
  if (a === "google" && b === "calendars") return json(await A.googleAction("calendars", {}));
  if (a === "integrations") return json((await A.overview()).integrations);
  throw new AppError("not_found", "Not found", 404);
});

export const POST = handle(async (req: NextRequest, ctx: Ctx) => {
  const owner = await requireOwner();
  assertSameOrigin(req);
  const p = (await ctx.params).path;
  const [a, b, c] = p;

  if (a === "assets") {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) throw new AppError("invalid", "Choose a photo to upload.", 422);
    const r = await A.uploadAsset(file, String(form.get("alt") ?? ""));
    return json(r);
  }

  const body = await readJson(req).catch(() => ({}));
  if (a === "seasons") {
    const name = String(body.name ?? "").trim();
    if (!name) throw new AppError("invalid", "Give the season a name.", 422);
    const s = body.duplicateFrom ? await A.duplicateSeason(String(body.duplicateFrom), name) : await A.createSeason(name);
    await audit(await getDb(), owner.email, "season.create", null, { id: s.id });
    return json({ season: s });
  }
  if (a === "season" && b) {
    if (c === "publish") return json({ season: await A.publishSeason(b, owner.email) });
    if (c === "unpublish") { await A.unpublishSeason(b, owner.email); return json({ ok: true }); }
    if (c === "archive") { await A.archiveSeason(b, owner.email); return json({ ok: true }); }
    if (c === "restore") return json({ season: await A.restoreVersion(b, Number(body.version), owner.email) });
  }
  if (a === "schedule" && b === "preview") return json(await A.previewSchedule(body.schedule));
  if (a === "schedule" && b === "publish") return json(await A.publishSchedule(body, owner));
  if (a === "slots" && b === "preview") return json({ days: await A.previewPlan(PublishSchema.parse(body)) });
  if (a === "slots" && b === "publish") return json(await A.publishSlots(PublishSchema.parse(body), owner.email));
  if (a === "slots" && b === "close") return json(await A.closeSlots(z.array(z.string().uuid()).max(500).parse(body.ids), owner.email));
  if (a === "slots" && b === "reopen") return json(await A.reopenSlots(z.array(z.string().uuid()).max(500).parse(body.ids), owner.email));
  if (a === "session" && b && c) return json(await A.sessionAction(b, c, body, owner));
  if (a === "task" && b && c === "done") {
    await (await getDb()).query(`update tasks set status='done', done_at=now() where id=$1`, [Number(b)]);
    return json({ ok: true });
  }
  if (a === "job" && b && c === "retry") { await A.retryJob(Number(b)); return json({ ok: true }); }
  if (a === "google" && b) return json(await A.googleAction(b, body));
  if (a === "pause") { await A.updateSettings({ paused: !!body.paused }); return json({ ok: true, paused: !!body.paused }); }
  if (a === "asset" && b && c === "alt") {
    await (await getDb()).query(`update assets set alt=$2 where id=$1`, [b, String(body.alt ?? "").slice(0, 200)]);
    return json({ ok: true });
  }
  throw new AppError("not_found", "Not found", 404);
});

export const PUT = handle(async (req: NextRequest, ctx: Ctx) => {
  await requireOwner();
  assertSameOrigin(req);
  const [a, b, c] = (await ctx.params).path;
  const body = await readJson(req);
  if (a === "season" && b && c === "draft") {
    const s = await A.saveDraft(b, body.content);
    return json({ season: s, contrast: contrastIssues(s.draft.colors), gaps: launchGaps(s.draft) });
  }
  if (a === "schedule") return json({ schedule: await A.saveSchedule(body.schedule) });
  if (a === "settings") return json({ settings: await A.updateSettings(body) });
  throw new AppError("not_found", "Not found", 404);
});

export const DELETE = handle(async (req: NextRequest, ctx: Ctx) => {
  await requireOwner();
  assertSameOrigin(req);
  const [a, b] = (await ctx.params).path;
  if (a === "asset" && b) { await A.deleteAsset(b); return json({ ok: true }); }
  throw new AppError("not_found", "Not found", 404);
});
