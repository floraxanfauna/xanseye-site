import { type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { handle, json, readJson, assertSameOrigin, clientIp, COOKIE, cookieOpts } from "@/lib/http";
import { reserveSlot } from "@/lib/booking";
import { rateLimit } from "@/lib/access";
import { AppError } from "@/lib/core";

export const POST = handle(async (req: NextRequest) => {
  assertSameOrigin(req);
  if (!(await rateLimit(`reserve:${clientIp(req)}`, 8, 600))) throw new AppError("rate_limited", "Too many attempts. Please wait a few minutes.", 429);
  const body = await readJson(req);
  const r = await reserveSlot({ slotId: String(body.slotId ?? ""), intake: body.intake, acceptedTerms: body.acceptedTerms === true });
  // This cookie lets the browser that reserved see its own confirmation page. It grants nothing else.
  (await cookies()).set(COOKIE.claim, r.claimSecret, cookieOpts(7 * 86400));
  return json({ checkoutUrl: r.checkoutUrl, provider: r.provider, ref: r.ref, holdExpiresAt: r.holdExpiresAt });
});
