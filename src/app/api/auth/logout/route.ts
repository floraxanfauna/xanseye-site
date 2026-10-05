import { NextResponse, type NextRequest } from "next/server";
import { handle, assertSameOrigin } from "@/lib/http";
import { endOwnerSession } from "@/lib/auth";

export const POST = handle(async (req: NextRequest) => {
  assertSameOrigin(req);
  await endOwnerSession();
  return NextResponse.json({ ok: true });
});
