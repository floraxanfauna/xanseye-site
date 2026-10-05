import { type NextRequest, after } from "next/server";
import { processOutbox } from "@/lib/outbox";
import { json } from "@/lib/http";
import { getPaymentProvider } from "@/lib/payments";
import { applyPaymentEvent } from "@/lib/booking";
import { logError } from "@/lib/util";

/** Stripe calls this. The signature is verified against the RAW body; return pages never prove payment. */
export async function POST(req: NextRequest) {
  const raw = await req.text();
  const provider = getPaymentProvider();
  let ev;
  try {
    ev = provider.parseWebhook(raw, req.headers.get("stripe-signature"));
  } catch {
    return json({ error: "invalid signature" }, 400);
  }
  if (!ev) return json({ ok: true });
  try {
    const outcome = await applyPaymentEvent(ev);
    after(() => processOutbox().catch(() => {})); // send the owner's email promptly; cron is the safety net
    return json({ ok: true, outcome });
  } catch (e) {
    logError("stripe.webhook", e);
    return json({ error: "temporary failure" }, 500); // Stripe retries
  }
}
