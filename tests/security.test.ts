import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Stripe from "stripe";
import { getDb } from "@/lib/db";
import { setPaymentProvider, getPaymentProvider } from "@/lib/payments";
import { applyPaymentEvent, reserveSlot, getBookingView } from "@/lib/booking";
import { mintToken, exchangeForSession, sessionBooking, revokeAllAccess, checkToken, rateLimit, bookingByClaim } from "@/lib/access";
import { getPublicAvailability } from "@/lib/availability";
import { isOwnerEmail } from "@/lib/auth";
import { THEMES, contrastIssues } from "@/lib/content";
import { contrastRatio } from "@/lib/color";
import { emptyIntake, fieldErrors, normalizeIntake } from "@/lib/intake";
import { sha256 } from "@/lib/util";
import { makeSeason, makeSlots, setup, fullIntake, naIntake, count, inDays, TZ } from "./helpers";
import { processOutbox } from "@/lib/outbox";

const SECRET = "whsec_test_secret_123";

describe("Stripe webhook verification (raw body + signature)", () => {
  beforeEach(() => { process.env.STRIPE_SECRET_KEY = "sk_test_dummy"; process.env.STRIPE_WEBHOOK_SECRET = SECRET; setPaymentProvider(null); });
  afterEach(() => { delete process.env.STRIPE_SECRET_KEY; delete process.env.STRIPE_WEBHOOK_SECRET; });

  const payload = (over: any = {}) => JSON.stringify({
    id: "evt_test_1", object: "event", type: "checkout.session.completed", api_version: "2025-01-01", created: 1, livemode: false, pending_webhooks: 1, request: { id: null, idempotency_key: null },
    data: { object: { id: "cs_test_1", object: "checkout.session", client_reference_id: "b1", payment_status: "paid", amount_total: 500, currency: "usd", payment_intent: "pi_1", ...over } },
  });
  const sign = (p: string, secret = SECRET) => Stripe.webhooks.generateTestHeaderString({ payload: p, secret });

  it("accepts a correctly signed event and extracts trusted fields", () => {
    const p = payload();
    const ev = getPaymentProvider().parseWebhook(p, sign(p))!;
    expect(ev).toMatchObject({ id: "evt_test_1", bookingId: "b1", paid: true, amountCents: 500, currency: "usd", paymentIntent: "pi_1" });
  });
  it("rejects a bad signature, a wrong secret, a tampered body and a missing header", () => {
    const p = payload();
    expect(() => getPaymentProvider().parseWebhook(p, "t=1,v1=deadbeef")).toThrow();
    expect(() => getPaymentProvider().parseWebhook(p, sign(p, "whsec_other"))).toThrow();
    expect(() => getPaymentProvider().parseWebhook(payload({ amount_total: 1 }), sign(p))).toThrow();
    expect(() => getPaymentProvider().parseWebhook(p, null)).toThrow();
  });
});

