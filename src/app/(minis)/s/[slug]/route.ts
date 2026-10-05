import { NextResponse, type NextRequest } from "next/server";
import { appUrl } from "@/lib/util";

/** Short season links, e.g. /s/autumn-mini-sessions, resolve to the booking page for that season. */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  return NextResponse.redirect(`${appUrl()}/mini-sessions?season=${encodeURIComponent(slug)}`, 307);
}
