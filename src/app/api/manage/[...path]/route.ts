import { type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { after } from "next/server";
import { handle, json, readJson, assertSameOrigin, clientIp, COOKIE, cookieOpts } from "@/lib/http";
import { AppError, addTask, enqueue, audit } from "@/lib/core";
import { getDb } from "@/lib/db";
import { checkToken, exchangeForSession, sessionBooking, rateLimit } from "@/lib/access";
import { getBookingView, saveIntake, balanceSummary, VersionConflict, clientChangeRules, clientReschedule, clientCancel } from "@/lib/booking";
import { getPublicAvailability } from "@/lib/availability";
import { getType } from "@/lib/sessiontypes";
import { getSettings } from "@/lib/settings";
import { getSeason } from "@/lib/seasons";
import { processOutbox } from "@/lib/outbox";
import { formatWhen } from "@/lib/time";
import { sha256 } from "@/lib/util";

type Ctx = { params: Promise<{ path: string[] }> };

async function me() {
  const id = await sessionBooking((await cookies()).get(COOKIE.client)?.value);
  if (!id) throw new AppError("unauthorized", "Your link expired. Request a new one.", 401);
  const v = await getBookingView(id);
  if (!v) throw new AppError("not_found", "Booking not found", 404);
  return v;
}

export const GET = handle(async (req: NextRequest, ctx: Ctx) => {
  const [action] = (await ctx.params).path;
  if (action === "me") {
    const v = await me();
    const s = await getSettings();
    const season = await getSeason(v.seasonId);
    const bal = balanceSummary(v.quote, v.intake.beautyEdit.state === "answered" ? v.intake.beautyEdit.value : null, v.paidCents);
    return json({
      ref: v.ref, status: v.status, startsAt: v.startsAt, endsAt: v.endsAt, timezone: s.timezone, version: v.intakeVersion, intake: v.intake,
      quote: v.quote, balance: bal, maxPeople: s.maxPeople, location: v.quote.location, demo: v.quote.isDemo,
      beautyCopy: season?.published?.beautyCopy ?? "", rescheduleCutoffHours: v.terms.rescheduleCutoffHours,
      when: formatWhen(v.startsAt, s.timezone), hasEmail: !!v.recoveryEmail,
      typeName: v.quote.typeName ?? null, rules: await clientChangeRules(v.id),
    });
  }
  if (action === "change-options") {
    const v = await me();
    const rules = await clientChangeRules(v.id);
    const s = await getSettings();
    const av = rules.canReschedule ? await getPublicAvailability(v.seasonId, v.typeId) : null;
    return json({ rules, timezone: s.timezone, slots: av ? av.slots.filter((x) => x.id !== v.slotId) : [] });
  }
  if (action === "ics") {
    const v = await me();
    if (v.status !== "confirmed") throw new AppError("not_confirmed", "Not confirmed", 409);
    const db = await getDb();
    const seq = (await db.query(`select count(*)::int n from audit_events where booking_id=$1 and action='booking.reschedule'`, [v.id])).rows[0].n;
    const f = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
    const body = [
      "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Xan's Eye//Mini Sessions//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH", "BEGIN:VEVENT",
      `UID:${v.id}@minis.xanseye`, `SEQUENCE:${seq}`, `DTSTAMP:${f(new Date())}`, `DTSTART:${f(v.startsAt)}`, `DTEND:${f(v.endsAt)}`,
      `SUMMARY:Mini photo session (${v.ref})`, v.quote.location ? `LOCATION:${v.quote.location.replace(/[,;\n]/g, " ")}` : "", "END:VEVENT", "END:VCALENDAR",
    ].filter(Boolean).join("\r\n");
    return new Response(body, { headers: { "Content-Type": "text/calendar; charset=utf-8", "Content-Disposition": `attachment; filename="mini-session-${v.ref}.ics"`, "Cache-Control": "no-store" } });
  }
  throw new AppError("not_found", "Not found", 404);
});

export const PUT = handle(async (req: NextRequest, ctx: Ctx) => {
  const [action] = (await ctx.params).path;
  assertSameOrigin(req);
  if (action === "intake") {
    const v = await me();
    if (!(await rateLimit(`save:${v.id}`, 60, 600))) throw new AppError("rate_limited", "Too many saves. Please wait a moment.", 429);
    const body = await readJson(req);
    try {
      const r = await saveIntake(v.id, body.intake, Number(body.version));
      if (r.changed) after(() => processOutbox().catch(() => {})); // send the owner email promptly; cron is the safety net
      // Never claim email was delivered: report only what's true — the change is saved and queued.
      return json({ saved: true, changed: r.changed, version: r.version, notification: r.changed ? "queued" : "none" });
    } catch (e) {
      if (e instanceof VersionConflict) return json({ error: e.message, code: e.code, currentVersion: e.currentVersion }, 409);
      throw e;
    }
  }
  throw new AppError("not_found", "Not found", 404);
});

export const POST = handle(async (req: NextRequest, ctx: Ctx) => {
  const [action] = (await ctx.params).path;
  assertSameOrigin(req);
  const db = await getDb();

  if (action === "exchange") {
    if (!(await rateLimit(`exch:${clientIp(req)}`, 20, 600))) throw new AppError("rate_limited", "Too many attempts.", 429);
    const { token } = await readJson(req);
    const s = await exchangeForSession(String(token ?? ""));
    if (!s) throw new AppError("invalid_link", "That link has expired or isn't valid. Request a new one below.", 401);
    (await cookies()).set(COOKIE.client, s.sessionSecret, cookieOpts(s.maxAgeSec));
    return json({ ok: true });
  }

  if (action === "logout") {
    const jar = await cookies();
    const sec = jar.get(COOKIE.client)?.value;
    if (sec) await db.query(`update access_sessions set revoked_at=now() where session_hash=$1`, [sha256(sec)]);
    jar.delete(COOKIE.client);
    return json({ ok: true });
  }

  // Non-enumerating: always the same answer whether or not an email matches.
  if (action === "recover") {
    const { email } = await readJson(req);
    const ip = clientIp(req);
    const e = String(email ?? "").trim().toLowerCase();
    if (await rateLimit(`rec:${ip}`, 5, 900) && e.includes("@") && (await rateLimit(`rec-email:${sha256(e)}`, 3, 3600))) {
      const rows = (await db.query(
        `select id from bookings where lower(recovery_email)=$1 and status='confirmed' order by starts_at desc limit 3`, [e])).rows;
      for (const r of rows) await enqueue(db, { kind: "email.client_manage_link", bookingId: r.id, dedupeKey: `recovery:${r.id}:${Math.floor(Date.now() / 600_000)}` });
      if (rows.length) after(() => processOutbox().catch(() => {}));
    }
    return json({ ok: true, message: "If that email has a booking, a sign-in link is on its way. It can take a few minutes." });
  }

  if (action === "verify-email") {
    const { token } = await readJson(req);
    const t = await checkToken(String(token ?? ""), ["verify_email"]);
    if (!t) throw new AppError("invalid_link", "That link has expired or isn't valid.", 401);
    const b = (await db.query(`select recovery_email from bookings where id=$1`, [t.bookingId])).rows[0];
    await db.tx(async (q) => {
      await q.query(`update bookings set recovery_email=$2, recovery_email_verified=true where id=$1`, [t.bookingId, t.meta.email]);
      await q.query(`update access_tokens set used_at=now(), revoked_at=now() where id=$1`, [t.tokenId]);
      await enqueue(q, { kind: "email.client_email_changed", bookingId: t.bookingId, dedupeKey: `email-changed:${t.bookingId}:${t.tokenId}`, payload: { oldEmail: b?.recovery_email ?? null } });
      await audit(q, "client", "email.verified", t.bookingId, {});
    });
    after(() => processOutbox().catch(() => {}));
    return json({ ok: true });
  }

  if (action === "reschedule") {
    const v = await me();
    if (!(await rateLimit(`resched:${v.id}`, 10, 3600))) throw new AppError("rate_limited", "Too many changes. Please wait a bit.", 429);
    const { slotId } = await readJson(req);
    await clientReschedule(v.id, String(slotId ?? ""));
    after(() => processOutbox().catch(() => {}));
    return json({ ok: true });
  }
  if (action === "cancel") {
    const v = await me();
    const { reason } = await readJson(req);
    await clientCancel(v.id, String(reason ?? "").slice(0, 500));
    after(() => processOutbox().catch(() => {}));
    return json({ ok: true });
  }
  if (action === "request-change") {
    const v = await me();
    const { type, note } = await readJson(req);
    if (!["reschedule", "cancel"].includes(type)) throw new AppError("invalid", "Unknown request.", 422);
    const text = String(note ?? "").slice(0, 1000);
    await db.tx(async (q) => {
      await addTask(q, "client_request", `${v.ref} asked to ${type}${text ? `: "${text}"` : ""}. Nothing was changed automatically.`, v.id, `req:${v.id}:${type}:${Math.floor(Date.now() / 60_000)}`);
      await enqueue(q, { kind: "email.owner_alert", bookingId: v.id, dedupeKey: `alert:req:${v.id}:${type}:${Math.floor(Date.now() / 60_000)}`, payload: { subject: `${v.ref} asked to ${type}`, message: `A client asked to ${type} their session.${text ? `\nTheir note: ${text}` : ""}\nNothing was changed. Handle it from the dashboard.` } });
    });
    after(() => processOutbox().catch(() => {}));
    return json({ ok: true });
  }
  throw new AppError("not_found", "Not found", 404);
});
