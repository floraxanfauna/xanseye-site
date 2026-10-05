import { type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { handle, json, assertSameOrigin, clientIp, COOKIE } from "@/lib/http";
import { bookingByClaim, mintToken, manageUrl, rateLimit } from "@/lib/access";
import { AppError } from "@/lib/core";

/** After a confirmed booking, the booking browser can display its private manage link on screen (for clients with no email). */
export const POST = handle(async (req: NextRequest) => {
  assertSameOrigin(req);
  if (!(await rateLimit(`claim:${clientIp(req)}`, 10, 600))) throw new AppError("rate_limited", "Too many attempts.", 429);
  const b = await bookingByClaim((await cookies()).get(COOKIE.claim)?.value);
  if (!b || b.status !== "confirmed") throw new AppError("not_confirmed", "Your booking isn't confirmed yet.", 409);
  return json({ link: manageUrl(await mintToken(b.id, "manage")), ref: b.ref });
});
