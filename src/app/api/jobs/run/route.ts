import { type NextRequest } from "next/server";
import { json } from "@/lib/http";
import { checkCronAuth } from "@/lib/auth";
import { processOutbox } from "@/lib/outbox";

/** Scheduled worker: sends emails, syncs Calendar/Docs, releases lapsed holds. Protected by CRON_SECRET. */
async function run(req: NextRequest) {
  if (!checkCronAuth(req.headers.get("authorization"))) return json({ error: "unauthorized" }, 401);
  return json(await processOutbox(50));
}
export const GET = run;
export const POST = run;
