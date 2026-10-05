"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { api } from "./api";
import { useToast } from "./Toast";
import { dollars } from "@/lib/format";

const STEPS = ["booked", "photographed", "backed_up", "selecting", "editing", "gallery_sent", "completed"];
const STEP_LABEL: Record<string, string> = { booked: "Booked", photographed: "Photographed", backed_up: "Backed up", selecting: "Selecting", editing: "Editing", gallery_sent: "Gallery sent", completed: "Completed" };

export default function TodayView() {
  const [d, setD] = useState<any>(null);
  const { show, node } = useToast();
  const load = useCallback(() => api("GET", "overview").then(setD).catch((e) => show(e.message, "error")), [show]);
  useEffect(() => { load(); }, [load]);
  if (!d) return <p>Loading…</p>;

  const g = d.integrations.google, em = d.integrations.email, st = d.integrations.stripe;
  const setup = [
    { ok: !d.settings.demoMode, label: "Live mode on", hint: "Currently in demo mode: no real money moves." },
    { ok: d.launchGaps.length === 0 && d.hasPublishedSeason, label: "Real session price, length, location and terms", hint: d.launchGaps.length ? `Still needed: ${d.launchGaps.map((x: any) => x.label).slice(0, 3).join("; ")}${d.launchGaps.length > 3 ? "…" : ""}` : "Publish a season first." },
    { ok: st.configured, label: "Stripe connected (deposits)", hint: "Not connected: the page shows a practice payment." },
    { ok: g.status === "connected", label: "Google connected (calendar + Docs)", hint: g.status === "needs_reauth" ? "Google access expired. Reconnect." : "Not connected: bookings won't reach your calendar or Docs yet." },
    { ok: em.configured, label: "Email sending set up", hint: em.note },
  ];
  const incomplete = setup.filter((s) => !s.ok);

  return (
    <div className="stack">
      {node}
      {d.settings.paused && <div className="banner banner-error" role="status"><strong>Bookings are paused.</strong> Nobody can book a new session until you resume (top right).</div>}
      {incomplete.length > 0 && (
        <div className="card">
          <div className="row between"><h2 style={{ margin: 0 }}>Before you go live</h2><Link className="btn btn-ghost btn-sm" href="/admin/settings">Open Settings</Link></div>
          <ul className="list" style={{ marginTop: 12 }}>
            {setup.map((s) => <li key={s.label} className="row"><span aria-hidden>{s.ok ? "✅" : "⬜"}</span><div><strong>{s.label}</strong>{!s.ok && <div className="small muted">{s.hint}</div>}</div></li>)}
          </ul>
        </div>
      )}
      {(d.jobs.failed || d.jobs.blocked || (d.mirrorLag && g.status === "connected")) ? (
        <div className="banner banner-demo" role="status">
          {d.jobs.blocked ? <div><strong>{d.jobs.blocked} task{d.jobs.blocked === 1 ? " is" : "s are"} waiting for setup</strong> (Google or email isn't connected). They'll run automatically once it is.</div> : null}
          {d.jobs.failed ? <div><strong>{d.jobs.failed} task{d.jobs.failed === 1 ? "" : "s"} failed.</strong> Open the booking and tap "Retry sync".</div> : null}
          {d.mirrorLag && g.status === "connected" ? <div>{d.mirrorLag} Google Doc{d.mirrorLag === 1 ? " is" : "s are"} behind the latest answers.</div> : null}
        </div>
      ) : null}

      <div className="grid-3">
        <div className="card counter"><b>{d.counters.upcoming}</b><span>upcoming sessions</span></div>
        <div className="card counter"><b>{d.counters.needsAttention}</b><span>need your attention</span></div>
        <div className="card counter"><b>{d.counters.toDeliver}</b><span>galleries to deliver</span></div>
      </div>

      <div className="grid-2">
        <section className="card stack" aria-labelledby="next-h">
          <h2 id="next-h" style={{ margin: 0 }}>Next session</h2>
          {d.next ? <SessionCard s={d.next} big /> : <p className="muted">Nothing booked yet. Publish some dates in Availability.</p>}
        </section>
        <section className="card stack" aria-labelledby="today-h">
          <div className="row between"><h2 id="today-h" style={{ margin: 0 }}>Today</h2><Link className="btn btn-ghost btn-sm" href={`/admin/run-sheet`}>Printable run sheet</Link></div>
          {d.today.length ? d.today.map((s: any) => <SessionCard key={s.id} s={s} />) : <p className="muted">No sessions today. 🌿</p>}
        </section>
      </div>

      <section className="card stack" aria-labelledby="att-h">
        <h2 id="att-h" style={{ margin: 0 }}>Needs attention</h2>
        {d.tasks.length === 0 ? <p className="muted">All clear. Nothing needs you right now.</p> : (
          <ul className="list">
            {d.tasks.map((t: any) => (
              <li key={t.id} className="row between">
                <div style={{ flex: "1 1 320px" }}>{t.message}{t.booking_id && <> <Link href={`/admin/sessions/${t.booking_id}`}>Open {t.ref}</Link></>}</div>
                <button className="btn btn-ghost btn-sm" onClick={async () => { await api("POST", `task/${t.id}/done`, {}); load(); }}>Done</button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

export function SessionCard({ s, big }: { s: any; big?: boolean }) {
  return (
    <div className="stack" style={{ gap: 6 }}>
      <div className="row between">
        <strong style={{ fontSize: big ? "1.2rem" : "1.05rem" }}>{s.when}</strong>
        <span className="badge">{STEP_LABEL[s.workflow] ?? s.workflow}</span>
      </div>
      <div>{s.first ?? s.ref} · {s.people} people · {s.purpose}</div>
      <div className="small muted">{s.orientation} · {s.posing} · Beauty edit: {s.beauty}</div>
      <div className="small">Deposit {s.paymentStatus === "paid" ? <span className="badge badge-ok">paid {dollars(s.paidCents)}</span> : <span className="badge badge-warn">{s.paymentStatus}</span>}{s.balanceDueCents != null && <> · Balance later {dollars(s.balanceDueCents)}</>}</div>
      {s.contactMissing && <div className="small" style={{ color: "var(--danger)" }}>⚠ No email on file, so they can't be emailed.</div>}
      <div><Link className="btn btn-ghost btn-sm" href={`/admin/sessions/${s.id}`}>Open brief</Link></div>
    </div>
  );
}

export { STEPS, STEP_LABEL };
