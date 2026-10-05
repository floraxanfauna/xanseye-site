import { NextResponse, type NextRequest } from "next/server";
import { handle, assertSameOrigin } from "@/lib/http";
import { devLoginEnabled, ownerAllowlist, startOwnerSession } from "@/lib/auth";
import { AppError } from "@/lib/core";

/** Local development only. Disabled unless ALLOW_DEV_LOGIN=1 and NODE_ENV != production. */
export const POST = handle(async (req: NextRequest) => {
  if (!devLoginEnabled()) throw new AppError("disabled", "Not available.", 404);
  assertSameOrigin(req);
  await startOwnerSession(ownerAllowlist()[0]);
  return NextResponse.json({ ok: true });
});
