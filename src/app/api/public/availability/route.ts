import type { NextRequest } from "next/server";
import { handle, json } from "@/lib/http";
import { getPublicAvailability } from "@/lib/availability";
import { getActiveSeason, getSeasonBySlug } from "@/lib/seasons";
import { AppError } from "@/lib/core";
import { getSettings } from "@/lib/settings";

/** Public: only dates, times and counts. Never names or answers. */
export const GET = handle(async (req: NextRequest) => {
  const slug = req.nextUrl.searchParams.get("season");
  const season = slug ? await getSeasonBySlug(slug) : await getActiveSeason();
  if (!season || season.status !== "published") throw new AppError("not_found", "No open booking page right now.", 404);
  const a = await getPublicAvailability(season.id);
  const s = await getSettings();
  return json({ ...a, timezone: s.timezone });
});
