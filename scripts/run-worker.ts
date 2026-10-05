// Manual worker run (same thing the /api/jobs/run cron endpoint does).
import { processOutbox } from "../src/lib/outbox";
console.log(await processOutbox(50));
process.exit(0);
