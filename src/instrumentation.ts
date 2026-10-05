/**
 * Mini-session booking system startup. Failures here must NEVER take down the rest of xanseye.com:
 * if the database isn't configured yet, only the booking pages report an error.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  try {
    const { getDb } = await import("./lib/db");
    await getDb(); // applies pending migrations
    if (process.env.DEMO_SEED === "1") {
      const { seedDemo } = await import("./lib/seed");
      await seedDemo();
    }
  } catch (e) {
    console.error("[mini-sessions] startup skipped:", e instanceof Error ? e.message : e);
    return;
  }
  // Long-running hosts only. On Vercel leave RUN_WORKER unset and ping /api/jobs/run from a scheduler.
  const g = globalThis as unknown as { __xeWorker?: boolean };
  if (!g.__xeWorker && (process.env.RUN_WORKER === "1" || (process.env.NODE_ENV !== "production" && process.env.RUN_WORKER !== "0"))) {
    g.__xeWorker = true;
    const { processOutbox } = await import("./lib/outbox");
    setInterval(() => { processOutbox().catch((e) => console.error("[worker]", e instanceof Error ? e.message : e)); }, 30_000).unref();
  }
}