describe("client access", () => {
  beforeEach(async () => { await setup({ google: true }); });

  async function confirmed(intake = fullIntake()) {
    const season = await makeSeason();
    const slots = await makeSlots(season.id);
    const r = await reserveSlot({ slotId: slots[0].id, intake, acceptedTerms: true });
    await applyPaymentEvent({ id: "e" + r.bookingId, type: "checkout.session.completed", bookingId: r.bookingId, sessionId: "cs", paid: true, amountCents: 500, currency: "usd", paymentIntent: "pi" });
    return { r, slots, season };
  }

  it("tokens are stored only as hashes and grant access to exactly one booking", async () => {
    const { r, slots } = await confirmed();
    const r2 = await reserveSlot({ slotId: slots[1].id, intake: fullIntake({ name: { state: "answered", value: "Other" } }), acceptedTerms: true });
    const raw = await mintToken(r.bookingId, "manage");
    const db = await getDb();
    const rows = (await db.query(`select token_hash from access_tokens`)).rows;
    expect(rows.map((x) => x.token_hash)).toContain(sha256(raw));
    expect(JSON.stringify(rows)).not.toContain(raw);
    const s = await exchangeForSession(raw);
    expect(s).toBeTruthy();
    expect(await sessionBooking(s!.sessionSecret)).toBe(r.bookingId);
    expect(await sessionBooking(s!.sessionSecret)).not.toBe(r2.bookingId);
    expect(await sessionBooking("nonsense")).toBeNull();
    const sess = (await db.query(`select session_hash from access_sessions`)).rows;
    expect(JSON.stringify(sess)).not.toContain(s!.sessionSecret);
  });

  it("expired and revoked links fail safely; revocation kills live sessions", async () => {
    const { r } = await confirmed();
    const db = await getDb();
    const a = await mintToken(r.bookingId, "manage");
    await db.query(`update access_tokens set expires_at = now() - interval '1 minute' where token_hash=$1`, [sha256(a)]);
    expect(await exchangeForSession(a)).toBeNull();
    const b = await mintToken(r.bookingId, "manage");
    const s = await exchangeForSession(b);
    expect(await sessionBooking(s!.sessionSecret)).toBe(r.bookingId);
    await revokeAllAccess(r.bookingId);
    expect(await sessionBooking(s!.sessionSecret)).toBeNull();
    expect(await checkToken(b, ["manage"])).toBeNull();
  });

  it("recovery links are single-use and the wrong kind of token can't be exchanged", async () => {
    const { r } = await confirmed();
    const rec = await mintToken(r.bookingId, "recovery");
    expect(await exchangeForSession(rec)).toBeTruthy();
    expect(await exchangeForSession(rec)).toBeNull();
    const verify = await mintToken(r.bookingId, "verify_email", { email: "x@y.com" });
    expect(await exchangeForSession(verify)).toBeNull();
  });

  it("the post-payment claim cookie only identifies the browser that reserved", async () => {
    const season = await makeSeason();
    const slots = await makeSlots(season.id);
    const r = await reserveSlot({ slotId: slots[0].id, intake: fullIntake(), acceptedTerms: true });
    expect((await bookingByClaim(r.claimSecret))!.id).toBe(r.bookingId);
    expect(await bookingByClaim("guess")).toBeNull();
    const db = await getDb();
    expect(JSON.stringify((await db.query(`select claim_hash from bookings`)).rows)).not.toContain(r.claimSecret);
  });

  it("public availability never contains client names, contact info or answers", async () => {
    const { season } = await confirmed(fullIntake({ name: { state: "answered", value: "Zelda Fitzgerald" }, email: { state: "answered", value: "zelda@secret.example" } }));
    const av = await getPublicAvailability(season.id);
    const dump = JSON.stringify(av);
    for (const needle of ["Zelda", "secret.example", "XE-", "Christmas", "landscape"]) expect(dump).not.toContain(needle);
    expect(Object.keys(av).sort()).toEqual(["dates", "externalCheck", "paused", "seasonId", "slots"]);
  });

  it("rate limiting trips after the allowed number of hits", async () => {
    const results = [];
    for (let i = 0; i < 6; i++) results.push(await rateLimit("t:key", 5, 60));
    expect(results).toEqual([true, true, true, true, true, false]);
  });

  it("secrets never end up in stored messages (client link redacted outside the dev mailbox)", async () => {
    const { r } = await confirmed();
    const c = await setup({ google: true }); // fresh db + fake mail transport (non-dev provider)
    void c; void r;
    const season = await makeSeason();
    const slots = await makeSlots(season.id);
    const r2 = await reserveSlot({ slotId: slots[0].id, intake: fullIntake(), acceptedTerms: true });
    await applyPaymentEvent({ id: "ee", type: "checkout.session.completed", bookingId: r2.bookingId, sessionId: "cs", paid: true, amountCents: 500, currency: "usd", paymentIntent: "pi" });
    await processOutbox();
    const db = await getDb();
    const bodies = (await db.query(`select body_text from notifications`)).rows.map((x) => x.body_text).join("\n");
    expect(bodies).toContain("[private link not stored]");
    expect(bodies).not.toMatch(/manage\/enter#[A-Za-z0-9_-]{20,}/);
  });
});

describe("owner authorization", () => {
  it("only allowlisted verified emails count as the owner", () => {
    expect(isOwnerEmail("xanflorafauna@gmail.com")).toBe(true);
    expect(isOwnerEmail(" XanFloraFauna@Gmail.com ")).toBe(true);
    expect(isOwnerEmail("someone.else@gmail.com")).toBe(false);
    expect(isOwnerEmail("xanflorafauna@gmail.com.evil.com")).toBe(false);
  });
});

describe("intake helpers and color contrast", () => {
  it("blank answers go back to unanswered; N/A passes validation; garbage email is caught", () => {
    const i: any = fullIntake();
    i.hopes = { state: "answered", value: "   " };
    expect(normalizeIntake(i).hopes).toEqual({ state: "unanswered" });
    expect(fieldErrors(naIntake())).toEqual({});
    expect(Object.keys(fieldErrors(emptyIntake())).length).toBe(12);
    const bad: any = fullIntake(); bad.email = { state: "answered", value: "N/A" };
    expect(fieldErrors(bad).email).toBeTruthy();
  });

  it("every built-in theme passes WCAG AA, and bad combos are flagged", () => {
    for (const [name, t] of Object.entries(THEMES)) expect(contrastIssues(t.colors), name).toEqual([]);
    expect(contrastIssues({ ...THEMES.autumn.colors, accent: "#C6A458" }).length).toBeGreaterThan(0);
    expect(contrastRatio("#000000", "#FFFFFF")).toBeCloseTo(21, 0);
  });
});

describe("dates, folders and midnight boundaries", () => {
  it("a late-evening session is filed under its LOCAL shoot date, not the UTC date", async () => {
    const c = await setup({ google: true });
    const season = await makeSeason();
    const date = inDays(12);
    const slots = await makeSlots(season.id, date, "23:00", "00:00", 30, 0);
    expect(slots).toHaveLength(2);
    const r = await reserveSlot({ slotId: slots[1].id, intake: fullIntake(), acceptedTerms: true }); // 23:30 local = next day in UTC
    await applyPaymentEvent({ id: "mid", type: "checkout.session.completed", bookingId: r.bookingId, sessionId: "cs", paid: true, amountCents: 500, currency: "usd", paymentIntent: "pi" });
    await processOutbox();
    expect(slots[1].starts_at.toISOString().slice(0, 10)).not.toBe(date);
    expect(c.google!.docs.get(r.bookingId)!.folderPath).toContain(`/${date} - `);
    const v = await getBookingView(r.bookingId);
    expect(v!.status).toBe("confirmed");
    void count; void TZ;
  });
});

describe("photos on the page", () => {
  it("accepts uploaded photos and site-hosted photos, rejects bad paths and empty entries", async () => {
    const { ContentSchema, defaultContent, photoSrc } = await import("@/lib/content");
    const base = defaultContent("x");
    const up = { assetId: "3a74f84e-5fbf-4b34-9c0b-eb06ee7bd62d", alt: "upload" };
    const site = { url: "/sample-photos/mini-1-mountain-family.jpg", alt: "site" };
    expect(ContentSchema.safeParse({ ...base, photos: [up, site] }).success).toBe(true);
    expect(ContentSchema.safeParse({ ...base, photos: [{ alt: "nothing" }] }).success).toBe(false);
    expect(ContentSchema.safeParse({ ...base, photos: [{ url: "https://evil.example/x.jpg", alt: "x" }] }).success).toBe(false);
    expect(ContentSchema.safeParse({ ...base, photos: [{ url: "/../../etc/passwd", alt: "x" }] }).success).toBe(false);
    expect(photoSrc(up)).toBe("/api/assets/3a74f84e-5fbf-4b34-9c0b-eb06ee7bd62d");
    expect(photoSrc(site)).toBe("/sample-photos/mini-1-mountain-family.jpg");
  });

  it("the demo season is created with the four sample photos", async () => {
    const { useFreshTestDb } = await import("@/lib/db");
    await useFreshTestDb();
    const { seedDemo } = await import("@/lib/seed");
    const pub = await seedDemo({ slots: false });
    expect(pub!.published!.photos.map((p) => p.url)).toEqual([
      "/sample-photos/mini-1-mountain-family.jpg", "/sample-photos/mini-2-golden-light.jpg", "/sample-photos/mini-3-autumn-family.jpg", "/sample-photos/mini-4-garden-walk.jpg",
    ]);
  });
});
