import { cookies } from "next/headers";
import { getDb } from "./db";
import { AppError } from "./core";
import { newSecret, sha256, safeEqual } from "./util";
import { COOKIE, cookieOpts } from "./http";

/**
 * Owner access. Signing in with *any* Google account is not enough: the verified email must be on the
 * server-side allowlist (OWNER_EMAILS). Every admin page and API call re-checks this.
 */
export const ownerAllowlist = () =>
  (process.env.OWNER_EMAILS || "xanflorafauna@gmail.com").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
export const isOwnerEmail = (email: string) => ownerAllowlist().includes(email.trim().toLowerCase());

const SESSION_MS = 14 * 86400_000;

export async function startOwnerSession(email: string) {
  if (!isOwnerEmail(email)) throw new AppError("not_owner", "That Google account isn't allowed to manage this site.", 403);
  const db = await getDb();
  const secret = newSecret();
  await db.query(`insert into owner_sessions(session_hash, email, expires_at) values ($1,$2,$3)`, [sha256(secret), email.toLowerCase(), new Date(Date.now() + SESSION_MS)]);
  (await cookies()).set(COOKIE.admin, secret, cookieOpts(SESSION_MS / 1000));
}

export async function currentOwner(): Promise<{ email: string } | null> {
  const secret = (await cookies()).get(COOKIE.admin)?.value;
  if (!secret) return null;
  const db = await getDb();
  const r = await db.query(`select email from owner_sessions where session_hash=$1 and expires_at > now()`, [sha256(secret)]);
  const email = r.rows[0]?.email as string | undefined;
  if (!email || !isOwnerEmail(email)) return null; // removed from the allowlist => locked out immediately
  return { email };
}

export async function requireOwner(): Promise<{ email: string }> {
  const o = await currentOwner();
  if (!o) throw new AppError("unauthorized", "Please sign in.", 401);
  return o;
}

export async function endOwnerSession() {
  const jar = await cookies();
  const secret = jar.get(COOKIE.admin)?.value;
  if (secret) { const db = await getDb(); await db.query(`delete from owner_sessions where session_hash=$1`, [sha256(secret)]); }
  jar.delete(COOKIE.admin);
}

export const devLoginEnabled = () => process.env.ALLOW_DEV_LOGIN === "1" && process.env.NODE_ENV !== "production";

/** Constant-time check for the scheduled-job secret. */
export function checkCronAuth(header: string | null): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret || !header) return false;
  const got = header.replace(/^Bearer\s+/i, "");
  return safeEqual(got, secret);
}
