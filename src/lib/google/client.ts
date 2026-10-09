import { OAuth2Client } from "google-auth-library";
import { calendar as calendarApi } from "@googleapis/calendar";
import { drive as driveApi } from "@googleapis/drive";
import { docs as docsApi } from "@googleapis/docs";
import { gmail as gmailApi } from "@googleapis/gmail";
import { getDb } from "../db";
import { appUrl, decrypt, encrypt } from "../util";
import { setBusyFetcher } from "./busy";

/**
 * Least-privilege scopes:
 *  - calendar.app.created : create + manage ONLY the calendar this app creates ("Xan's Eye — Mini Sessions")
 *  - calendar.calendarlist.readonly + calendar.freebusy : let the owner pick which calendars block time (read-only)
 *  - gmail.send : send-only; the app can send its booking emails as you but cannot read any mail
 *  - drive.file : touch only Drive items this app created (folders + one Doc per booking). Cannot see the owner's other files.
 * The Docs API accepts drive.file for files the app created, so no broad "documents" scope is requested.
 */
export const CONNECT_SCOPES = [
  "openid", "email",
  "https://www.googleapis.com/auth/calendar.app.created",
  "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
  "https://www.googleapis.com/auth/calendar.freebusy",
  "https://www.googleapis.com/auth/drive.file",
  // Lets the app send its notification emails from your own Gmail (send-only: it cannot read your inbox).
  "https://www.googleapis.com/auth/gmail.send",
];
export const LOGIN_SCOPES = ["openid", "email"];

export const googleConfigured = () => !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);

export function newOAuthClient(): OAuth2Client {
  return new OAuth2Client(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET, `${appUrl()}/api/auth/google/callback`);
}

// ---------------------------------------------------------------- integration state

export interface GoogleMeta {
  calendarId?: string;
  rootFolderId?: string;
  conflictCalendarIds?: string[];
}
export interface IntegrationRow { provider: string; status: string; account_email: string | null; tokens_enc: string | null; meta: GoogleMeta; last_error: string | null; checked_at: Date | null }

export async function getGoogleIntegration(): Promise<IntegrationRow | null> {
  const db = await getDb();
  return ((await db.query(`select * from integrations where provider='google'`)).rows[0] as IntegrationRow) ?? null;
}
export async function saveGoogleMeta(patch: Partial<GoogleMeta>) {
  const db = await getDb();
  await db.query(`update integrations set meta = meta || $1::jsonb, updated_at=now() where provider='google'`, [JSON.stringify(patch)]);
}
export async function markGoogle(status: "connected" | "needs_reauth" | "error", error: string | null = null) {
  const db = await getDb();
  await db.query(`update integrations set status=$1, last_error=$2, checked_at=now(), updated_at=now() where provider='google'`, [status, error]);
}
export async function disconnectGoogle() {
  const db = await getDb();
  await db.query(`delete from integrations where provider='google'`);
}

export async function storeGoogleConnection(email: string, tokens: Record<string, any>) {
  const db = await getDb();
  const prev = await getGoogleIntegration();
  let merged = tokens;
  if (prev?.tokens_enc && !tokens.refresh_token) merged = { ...JSON.parse(decrypt(prev.tokens_enc)), ...tokens }; // Google only sends refresh_token on consent
  await db.query(
    `insert into integrations(provider, status, account_email, tokens_enc) values ('google','connected',$1,$2)
     on conflict (provider) do update set status='connected', account_email=$1, tokens_enc=$2, last_error=null, updated_at=now()`,
    [email, encrypt(JSON.stringify(merged))],
  );
}

async function authedClient(): Promise<OAuth2Client | null> {
  if (!googleConfigured()) return null;
  const row = await getGoogleIntegration();
  if (!row || row.status === "needs_reauth" || !row.tokens_enc) return null;
  const c = newOAuthClient();
  const tokens = JSON.parse(decrypt(row.tokens_enc));
  c.setCredentials(tokens);
  c.on("tokens", async (t) => { // refreshed access token: persist (keep the long-lived refresh token)
    const db = await getDb();
    await db.query(`update integrations set tokens_enc=$1, updated_at=now() where provider='google'`, [encrypt(JSON.stringify({ ...tokens, ...t }))]);
  });
  return c;
}

