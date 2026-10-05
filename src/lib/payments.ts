import Stripe from "stripe";
import { appUrl } from "./util";

export interface CheckoutRequest {
  bookingId: string; ref: string; amountCents: number; currency: string; expiresAt: Date; description: string;
  customerEmail?: string; idempotencyKey: string;
}
export interface CheckoutResult { sessionId: string; url: string }
export interface SessionState { status: "open" | "complete" | "expired"; paid: boolean; amountCents: number; currency: string; paymentIntent: string | null }

/** Parsed, signature-verified payment event. */
export interface PaymentEvent {
  id: string; type: string;
  bookingId: string | null; sessionId: string; paid: boolean; amountCents: number; currency: string; paymentIntent: string | null;
}

export interface PaymentProvider {
  readonly name: "stripe" | "demo";
  readonly live: boolean;
  createCheckout(r: CheckoutRequest): Promise<CheckoutResult>;
  getSession(sessionId: string): Promise<SessionState>;
  expireSession(sessionId: string): Promise<void>;
  /** Verify the raw body against the signature header. Throws on invalid signature. */
  parseWebhook(rawBody: string, signature: string | null): PaymentEvent | null;
}

class StripeProvider implements PaymentProvider {
  readonly name = "stripe" as const;
  readonly live: boolean;
  private stripe: Stripe;
  constructor(key: string, private whsec: string | undefined) {
    this.stripe = new Stripe(key);
    this.live = key.startsWith("sk_live_");
  }
  async createCheckout(r: CheckoutRequest): Promise<CheckoutResult> {
    // Amount and currency come from server settings, never from the browser.
    const s = await this.stripe.checkout.sessions.create(
      {
        mode: "payment",
        client_reference_id: r.bookingId,
        metadata: { booking_id: r.bookingId, ref: r.ref }, // opaque ids only: no intake, no names
        customer_email: r.customerEmail,
        expires_at: Math.floor(r.expiresAt.getTime() / 1000),
        ...({ payment_method_types: ["card"] } as object), // immediate card payments only; no delayed methods
        line_items: [{
          quantity: 1,
          price_data: { currency: r.currency, unit_amount: r.amountCents, product_data: { name: r.description } },
        }],
        success_url: `${appUrl()}/booked`,
        cancel_url: `${appUrl()}/booked?canceled=1`,
      },
      { idempotencyKey: r.idempotencyKey },
    );
    if (!s.url) throw new Error("Stripe did not return a Checkout URL");
    return { sessionId: s.id, url: s.url };
  }
  async getSession(id: string): Promise<SessionState> {
    const s = await this.stripe.checkout.sessions.retrieve(id);
    return {
      status: s.status === "complete" ? "complete" : s.status === "expired" ? "expired" : "open",
      paid: s.payment_status === "paid",
      amountCents: s.amount_total ?? 0,
      currency: (s.currency ?? "usd").toLowerCase(),
      paymentIntent: typeof s.payment_intent === "string" ? s.payment_intent : s.payment_intent?.id ?? null,
    };
  }
  async expireSession(id: string) {
    try { await this.stripe.checkout.sessions.expire(id); } catch (e: any) {
      if (e?.code !== "checkout_session_expired" && !/not.*(open|expire)/i.test(e?.message ?? "")) throw e;
    }
  }
  parseWebhook(raw: string, sig: string | null): PaymentEvent | null {
    if (!this.whsec || !sig) throw new Error("Webhook secret or signature missing");
    const ev = this.stripe.webhooks.constructEvent(raw, sig, this.whsec); // throws on bad signature
    if (!ev.type.startsWith("checkout.session.")) return { id: ev.id, type: ev.type, bookingId: null, sessionId: "", paid: false, amountCents: 0, currency: "", paymentIntent: null };
    const s = ev.data.object as Stripe.Checkout.Session;
    return {
      id: ev.id, type: ev.type,
      bookingId: s.client_reference_id ?? s.metadata?.booking_id ?? null,
      sessionId: s.id,
      paid: s.payment_status === "paid",
      amountCents: s.amount_total ?? 0,
      currency: (s.currency ?? "").toLowerCase(),
      paymentIntent: typeof s.payment_intent === "string" ? s.payment_intent : s.payment_intent?.id ?? null,
    };
  }
}

/**
 * Demo provider: used ONLY when STRIPE_SECRET_KEY is absent. No money moves, and the UI says so.
 * The demo pay page feeds the same confirmation code path as a real webhook.
 */
class DemoProvider implements PaymentProvider {
  readonly name = "demo" as const;
  readonly live = false;
  async createCheckout(r: CheckoutRequest): Promise<CheckoutResult> {
    return { sessionId: `demo_${r.bookingId}`, url: `/demo-pay/${r.bookingId}` };
  }
  async getSession(): Promise<SessionState> { return { status: "open", paid: false, amountCents: 0, currency: "usd", paymentIntent: null }; }
  async expireSession() {}
  parseWebhook(): PaymentEvent | null { throw new Error("Demo mode has no webhook"); }
}

let override: PaymentProvider | null = null;
export function setPaymentProvider(p: PaymentProvider | null) { override = p; }
export function getPaymentProvider(): PaymentProvider {
  if (override) return override;
  const key = process.env.STRIPE_SECRET_KEY;
  return key ? new StripeProvider(key, process.env.STRIPE_WEBHOOK_SECRET) : new DemoProvider();
}
export const stripeConfigured = () => !!process.env.STRIPE_SECRET_KEY;
