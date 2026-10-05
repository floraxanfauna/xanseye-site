import { type NextRequest, after } from "next/server";
import { processOutbox } from "@/lib/outbox";
import { cookies } from "next/headers";
import { handle, json, readJson, assertSameOrigin, COOKIE } from "@/lib/http";
import { getPaymentProvider } from "@/lib/payments";
import { bookingByClaim } from "@/lib/access";
import { applyPaymentEvent } from "@/lib/booking";
import { getBookingView } from "@/lib/booking";
import { AppError } from "@/lib/core";
import { randomUUID } from "node:crypto";

/** Demo payments only: exists solely when Stripe isn't configured. No money moves. */
export const POST = handle(async (req: NextRequest) => {
  assertSameOrigin(req);
  if (getPaymentProvider().name !== "demo") throw new AppError("disabled", "Not available.", 404);
  const { bookingId, outcome } = await readJson(req);
  const b = await bookingByClaim((await cookies()).get(COOKIE.claim)?.value);
  if (!b || b.id !== bookingId) throw new AppError("forbidden", "That isn't your booking.", 403);
  const v = (await getBookingView(b.id))!;
  const base = { id: `demo_${randomUUID()}`, bookingId: b.id, sessionId: `demo_${b.id}`, currency: v.quote.currency, paymentIntent: `demo_pi_${b.id}` };
  if (outcome === "cancel") return json({ result: "canceled" }); // hold simply lapses
  const r = await applyPaymentEvent({ ...base, type: "checkout.session.completed", paid: true, amountCents: v.quote.depositCents });
  after(() => processOutbox().catch(() => {}));
  return json({ result: r });
});
