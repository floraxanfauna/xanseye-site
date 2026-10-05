import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

// ---------- ids / tokens ----------
const ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ"; // no 0/O/1/I/L

/** Short human booking reference, e.g. XE-7K3M9Q. Not a secret; never authorizes anything. */
export function newRef(): string {
  const b = crypto.randomBytes(6);
  return "XE-" + [...b].map((x) => ALPHABET[x % ALPHABET.length]).join("");
}

/** 256-bit URL-safe secret. */
export const newSecret = () => crypto.randomBytes(32).toString("base64url");
export const sha256 = (s: string) => crypto.createHash("sha256").update(s).digest("hex");

export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

// ---------- encryption at rest (Google tokens) ----------
function encKey(): Buffer {
  const env = process.env.TOKEN_ENC_KEY;
  if (env) {
    const k = Buffer.from(env, "base64");
    if (k.length !== 32) throw new Error("TOKEN_ENC_KEY must be 32 bytes, base64 encoded (openssl rand -base64 32)");
    return k;
  }
  if (process.env.NODE_ENV === "production") throw new Error("TOKEN_ENC_KEY is required in production");
  const f = path.join(process.cwd(), ".data", "dev-enc.key");
  fs.mkdirSync(path.dirname(f), { recursive: true });
  if (!fs.existsSync(f)) fs.writeFileSync(f, crypto.randomBytes(32).toString("base64"), { mode: 0o600 });
  return Buffer.from(fs.readFileSync(f, "utf8"), "base64");
}

export function encrypt(plain: string): string {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", encKey(), iv);
  const enc = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return [iv, c.getAuthTag(), enc].map((b) => b.toString("base64")).join(".");
}
export function decrypt(blob: string): string {
  const [iv, tag, enc] = blob.split(".").map((p) => Buffer.from(p, "base64"));
  const d = crypto.createDecipheriv("aes-256-gcm", encKey(), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(enc), d.final()]).toString("utf8");
}

// ---------- money ----------
export { dollars } from "./format";

// ---------- misc ----------
export const appUrl = () => (process.env.APP_URL || "http://localhost:3000").replace(/\/$/, "");

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/** Redact obvious secrets before anything is logged. */
export function redact(s: string): string {
  return s.replace(/(token|secret|key|authorization)=?[:\s]*[A-Za-z0-9_\-\.]{12,}/gi, "$1=[redacted]");
}
export function logError(where: string, e: unknown) {
  const msg = e instanceof Error ? e.message : String(e);
  console.error(`[${where}] ${redact(msg)}`);
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export { hexToRgb, contrastRatio } from "./color";
