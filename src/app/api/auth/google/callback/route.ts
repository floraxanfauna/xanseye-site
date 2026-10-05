import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { handle, COOKIE } from "@/lib/http";
import { currentOwner, isOwnerEmail, startOwnerSession } from "@/lib/auth";
import { ensureDedicatedCalendar, newOAuthClient, storeGoogleConnection } from "@/lib/google/client";
import { appUrl, safeEqual, logError } from "@/lib/util";

export const GET = handle(async (req: NextRequest) => {
  const jar = await cookies();
  const saved = jar.get(COOKIE.oauth)?.value ?? "";
  jar.delete(COOKIE.oauth);
  const [savedState, purpose] = saved.split(".");
  const state = req.nextUrl.searchParams.get("state") ?? "";
  const code = req.nextUrl.searchParams.get("code");
  const back = (path: string) => NextResponse.redirect(`${appUrl()}${path}`);

  if (!savedState || !safeEqual(savedState, state)) return back("/admin/login?error=state");
  if (!code) return back(purpose === "connect" ? "/admin/settings?google=denied" : "/admin/login?error=denied");

  try {
    const client = newOAuthClient();
    const { tokens } = await client.getToken(code);
    const ticket = await client.verifyIdToken({ idToken: tokens.id_token!, audience: process.env.GOOGLE_CLIENT_ID });
    const p = ticket.getPayload();
    const email = p?.email?.toLowerCase();
    if (!email || !p?.email_verified) return back("/admin/login?error=unverified");
    if (!isOwnerEmail(email)) return back("/admin/login?error=not_owner"); // any Google login is not owner authorization

    if (purpose === "connect") {
      if (!(await currentOwner())) return back("/admin/login");
      if (!tokens.refresh_token) return back("/admin/settings?google=no_refresh");
      await storeGoogleConnection(email, tokens);
      await ensureDedicatedCalendar();
      return back("/admin/settings?google=connected");
    }
    await startOwnerSession(email);
    return back("/admin");
  } catch (e) {
    logError("google.callback", e);
    return back(purpose === "connect" ? "/admin/settings?google=error" : "/admin/login?error=failed");
  }
});