/** Turn "token revoked/expired" into a visible reconnect state instead of silent failure. */
export async function noteGoogleError(e: any): Promise<void> {
  const msg = String(e?.message ?? e);
  if (/invalid_grant|invalid_token|unauthorized_client|Token has been expired or revoked/i.test(msg)) {
    await markGoogle("needs_reauth", "Google access was revoked or expired. Reconnect Google in Settings.");
    const db = await getDb();
    await db.query(`insert into tasks(kind, message, dedupe_key) values ('google_reauth','Google was disconnected. Reconnect it in Settings so calendar and Docs sync can resume.','google-reauth') on conflict (dedupe_key) do nothing`);
  }
}

// ---------------------------------------------------------------- adapter interface (also what tests fake)

export interface EventInput {
  bookingId: string; summary: string; description: string; start: Date; end: Date; timeZone: string; location?: string;
}
export interface DocInput {
  bookingId: string; existingDocId: string | null; existingFolderId: string | null;
  shootDate: string; seasonName: string; clientFolderName: string; docTitle: string; lines: DocLine[];
}
export type DocLine = { text: string; style: "title" | "h2" | "p" };

export interface GoogleAdapter {
  upsertEvent(i: EventInput): Promise<{ eventId: string }>;
  cancelEvent(bookingId: string): Promise<void>;
  upsertDoc(i: DocInput): Promise<{ docId: string; docUrl: string; folderId: string }>;
  getBusy(from: Date, to: Date): Promise<{ s: Date; e: Date }[]>;
}

let adapterOverride: GoogleAdapter | null | undefined;
export function setGoogleAdapter(a: GoogleAdapter | null | undefined) { adapterOverride = a; }

/** null => Google is not connected (jobs report "waiting for Google", never "synced"). */
export async function getGoogle(): Promise<GoogleAdapter | null> {
  if (adapterOverride !== undefined) return adapterOverride;
  const c = await authedClient();
  if (!c) return null;
  const row = (await getGoogleIntegration())!;
  return new RealGoogle(c, row.meta);
}

export async function installGoogleBusyFetcher() {
  if (adapterOverride !== undefined) {
    const a = adapterOverride;
    setBusyFetcher(a ? (f, t) => a.getBusy(f, t) : null);
    return;
  }
  const row = await getGoogleIntegration();
  if (!row || row.status !== "connected" || !row.meta.conflictCalendarIds?.length) { setBusyFetcher(null); return; }
  setBusyFetcher(async (from, to) => {
    const g = await getGoogle();
    if (!g) throw new Error("Google isn't connected");
    return g.getBusy(from, to);
  });
}

// ---------------------------------------------------------------- real implementation

const eventIdFor = (bookingId: string) => "xe" + bookingId.replace(/-/g, ""); // [a-v0-9], 5-1024 chars: allowed by Calendar

class RealGoogle implements GoogleAdapter {
  private cal; private drive; private docs;
  constructor(auth: OAuth2Client, private meta: GoogleMeta) {
    this.cal = calendarApi({ version: "v3", auth });
    this.drive = driveApi({ version: "v3", auth });
    this.docs = docsApi({ version: "v1", auth });
  }

  /** Find or create the dedicated calendar. */
  async ensureCalendar(): Promise<string> {
    if (this.meta.calendarId) return this.meta.calendarId;
    const r = await this.cal.calendars.insert({ requestBody: { summary: "Xan's Eye — Mini Sessions", timeZone: "America/Denver" } });
    this.meta.calendarId = r.data.id!;
    await saveGoogleMeta({ calendarId: this.meta.calendarId });
    return this.meta.calendarId;
  }

  async upsertEvent(i: EventInput) {
    const calendarId = await this.ensureCalendar();
    const id = eventIdFor(i.bookingId);
    const body = {
      summary: i.summary, description: i.description, location: i.location,
      start: { dateTime: i.start.toISOString(), timeZone: i.timeZone },
      end: { dateTime: i.end.toISOString(), timeZone: i.timeZone },
      status: "confirmed",
      extendedProperties: { private: { xe_booking: i.bookingId } },
      reminders: { useDefault: false, overrides: [{ method: "popup", minutes: 60 }] },
    };
    try {
      await this.cal.events.patch({ calendarId, eventId: id, requestBody: body }); // retry-safe: same id every time
    } catch (e: any) {
      if (e?.code !== 404 && e?.status !== 404) throw e;
      try { await this.cal.events.insert({ calendarId, requestBody: { ...body, id } }); }
      catch (e2: any) { if (e2?.code === 409 || e2?.status === 409) await this.cal.events.patch({ calendarId, eventId: id, requestBody: body }); else throw e2; }
    }
    return { eventId: id };
  }

