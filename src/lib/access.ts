import { getDb } from "./db";
import { newSecret, sha256, appUrl } from "./util";

/**
 * Client access to ONE booking. Secrets are 256-bit random, stored only as SHA-256 hashes,
 * expire, can be revoked, and are exchanged for an httpOnly session cookie so the URL secret
 * doesn't live in browser history/referrers longer than one hop.
 */
export type TokenKind = "manage" | "recovery" | "verify_email";

const TTL: Record<TokenKind, number> = {
  manage: 120 * 86400_000,       // initial private link: valid through the shoot and after
  recovery: 30 * 60_000,         // emailed sign-in link: short-lived
  verify_email: 24 * 3600_000,
};

export async function mintToken(bookingId: string, kind: TokenKind, meta: Record<string, unknown> = {}): Promise<string> {
  const db = await getDb();
  const raw = newSecret();
  await db.query(
    `insert into access_tokens(booking_id, kind, token_hash, meta, expires_at) values ($1,$2,$3,$4,$5)`,
    [bookingId, kind, sha256(raw), JSON.stringify(meta), new Date(Date.now() + TTL[kind])],
  );
  return raw;
}

export const manageUrl = (raw: string) => `${appUrl()}/manage/enter#${raw}`; // fragment: never sent to servers, logs or referrers

export interface TokenCheck { bookingId: string; kind: TokenKind; meta: any; tokenId: number }

export async function checkToken(raw: string, kinds: TokenKind[]): Promise<TokenCheck | null> {
  if (!raw || raw.length < 20 || raw.length > 200) return null;
  const db = await getDb();
  const r = await db.query(`select * from access_tokens where token_hash=$1`, [sha256(raw)]);
  const t = r.rows[0];
  if (!t || t.revoked_at || t.expires_at < new Date() || !kinds.includes(t.kind)) return null;
  return { bookingId: t.booking_id, kind: t.kind, meta: t.meta, tokenId: t.id };
}

/** Exchange a manage/recovery token for a cookie session. */
export async function exchangeForSession(raw: string): Promise<{ sessionSecret: string; bookingId: string; maxAgeSec: number } | null> {
  const t = await checkToken(raw, ["manage", "recovery"]);
  if (!t) return null;
  const db = await getDb();
  const b = (await db.query(`select status from bookings where id=$1`, [t.bookingId])).rows[0];
  if (!b) return null;
  const secret = newSecret();
  const maxAgeMs = 14 * 86400_000;
  await db.query(`insert into access_sessions(booking_id, session_hash, expires_at) values ($1,$2,$3)`, [t.bookingId, sha256(secret), new Date(Date.now() + maxAgeMs)]);
  if (t.kind === "recovery") await db.query(`update access_tokens set used_at=now(), revoked_at=now() where id=$1`, [t.tokenId]); // single use
  else await db.query(`update access_tokens set used_at=now() where id=$1`, [t.tokenId]);
  return { sessionSecret: secret, bookingId: t.bookingId, maxAgeSec: maxAgeMs / 1000 };
}

export async function sessionBooking(secret: string | undefined | null): Promise<string | null> {
  if (!secret) return null;
  const db = await getDb();
  const r = await db.query(`select booking_id from access_sessions where session_hash=$1 and revoked_at is null and expires_at > now()`, [sha256(secret)]);
  return r.rows[0]?.booking_id ?? null;
}

/** Owner revocation: kills every link and session for a booking. */
export async function revokeAllAccess(bookingId: string) {
  const db = await getDb();
  await db.query(`update access_tokens set revoked_at=now() where booking_id=$1 and revoked_at is null`, [bookingId]);
  await db.query(`update access_sessions set revoked_at=now() where booking_id=$1 and revoked_at is null`, [bookingId]);
}

/** Cookie set at reservation time so the browser that booked can see its confirmation page. */
export async function bookingByClaim(secret: string | undefined | null) {
  if (!secret) return null;
  const db = await getDb();
  const r = await db.query(`select id, ref, status, payment_status from bookings where claim_hash=$1`, [sha256(secret)]);
  return r.rows[0] ?? null;
}

// ---------------------------------------------------------------- tiny DB-backed rate limiter
export async function rateLimit(key: string, max: number, windowSec: number): Promise<boolean> {
  const db = await getDb();
  const start = new Date(Math.floor(Date.now() / (windowSec * 1000)) * windowSec * 1000);
  const r = await db.query(
    `insert into rate_limits(key, window_start, hits) values ($1,$2,1) on conflict (key, window_start) do update set hits = rate_limits.hits + 1 returning hits`,
    [key, start],
  );
  return r.rows[0].hits <= max;
}
