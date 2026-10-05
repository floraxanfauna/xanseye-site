import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { handle, COOKIE, cookieOpts } from "@/lib/http";
import { currentOwner } from "@/lib/auth";
import { CONNECT_SCOPES, LOGIN_SCOPES, googleConfigured, newOAuthClient } from "@/lib/google/client";
import { appUrl, newSecret } from "@/lib/util";

export const GET = handle(async (req: NextRequest) => {
  if (!googleConfigured()) return NextResponse.redirect(`${appUrl()}/admin/login?error=google_not_configured`);
  const purpose = req.nextUrl.searchParams.get("purpose") === "connect" ? "connect" : "login";
  if (purpose === "connect" && !(await currentOwner())) return NextResponse.redirect(`${appUrl()}/admin/login`);
  const state = newSecret();
  (await cookies()).set(COOKIE.oauth, `${state}.${purpose}`, cookieOpts(600)); // CSRF protection for the OAuth round trip
  const url = newOAuthClient().generateAuthUrl({
    access_type: purpose === "connect" ? "offline" : "online",
    prompt: purpose === "connect" ? "consent" : "select_account", // consent forces a refresh token to be issued
    scope: purpose === "connect" ? CONNECT_SCOPES : LOGIN_SCOPES,
    state,
    include_granted_scopes: false,
  });
  return NextResponse.redirect(url);
});
