"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { api } from "./api";
import { useToast } from "./Toast";
import { STEPS, STEP_LABEL } from "./TodayView";
import { FIELD_LABELS, displayField, type FieldKey, type Intake } from "@/lib/intake";
import { dollars } from "@/lib/format";
import { formatTime, formatDateShort, formatWhen } from "@/lib/time";

export default function SessionDetail({ id }: { id: string }) {
  const { show, node } = useToast();
  const [d, setD] = useState<any>(null);
  const [notes, setNotes] = useState("");
  const [gallery, setGallery] = useState({ url: "", due: "" });
  const [newSlot, setNewSlot] = useState("");
  const [tz, setTz] = useState("America/Denver");

  const load = useCallback(async () => {
    const [r, st] = await Promise.all([api("GET", `session/${id}`), api("GET", "settings")]);
    setD(r); setNotes(r.ownerNotes); setGallery({ url: r.galleryUrl ?? "", due: r.galleryDue ?? "" }); setTz(st.settings.timezone);
  }, [id]);
  useEffect(() => { load().catch((e) => show(e.message, "error")); }, [load, show]);

  const act = async (action: string, body: any = {}, ok = "Done.") => {
    try { await api("POST", `session/${id}/${action}`, body); show(ok); await load(); } catch (e: any) { show(e.message, "error"); }
  };

  if (!d) return <p>Loading…</p>;
  const intake: Intake = d.intake;
  const canceled = d.status === "canceled";
  const stepIdx = STEPS.indexOf(d.workflow);

  return (
    <div className="stack">
      {node}
      <div className="no-print"><Link href="/admin/sessions">← All sessions</Link></div>
      <div className="row between">
        <div><h1 style={{ marginBottom: 4 }}>{d.first ?? d.ref}</h1><div className="muted">{d.when} · {d.ref}</div></div>
        <div className="row no-print"><span className={`badge ${canceled ? "badge-bad" : ""}`}>{d.status}</span><span className="badge">{STEP_LABEL[d.workflow]}</span><button className="btn btn-ghost btn-sm" onClick={() => window.print()}>Print brief</button></div>
      </div>

      {d.status === "review" && <div className="banner banner-error"><strong>Needs your decision.</strong> This client paid but the time was already taken (or the amount looked wrong). Check Stripe, then offer another time or refund. <button className="link-btn" onClick={() => act("refund-handled", {}, "Marked handled.")}>Mark handled</button></div>}
      {d.paymentStatus === "refund_pending" && <div className="banner banner-demo">Canceled with a deposit paid: decide on the refund in Stripe per their terms. <button className="link-btn" onClick={() => act("refund-handled", {}, "Marked refunded.")}>I've handled it</button></div>}

      <div className="grid-2">
        <section className="card stack" aria-labelledby="ans-h">
          <h2 id="ans-h" style={{ margin: 0, fontSize: "1.4rem" }}>Their answers <span className="small muted">(version {d.intakeVersion})</span></h2>
          <table className="t"><tbody>{(Object.keys(FIELD_LABELS) as FieldKey[]).map((k) => <tr key={k}><th scope="row" style={{ width: "38%" }}>{FIELD_LABELS[k]}</th><td>{displayField(intake, k)}</td></tr>)}</tbody></table>
          {d.contactMissing && <div className="banner banner-demo">No email on file: confirmations and reminders can't be emailed to them.</div>}
        </section>

        <div className="stack">
          <section className="card stack no-print" aria-labelledby="flow-h">
            <h2 id="flow-h" style={{ margin: 0, fontSize: "1.4rem" }}>After the session</h2>
            <div className="row">
              {STEPS.slice(1).map((s, i) => (
                <button key={s} className={`btn btn-sm ${stepIdx >= i + 1 ? "btn-primary" : "btn-ghost"}`} aria-pressed={stepIdx >= i + 1} onClick={() => act("workflow", { state: s }, `Marked ${STEP_LABEL[s].toLowerCase()}.`)}>{stepIdx >= i + 1 ? "✓ " : ""}{STEP_LABEL[s]}</button>
              ))}
            </div>
            <div className="field" style={{ marginBottom: 0 }}><label className="label" htmlFor="gu">Gallery link</label><input id="gu" type="url" placeholder="https://…" value={gallery.url} onChange={(e) => setGallery({ ...gallery, url: e.target.value })} /></div>
            <div className="field" style={{ marginBottom: 0 }}><label className="label" htmlFor="gd">Gallery due date</label><input id="gd" type="date" value={gallery.due} onChange={(e) => setGallery({ ...gallery, due: e.target.value })} /></div>
            <div className="row"><button className="btn btn-ghost btn-sm" onClick={() => act("gallery", gallery, "Saved.")}>Save</button><button className="btn btn-primary btn-sm" disabled={!d.galleryUrl} onClick={() => confirm("Email the gallery link to the client now?") && act("send-gallery", {}, "Gallery email queued.")}>Email gallery to client</button></div>
          </section>

          <section className="card stack" aria-labelledby="money-h">
            <h2 id="money-h" style={{ margin: 0, fontSize: "1.4rem" }}>Money</h2>
            <table className="t"><tbody>
              <tr><th scope="row">Deposit</th><td>{dollars(d.paidCents)} ({d.paymentStatus}){d.quote.isDemo ? " · DEMO" : ""}</td></tr>
              <tr><th scope="row">Session price (at booking)</th><td>{d.quote.sessionPriceCents == null ? "not set" : dollars(d.quote.sessionPriceCents)}</td></tr>
              <tr><th scope="row">Deposit policy</th><td>{d.quote.depositPolicy ?? "not set"}</td></tr>
              <tr><th scope="row">Beauty editing (2 photos)</th><td>{displayField(intake, "beautyEdit")} · {dollars(d.quote.beautyEditCents)} total, billed later</td></tr>
              <tr><th scope="row">Estimated balance</th><td><strong>{d.balanceDueCents == null ? "—" : dollars(d.balanceDueCents)}</strong></td></tr>
            </tbody></table>
            <p className="small muted" style={{ margin: 0 }}>Prices are the snapshot this client agreed to. Changing your page later never changes this.</p>
          </section>

          <section className="card stack no-print" aria-labelledby="notes-h">
            <h2 id="notes-h" style={{ margin: 0, fontSize: "1.4rem" }}>Your private notes</h2>
            <textarea aria-label="Private notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
            <div><button className="btn btn-ghost btn-sm" onClick={() => act("notes", { notes }, "Notes saved.")}>Save notes</button></div>
          </section>
        </div>
      </div>

      <div className="grid-2 no-print">
        <section className="card stack" aria-labelledby="sync-h">
          <h2 id="sync-h" style={{ margin: 0, fontSize: "1.4rem" }}>Calendar, Doc & email</h2>
          <div>Calendar event: {d.synced.calendar ? <span className="badge badge-ok">on your calendar</span> : <span className="badge badge-warn">not synced</span>}</div>
          <div>Google Doc: {d.docUrl ? <><a href={d.docUrl} target="_blank" rel="noreferrer">Open Doc ↗</a> {d.synced.doc ? <span className="badge badge-ok">up to date</span> : <span className="badge badge-warn">behind (v{d.docVersion})</span>}</> : <span className="badge badge-warn">not created</span>}</div>
          <button className="btn btn-ghost btn-sm" onClick={() => act("retry-sync", {}, "Retrying sync…")}>Retry sync</button>
          <details><summary style={{ cursor: "pointer", minHeight: 44, display: "flex", alignItems: "center" }}>Background tasks ({d.jobs.length}) &amp; emails ({d.notifications.length})</summary>
            <table className="t small"><tbody>{d.jobs.map((j: any) => <tr key={j.id}><td>{j.kind}</td><td><span className={`badge ${j.status === "done" ? "badge-ok" : j.status === "failed" ? "badge-bad" : "badge-warn"}`}>{j.status}</span></td><td className="muted">{j.last_error ?? ""}</td></tr>)}</tbody></table>
            <table className="t small"><tbody>{d.notifications.map((n: any, i: number) => <tr key={i}><td>{n.subject}</td><td>{n.status === "dev_not_delivered" ? <span className="badge badge-warn">dev mailbox (not delivered)</span> : <span className="badge badge-ok">{n.status}</span>}</td></tr>)}</tbody></table>
          </details>
        </section>

        <section className="card stack" aria-labelledby="chg-h">
          <h2 id="chg-h" style={{ margin: 0, fontSize: "1.4rem" }}>Change this booking</h2>
          {!canceled && d.status === "confirmed" && (
            <>
              <div className="field" style={{ marginBottom: 0 }}>
                <label className="label" htmlFor="ns">Move to another time</label>
                <select id="ns" value={newSlot} onChange={(e) => setNewSlot(e.target.value)}><option value="">Choose a free time…</option>{d.freeSlots.map((s: any) => <option key={s.id} value={s.id}>{formatDateShort(new Date(s.startsAt), tz)} · {formatTime(new Date(s.startsAt), tz)}</option>)}</select>
              </div>
              <div className="row"><button className="btn btn-ghost btn-sm" disabled={!newSlot} onClick={() => confirm("Move this session? Their calendar event, Doc folder and reminders will follow. The client is emailed if they have an email.") && act("reschedule", { slotId: newSlot }, "Rescheduled.")}>Reschedule</button>
                <button className="btn btn-danger btn-sm" onClick={() => { const reason = prompt("Cancel this session? Optional reason (kept in history):"); if (reason !== null) act("cancel", { reason }, "Canceled."); }}>Cancel session</button></div>
            </>
          )}
          <div className="row">
            <button className="btn btn-ghost btn-sm" disabled={!d.recoveryEmail} onClick={() => act("send-link", {}, "Link email queued.")}>Email them a new private link</button>
            <button className="btn btn-ghost btn-sm" onClick={() => confirm("Revoke every link and sign-in for this client? They'll need a new link.") && act("revoke-access", {}, "Access revoked.")}>Revoke their access</button>
          </div>
          <div><button className="link-btn small" style={{ color: "var(--danger)" }} onClick={() => { const c = prompt(`This permanently erases ${d.ref}'s answers, contact info and notes (the Doc and calendar entry are overwritten too). Payment records are kept.\n\nType ${d.ref} to confirm:`); if (c) act("erase", { confirm: c }, "Personal data erased."); }}>Erase personal data…</button></div>
          <details><summary style={{ cursor: "pointer", minHeight: 44, display: "flex", alignItems: "center" }}>History</summary>
            <table className="t small"><tbody>{d.audit.map((a: any, i: number) => <tr key={i}><td>{new Date(a.at).toLocaleString()}</td><td>{a.actor}</td><td>{a.action}</td></tr>)}</tbody></table>
            {d.revisions.filter((r: any) => r.changes.length).map((r: any) => <div key={r.version} className="small" style={{ marginTop: 8 }}><strong>v{r.version}</strong> ({formatWhen(new Date(r.created_at), tz)}): {r.changes.map((c: any) => `${c.label}: ${c.before} → ${c.after}`).join("; ")}</div>)}
          </details>
        </section>
      </div>
    </div>
  );
}
