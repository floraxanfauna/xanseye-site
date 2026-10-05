import { cookies } from "next/headers";
import { handle, json, COOKIE } from "@/lib/http";
import { bookingByClaim } from "@/lib/access";
import { getBookingView } from "@/lib/booking";
import { getSettings } from "@/lib/settings";
import { contactSituation } from "@/lib/intake";
import { emailStatus } from "@/lib/mail";

/** Polled by the confirmation page. Only reports confirmed after the server saw verified payment. */
export const GET = handle(async () => {
  const claim = (await cookies()).get(COOKIE.claim)?.value;
  const b = await bookingByClaim(claim);
  if (!b) return json({ found: false });
  const v = (await getBookingView(b.id))!;
  const s = await getSettings();
  return json({
    found: true, ref: v.ref, status: v.status, startsAt: v.startsAt, endsAt: v.endsAt, timezone: s.timezone, demo: v.quote.isDemo,
    depositCents: v.quote.depositCents, location: v.quote.location, contact: contactSituation(v.intake), email: v.recoveryEmail ? true : false, emailWorks: emailStatus().configured,
  });
});
