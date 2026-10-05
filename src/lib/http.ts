import { NextResponse, type NextRequest } from "next/server";
import { ZodError } from "zod";
import { AppError } from "./core";
import { logError } from "./util";

export const json = (data: unknown, status = 200, headers?: Record<string, string>) =>
  NextResponse.json(data, { status, headers: { "Cache-Control": "no-store", ...headers } });

/** Wrap a route handler: AppErrors become friendly JSON, everything else is a generic 500 (never leaks internals). */
export function handle<A extends unknown[]>(fn: (req: NextRequest, ...a: A) => Promise<Response>) {
  return async (req: NextRequest, ...a: A): Promise<Response> => {
    try {
      return await fn(req, ...a);
    } catch (e) {
      if (e instanceof AppError) return json({ error: e.message, code: e.code, ...(e.extra ?? {}) }, e.status);
      if (e instanceof ZodError) return json({ error: "Some answers need another look.", code: "invalid", issues: e.issues.map((i) => ({ path: i.path.join("."), message: i.message })) }, 422);
      logError(`${req.method} ${req.nextUrl.pathname}`, e);
      return json({ error: "Something went wrong on my end. Please try again.", code: "server_error" }, 500);
    }
  };
}

/** CSRF defence for cookie-authenticated writes: the request must come from this site. */
export function assertSameOrigin(req: NextRequest) {
  const origin = req.headers.get("origin");
  const host = req.headers.get("host");
  if (!origin) {
    if (req.headers.get("sec-fetch-site") === "same-origin") return;
    throw new AppError("csrf", "Request blocked.", 403);
  }
  try {
    if (new URL(origin).host !== host) throw 0;
  } catch {
    throw new AppError("csrf", "Request blocked.", 403);
  }
}

export const clientIp = (req: NextRequest) => (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown";

export async function readJson<T = any>(req: NextRequest): Promise<T> {
  const ct = req.headers.get("content-type") ?? "";
  if (!ct.includes("application/json")) throw new AppError("bad_request", "Expected JSON", 415);
  try { return (await req.json()) as T; } catch { throw new AppError("bad_request", "Couldn't read that request.", 400); }
}

export const COOKIE = { admin: "xe_admin", client: "xe_manage", claim: "xe_claim", oauth: "xe_oauth" } as const;

export function cookieOpts(maxAgeSec: number) {
  return { httpOnly: true, sameSite: "lax" as const, secure: process.env.NODE_ENV === "production", path: "/", maxAge: maxAgeSec };
}
