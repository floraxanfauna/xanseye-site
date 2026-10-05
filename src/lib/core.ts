import type { Q } from "./db";

export async function audit(q: Q, actor: string, action: string, bookingId: string | null, meta: Record<string, unknown> = {}) {
  await q.query(`insert into audit_events(actor, action, booking_id, meta) values ($1,$2,$3,$4)`, [actor, action, bookingId, JSON.stringify(meta)]);
}

/** Owner action item ("Needs attention"). dedupe_key keeps repeated failures from stacking up. */
export async function addTask(q: Q, kind: string, message: string, bookingId: string | null, dedupeKey?: string) {
  await q.query(
    `insert into tasks(booking_id, kind, message, dedupe_key) values ($1,$2,$3,$4) on conflict (dedupe_key) do nothing`,
    [bookingId, kind, message, dedupeKey ?? null],
  );
}

export type JobKind =
  | "calendar.upsert" | "calendar.cancel"
  | "doc.upsert"
  | "email.owner_new_booking" | "email.owner_intake_changed" | "email.client_confirmation"
  | "email.client_reminder" | "email.owner_run_sheet" | "email.owner_alert" | "email.client_verify_email"
  | "email.client_manage_link" | "email.client_gallery" | "email.client_email_changed";

/** Idempotent enqueue: same dedupeKey never creates a second job. */
export async function enqueue(
  q: Q,
  job: { kind: JobKind; bookingId: string | null; dedupeKey: string; payload?: Record<string, unknown>; runAt?: Date },
): Promise<boolean> {
  const r = await q.query(
    `insert into outbox(kind, booking_id, dedupe_key, payload, run_at) values ($1,$2,$3,$4,$5)
     on conflict (dedupe_key) do nothing returning id`,
    [job.kind, job.bookingId, job.dedupeKey, JSON.stringify(job.payload ?? {}), job.runAt ?? new Date()],
  );
  return r.rows.length > 0;
}

export class AppError extends Error {
  constructor(public code: string, message: string, public status = 400, public extra?: Record<string, unknown>) { super(message); }
}