  async cancelEvent(bookingId: string) {
    const calendarId = await this.ensureCalendar();
    try { await this.cal.events.patch({ calendarId, eventId: eventIdFor(bookingId), requestBody: { status: "cancelled" } }); }
    catch (e: any) { if (e?.code !== 404 && e?.status !== 404 && e?.code !== 410) throw e; }
  }

  async getBusy(from: Date, to: Date) {
    const ids = this.meta.conflictCalendarIds ?? [];
    if (!ids.length) return [];
    const r = await this.cal.freebusy.query({ requestBody: { timeMin: from.toISOString(), timeMax: to.toISOString(), items: ids.map((id) => ({ id })) } });
    const out: { s: Date; e: Date }[] = [];
    for (const c of Object.values(r.data.calendars ?? {})) {
      if ((c as any).errors?.length) throw new Error("Could not read a selected calendar's availability");
      for (const b of (c as any).busy ?? []) out.push({ s: new Date(b.start), e: new Date(b.end) });
    }
    return out;
  }

  // ---- Drive: Mini Photo Sessions / YYYY / YYYY-MM-DD - Season / Client - REF / Session Brief
  private async findFolder(name: string, parent: string): Promise<string | null> {
    const q = `name = '${name.replace(/'/g, "\\'")}' and '${parent}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
    const r = await this.drive.files.list({ q, fields: "files(id)", pageSize: 1, spaces: "drive" });
    return r.data.files?.[0]?.id ?? null;
  }
  private async ensureFolder(name: string, parent: string): Promise<string> {
    const hit = await this.findFolder(name, parent);
    if (hit) return hit;
    const r = await this.drive.files.create({ requestBody: { name, mimeType: "application/vnd.google-apps.folder", parents: [parent] }, fields: "id" });
    return r.data.id!;
  }
  private async root(): Promise<string> {
    if (this.meta.rootFolderId) return this.meta.rootFolderId;
    const id = await this.ensureFolder("Mini Photo Sessions", "root");
    this.meta.rootFolderId = id;
    await saveGoogleMeta({ rootFolderId: id });
    return id;
  }

  async upsertDoc(i: DocInput) {
    const root = await this.root();
    const year = await this.ensureFolder(i.shootDate.slice(0, 4), root);
    const dateFolder = await this.ensureFolder(`${i.shootDate} - ${i.seasonName}`, year);

    // One client folder per booking, found by stable app property (names are not identifiers).
    let folderId = i.existingFolderId;
    if (!folderId) {
      const f = await this.drive.files.list({ q: `appProperties has { key='xe_booking' and value='${i.bookingId}' } and mimeType='application/vnd.google-apps.folder' and trashed=false`, fields: "files(id,parents)", pageSize: 1 });
      folderId = f.data.files?.[0]?.id ?? null;
    }
    if (!folderId) {
      const c = await this.drive.files.create({
        requestBody: { name: i.clientFolderName, mimeType: "application/vnd.google-apps.folder", parents: [dateFolder], appProperties: { xe_booking: i.bookingId } },
        fields: "id",
      });
      folderId = c.data.id!;
    } else {
      // Reschedule: move the existing client folder under the new shoot-date folder (no duplicates).
      const cur = await this.drive.files.get({ fileId: folderId, fields: "parents,name" });
      const parents = cur.data.parents ?? [];
      if (!parents.includes(dateFolder))
        await this.drive.files.update({ fileId: folderId, addParents: dateFolder, removeParents: parents.join(","), requestBody: { name: i.clientFolderName }, fields: "id" });
      else if (cur.data.name !== i.clientFolderName)
        await this.drive.files.update({ fileId: folderId, requestBody: { name: i.clientFolderName }, fields: "id" });
    }

    let docId = i.existingDocId;
    if (!docId) {
      const f = await this.drive.files.list({ q: `appProperties has { key='xe_booking_doc' and value='${i.bookingId}' } and trashed=false`, fields: "files(id)", pageSize: 1 });
      docId = f.data.files?.[0]?.id ?? null;
    }
    if (!docId) {
      const d = await this.drive.files.create({
        requestBody: { name: i.docTitle, mimeType: "application/vnd.google-apps.document", parents: [folderId], appProperties: { xe_booking_doc: i.bookingId } },
        fields: "id",
      });
      docId = d.data.id!;
    }

    // Replace the whole body in place (same doc ID forever). requiredRevisionId makes a concurrent write fail instead of clobbering.
    const cur = await this.docs.documents.get({ documentId: docId });
    const end = (cur.data.body?.content ?? []).reduce((m, c) => Math.max(m, c.endIndex ?? 1), 1);
    const requests: any[] = [];
    if (end > 2) requests.push({ deleteContentRange: { range: { startIndex: 1, endIndex: end - 1 } } });
    const text = i.lines.map((l) => l.text).join("\n") + "\n";
    requests.push({ insertText: { location: { index: 1 }, text } });
    let idx = 1;
    for (const l of i.lines) {
      const len = l.text.length;
      if (l.style === "title") requests.push({ updateParagraphStyle: { range: { startIndex: idx, endIndex: idx + len + 1 }, paragraphStyle: { namedStyleType: "HEADING_1" }, fields: "namedStyleType" } });
      if (l.style === "h2") requests.push({ updateParagraphStyle: { range: { startIndex: idx, endIndex: idx + len + 1 }, paragraphStyle: { namedStyleType: "HEADING_3" }, fields: "namedStyleType" } });
      idx += len + 1;
    }
    await this.docs.documents.batchUpdate({ documentId: docId, requestBody: { requests, writeControl: cur.data.revisionId ? { requiredRevisionId: cur.data.revisionId } : undefined } });
    await this.drive.files.update({ fileId: docId, requestBody: { name: i.docTitle }, fields: "id" });
    return { docId, docUrl: `https://docs.google.com/document/d/${docId}/edit`, folderId };
  }

