import { useFreshTestDb, getDb } from "@/lib/db";
import { saveSettings, DEFAULT_SETTINGS } from "@/lib/settings";
import { createSeason, saveDraft, publishSeason } from "@/lib/seasons";
import { defaultContent } from "@/lib/content";
import { publishSlots } from "@/lib/availability";
import { addDays, localDate } from "@/lib/time";
import { setPaymentProvider, type PaymentProvider, type CheckoutRequest, type PaymentEvent, type SessionState } from "@/lib/payments";
import { setGoogleAdapter, type GoogleAdapter } from "@/lib/google/client";
import { setBusyFetcher, clearBusyCache } from "@/lib/google/busy";
import { setMailTransport, type OutgoingEmail } from "@/lib/mail";
import { emptyIntake, type Intake } from "@/lib/intake";

export const TZ = "America/Denver";

export class FakePayments implements PaymentProvider {
  name = "stripe" as const;
  live = false;
  sessions = new Map<string, SessionState & { req: CheckoutRequest }>();
  failCreate = false;
  failGet = false;
  createCalls: CheckoutRequest[] = [];
  async createCheckout(r: CheckoutRequest) {
    this.createCalls.push(r);
    if (this.failCreate) throw new Error("stripe down");
    const id = `cs_${r.bookingId}`;
    this.sessions.set(id, { status: "open", paid: false, amountCents: r.amountCents, currency: r.currency, paymentIntent: null, req: r });
    return { sessionId: id, url: `https://checkout.test/${id}` };
  }
  async getSession(id: string) { if (this.failGet) throw new Error("stripe unreachable"); return this.sessions.get(id)!; }
  async expireSession(id: string) { const s = this.sessions.get(id); if (s) s.status = "expired"; }
  parseWebhook(): PaymentEvent | null { throw new Error("not used"); }
  markPaid(id: string, pi = "pi_1") { const s = this.sessions.get(id)!; s.paid = true; s.status = "complete"; s.paymentIntent = pi; }
}

export class FakeGoogle implements GoogleAdapter {
  down = false;
  events = new Map<string, any>();
  docs = new Map<string, { id: string; body: string; folder: string; folderPath: string }>();
  docWrites: string[] = [];
  eventCalls = 0;
  busy: { s: Date; e: Date }[] = [];
  async upsertEvent(i: any) { if (this.down) throw new Error("google down"); this.eventCalls++; this.events.set(i.bookingId, i); return { eventId: "ev_" + i.bookingId }; }
  async cancelEvent(id: string) { if (this.down) throw new Error("google down"); const e = this.events.get(id); if (e) e.canceled = true; }
  async upsertDoc(i: any) {
    if (this.down) throw new Error("google down");
    const body = i.lines.map((l: any) => l.text).join("\n");
    const existing = this.docs.get(i.bookingId);
    const id = existing?.id ?? "doc_" + i.bookingId;
    this.docs.set(i.bookingId, { id, body, folder: i.clientFolderName, folderPath: `Mini Photo Sessions/${i.shootDate.slice(0, 4)}/${i.shootDate} - ${i.seasonName}/${i.clientFolderName}` });
    this.docWrites.push(body);
    return { docId: id, docUrl: `https://docs.test/${id}`, folderId: "fold_" + i.bookingId };
  }
  async getBusy() { if (this.down) throw new Error("google down"); return this.busy; }
}

export class FakeMail {
  sent: OutgoingEmail[] = [];
  fail = false;
  name = "fake";
  async send(m: OutgoingEmail) { if (this.fail) throw new Error("email down"); this.sent.push(m); return { providerId: "msg_" + this.sent.length }; }
}

export async function setup(opts: { google?: boolean; mail?: boolean } = {}) {
  await useFreshTestDb();
  await saveSettings({ ...DEFAULT_SETTINGS, minNoticeHours: 1, demoMode: false });
  const pay = new FakePayments();
  setPaymentProvider(pay);
  const google = opts.google ? new FakeGoogle() : null;
  setGoogleAdapter(google);
  if (google) setBusyFetcher((f, t) => google.getBusy());
  else setBusyFetcher(null);
  clearBusyCache();
  const mail = opts.mail === false ? null : new FakeMail();
  setMailTransport(mail);
  return { pay, google, mail };
}

export async function makeSeason(name = "Autumn Mini Sessions") {
  const s = await createSeason(name);
  const c = defaultContent(name);
  c.facts = { durationMin: 30, sessionPriceCents: 15000, location: "Test Park", deliverables: "10 photos", turnaround: "2 weeks" };
  c.depositPolicy = "credit"; c.termsText = "terms"; c.refundTerms = "refunds"; c.rescheduleCutoffHours = 48;
  await saveDraft(s.id, c);
  return publishSeason(s.id, "test");
}

/** date string N days from now in venue tz */
export const inDays = (n: number) => addDays(localDate(new Date(), TZ), n);

export async function makeSlots(seasonId: string, date = inDays(10), start = "10:00", end = "12:00", dur = 30, buf = 0) {
  await publishSlots({ seasonId, dates: [date], startTime: start, endTime: end, durationMin: dur, bufferMin: buf }, "test");
  const db = await getDb();
  const { localDayRange } = await import("@/lib/time");
  const r = localDayRange(date, TZ);
  return (await db.query(`select * from slots where season_id=$1 and starts_at >= $2 and starts_at < $3 order by starts_at`, [seasonId, r.start, r.end])).rows;
}

export function naIntake(): Intake {
  const i = emptyIntake();
  for (const k of Object.keys(i) as (keyof Intake)[]) if (k !== "photoRelease") (i as any)[k] = { state: "na" };
  return i;
}

export function fullIntake(overrides: Partial<Intake> = {}): Intake {
  return {
    name: { state: "answered", value: "Jane Smith" },
    email: { state: "answered", value: "jane@example.com" },
    phone: { state: "na" },
    commPref: { state: "answered", value: "email" },
    peopleCount: { state: "answered", value: 4 },
    participants: { state: "answered", value: [{ firstName: "Jane" }, { firstName: "Sam", relationship: "son" }] },
    purposes: { state: "answered", value: { choices: ["christmas_card"] } },
    hopes: { state: "answered", value: "Natural laughter" },
    orientation: { state: "answered", value: "landscape" },
    beautyEdit: { state: "answered", value: "no" },
    posing: { state: "answered", value: "candid" },
    comfort: { state: "na" },
    photoRelease: "no",
    ...overrides,
  };
}

export async function count(sql: string, params: unknown[] = []) {
  const db = await getDb();
  return (await db.query(sql, params)).rows[0].n as number;
}
