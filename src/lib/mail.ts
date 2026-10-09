import { getDb } from "./db";
import { escapeHtml } from "./util";
import { gmailAccount, gmailSendRaw, hasGmailSend } from "./google/client";

export interface OutgoingEmail {
  to: string; subject: string; text: string; html?: string; idempotencyKey: string;
  bookingId?: string | null; outboxId?: number | null; replyTo?: string;
}
export type SendResult =
  | { status: "sent"; provider: string; providerId: string | null }
  | { status: "dev_mailbox"; provider: "dev" }
  | { status: "blocked"; reason: string };

export interface MailTransport { name: string; send(m: OutgoingEmail): Promise<{ providerId: string | null }> }

let override: MailTransport | null = null;
export function setMailTransport(t: MailTransport | null) { override = t; }

export type EmailStatus = { configured: boolean; provider: "resend" | "gmail" | "dev" | "none"; note: string };

/** Which way emails will actually leave: Resend (if set up), else the owner's connected Gmail, else local dev mailbox, else nothing. */
export async function getEmailStatus(): Promise<EmailStatus> {
  if (override) return { configured: true, provider: "resend", note: "custom transport" };
  if (process.env.RESEND_API_KEY && process.env.EMAIL_FROM) return { configured: true, provider: "resend", note: "Resend" };
  if (await hasGmailSend()) return { configured: true, provider: "gmail", note: `your Gmail (${(await gmailAccount()) ?? "connected account"})` };
  if (process.env.NODE_ENV !== "production") return { configured: false, provider: "dev", note: "Local dev mailbox: messages are saved but NOT delivered." };
  return { configured: false, provider: "none", note: "Email isn't set up yet. Reconnect Google in Settings and allow \"send email\" so booking emails can reach you." };
}

/** RFC 822 message with text + HTML parts, UTF-8 safe, ready for the Gmail API. */
export function buildRawMessage(m: { from: string; to: string; subject: string; text: string; html: string; replyTo?: string }): string {
  const b64 = (t: string) => Buffer.from(t, "utf8").toString("base64").replace(/(.{76})/g, "$1\r\n");
  const hdr = (t: string) => t.replace(/[\r\n]+/g, " ");
  const boundary = "xe_" + Math.random().toString(36).slice(2) + Date.now().toString(36);
  const headers = [
    `From: ${hdr(m.from)}`, `To: ${hdr(m.to)}`, m.replyTo ? `Reply-To: ${hdr(m.replyTo)}` : null,
    `Subject: =?UTF-8?B?${Buffer.from(hdr(m.subject), "utf8").toString("base64")}?=`,
    "MIME-Version: 1.0", `Content-Type: multipart/alternative; boundary="${boundary}"`,
  ].filter((h): h is string => !!h);
  const lines = [
    ...headers, "",
    `--${boundary}`, 'Content-Type: text/plain; charset="UTF-8"', "Content-Transfer-Encoding: base64", "", b64(m.text),
    `--${boundary}`, 'Content-Type: text/html; charset="UTF-8"', "Content-Transfer-Encoding: base64", "", b64(m.html),
    `--${boundary}--`, "",
  ];
  return Buffer.from(lines.join("\r\n"), "utf8").toString("base64url");
}

const resend: MailTransport = {
  name: "resend",
  async send(m) {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json", "Idempotency-Key": m.idempotencyKey.slice(0, 250) },
      body: JSON.stringify({
        from: process.env.EMAIL_FROM, to: [m.to], subject: m.subject, text: m.text,
        html: m.html ?? `<pre style="font-family:inherit;white-space:pre-wrap">${escapeHtml(m.text)}</pre>`,
        reply_to: m.replyTo ?? process.env.EMAIL_REPLY_TO,
      }),
    });
    if (!res.ok) throw new Error(`Email provider rejected the message (${res.status})`);
    const j = (await res.json().catch(() => ({}))) as { id?: string };
    return { providerId: j.id ?? null };
  },
};

/**
 * Sends one email and records it. "sent" is only reported after the provider acknowledges.
 * Without a configured sender this returns "blocked" (production) or "dev_mailbox" (local), never a false "sent".
 */
export async function sendEmail(m: OutgoingEmail): Promise<SendResult> {
  const db = await getDb();
  const st = await getEmailStatus();
  // A retry after an ambiguous failure must never send the same message twice.
  if (m.outboxId) {
    const done = (await db.query(`select provider, provider_id from notifications where outbox_id=$1 and status='sent' limit 1`, [m.outboxId])).rows[0];
    if (done) return { status: "sent", provider: done.provider, providerId: done.provider_id };
  }
  // Private sign-in links are secrets: keep them out of the stored message log (except the local dev mailbox, where you need them to test).
  const stored = (provider: string) => (provider === "dev" ? m.text : m.text.replace(/(manage\/(?:enter|verify)#)[A-Za-z0-9_-]{20,}/g, "$1[private link not stored]"));
  const record = (provider: string, providerId: string | null, status: string) =>
    db.query(`insert into notifications(outbox_id, booking_id, to_addr, subject, body_text, provider, provider_id, status) values ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [m.outboxId ?? null, m.bookingId ?? null, m.to, m.subject, stored(provider), provider, providerId, status]);

  if (override) {
    const r = await override.send(m);
    await record(override.name, r.providerId, "sent");
    return { status: "sent", provider: override.name, providerId: r.providerId };
  }
  if (st.provider === "resend") {
    const r = await resend.send(m);
    await record("resend", r.providerId, "sent");
    return { status: "sent", provider: "resend", providerId: r.providerId };
  }
  if (st.provider === "gmail") {
    const acct = (await gmailAccount()) ?? "";
    const html = m.html ?? `<pre style="font-family:inherit;white-space:pre-wrap">${escapeHtml(m.text)}</pre>`;
    const raw = buildRawMessage({ from: `Xan's Eye Photography <${acct}>`, to: m.to, subject: m.subject, text: m.text, html, replyTo: m.replyTo ?? acct });
    const id = await gmailSendRaw(raw);
    await record("gmail", id, "sent");
    return { status: "sent", provider: "gmail", providerId: id };
  }
  if (st.provider === "dev") {
    await record("dev", null, "dev_not_delivered");
    return { status: "dev_mailbox", provider: "dev" };
  }
  return { status: "blocked", reason: "Email isn't set up: reconnect Google in Settings and allow sending email (or configure Resend)." };
}