  // ---- owner-facing helpers
  async listCalendars() {
    const r = await this.cal.calendarList.list({ minAccessRole: "reader" });
    return (r.data.items ?? []).map((c) => ({ id: c.id!, name: c.summary ?? c.id!, primary: !!c.primary }));
  }
}

export async function listOwnerCalendars() {
  const c = await authedClient();
  if (!c) return [];
  const row = (await getGoogleIntegration())!;
  return new RealGoogle(c, row.meta).listCalendars();
}
export async function ensureDedicatedCalendar(): Promise<string | null> {
  const c = await authedClient();
  if (!c) return null;
  const row = (await getGoogleIntegration())!;
  return new RealGoogle(c, row.meta).ensureCalendar();
}

/** Cheap connection health check (run daily by the worker). */
export async function googleHealthCheck(): Promise<"not_connected" | "ok" | "needs_reauth" | "error"> {
  const row = await getGoogleIntegration();
  if (!row) return "not_connected";
  const c = await authedClient();
  if (!c) return row.status === "needs_reauth" ? "needs_reauth" : "not_connected";
  try {
    await new RealGoogle(c, row.meta).listCalendars();
    await markGoogle("connected", null);
    return "ok";
  } catch (e) {
    await noteGoogleError(e);
    const after = await getGoogleIntegration();
    if (after?.status !== "needs_reauth") await markGoogle("error", String((e as any)?.message ?? e));
    return after?.status === "needs_reauth" ? "needs_reauth" : "error";
  }
}


// ---------------------------------------------------------------- Gmail (send-only)

/** True when Google is connected AND the owner granted the send-only Gmail permission. */
export async function hasGmailSend(): Promise<boolean> {
  if (adapterOverride !== undefined) return false;
  const row = await getGoogleIntegration();
  if (!row || row.status !== "connected" || !row.tokens_enc) return false;
  try { return String(JSON.parse(decrypt(row.tokens_enc)).scope ?? "").includes("gmail.send"); } catch { return false; }
}

export async function gmailAccount(): Promise<string | null> { return (await getGoogleIntegration())?.account_email ?? null; }

/** Send one already-built RFC 822 message (base64url) as the connected Google account. */
export async function gmailSendRaw(raw: string): Promise<string | null> {
  const c = await authedClient();
  if (!c) throw new Error("Google isn't connected");
  try {
    const r = await gmailApi({ version: "v1", auth: c }).users.messages.send({ userId: "me", requestBody: { raw } });
    return r.data.id ?? null;
  } catch (e) {
    await noteGoogleError(e);
    throw e;
  }
}
