"use client";
import { useEffect, useState } from "react";
import IntakeForm from "@/components/IntakeForm";
import { fieldErrors, normalizeIntake, type FieldKey, type Intake } from "@/lib/intake";
import { dollars } from "@/lib/format";

interface Me {
  ref: string; status: string; when: string; version: number; intake: Intake; maxPeople: number; location: string; demo: boolean; beautyCopy: string; hasEmail: boolean;
  quote: { beautyEditCents: number; depositCents: number }; balance: { balanceDueCents: number | null; beautyDueCents: number; depositPaidCents: number }; rescheduleCutoffHours: number | null;
}

export default function Manage() {
  const [me, setMe] = useState<Me | null>(null);
  const [denied, setDenied] = useState(false);
  const [intake, setIntake] = useState<Intake | null>(null);
  const [errors, setErrors] = useState<Partial<Record<FieldKey, string>>>({});
  const [msg, setMsg] = useState<{ kind: "ok" | "error" | "info"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [req, setReq] = useState<{ type: "reschedule" | "cancel"; note: string } | null>(null);

  async function load() {
    const r = await fetch("/api/manage/me", { cache: "no-store" });
    if (r.status === 401) { setDenied(true); return; }
    const j: Me = await r.json();
    setMe(j); setIntake(j.intake);
  }
  useEffect(() => { load(); }, []);

  async function save() {
    if (!intake || !me) return;
    const errs = fieldErrors(intake);
    setErrors(errs);
    if (Object.keys(errs).length) { setMsg({ kind: "error", text: "A few answers need another look. Every question can be N/A." }); return; }
    setBusy(true); setMsg(null);
    const r = await fetch("/api/manage/intake", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ intake: normalizeIntake(intake), version: me.version }) });
    const j = await r.json();
    setBusy(false);
    if (r.status === 409) { setMsg({ kind: "error", text: j.error }); return; }
    if (!r.ok) { setMsg({ kind: "error", text: j.error || "Couldn't save. Please try again." }); return; }
    if (!j.changed) { setMsg({ kind: "info", text: "Nothing changed, so there's nothing to save." }); return; }
    await load();
    setMsg({ kind: "ok", text: "Saved. Your changes are in, and I've been queued a notification about them." });
  }

  async function sendRequest() {
    if (!req) return;
    const r = await fetch("/api/manage/request-change", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(req) });
    setMsg(r.ok ? { kind: "ok", text: "Request sent. Nothing has been changed yet; I'll get back to you." } : { kind: "error", text: "Couldn't send that. Please try again." });
    if (r.ok) setReq(null);
  }

  async function signOut() { await fetch("/api/manage/logout", { method: "POST" }); window.location.href = "/mini-sessions"; }

  const wrap = (c: React.ReactNode) => <main className="wrap" style={{ maxWidth: 780, padding: "36px 0 80px" }}>{c}</main>;
  if (denied) return wrap(<div className="card stack"><h1>Please sign in again</h1><p>Your link has expired, or this browser isn't signed in.</p><a className="btn btn-primary" href="/manage/recover">Get a new sign-in link</a></div>);
  if (!me || !intake) return wrap(<p>Loading your booking…</p>);

  const canceled = me.status === "canceled";
  return wrap(
    <div className="stack">
      {me.demo && <div className="banner banner-demo"><strong>Demo booking.</strong> No real payment was taken.</div>}
      <div className="card card-float stack">
        <div className="row between"><h1 style={{ margin: 0, fontSize: "2rem" }}>Your mini session</h1><span className={`badge ${canceled ? "badge-bad" : ""}`}>{canceled ? "Canceled" : me.status === "confirmed" ? "Confirmed" : me.status}</span></div>
        <p style={{ fontSize: "1.15rem", margin: 0 }}><strong>{me.when}</strong>{me.location ? <><br />{me.location}</> : null}</p>
        <p className="muted small" style={{ margin: 0 }}>Reference {me.ref} · Deposit paid {dollars(me.balance.depositPaidCents)}{me.balance.balanceDueCents != null ? ` · Estimated balance later ${dollars(me.balance.balanceDueCents)}` : ""}{me.balance.beautyDueCents ? ` (includes ${dollars(me.balance.beautyDueCents)} beauty editing for 2 photos)` : ""}</p>
        {!canceled && <div className="row"><a className="btn btn-ghost btn-sm" href="/api/manage/ics">Add to my calendar (.ics)</a><button className="btn btn-ghost btn-sm" onClick={() => setReq({ type: "reschedule", note: "" })}>Ask to change the date</button><button className="btn btn-ghost btn-sm" onClick={() => setReq({ type: "cancel", note: "" })}>Ask to cancel</button></div>}
        {me.rescheduleCutoffHours != null && <p className="small muted" style={{ margin: 0 }}>Date changes and cancellations are handled by me directly (changes need at least {me.rescheduleCutoffHours} hours' notice). Saving your answers below never changes your date or payment.</p>}
      </div>

      {req && (
        <div className="card stack" role="dialog" aria-label="Request a change">
          <h2 style={{ fontSize: "1.4rem" }}>{req.type === "cancel" ? "Ask to cancel" : "Ask to change your date"}</h2>
          <div className="field"><label className="label" htmlFor="note">Anything I should know? (optional)</label><textarea id="note" value={req.note} onChange={(e) => setReq({ ...req, note: e.target.value })} /></div>
          <div className="row"><button className="btn btn-primary" onClick={sendRequest}>Send request</button><button className="btn btn-ghost" onClick={() => setReq(null)}>Never mind</button></div>
        </div>
      )}

      {msg && <div className={`banner banner-${msg.kind === "ok" ? "ok" : msg.kind === "error" ? "error" : "info"}`} role={msg.kind === "error" ? "alert" : "status"}>{msg.text}</div>}

      {!canceled && (
        <div className="card">
          <h2>Your answers</h2>
          <p className="muted">Change anything, any time, even after your session. Every question can be N/A.</p>
          <IntakeForm value={intake} onChange={(i) => { setIntake(i); if (Object.keys(errors).length) setErrors(fieldErrors(i)); }} errors={errors} maxPeople={me.maxPeople}
            beautyPrice={dollars(me.quote.beautyEditCents)} beautyCopy={me.beautyCopy} mode="manage" />
          {!me.hasEmail && <div className="banner banner-info" style={{ marginBottom: 14 }}>There's no email on file, so I can't send reminders or sign-in links. Add one above if you'd like them.</div>}
          <div className="row"><button className="btn btn-primary" disabled={busy} onClick={save}>{busy ? "Saving…" : "Save changes"}</button><span className="small muted">Version {me.version}</span></div>
          <p className="small muted">If you change your email, I'll send a confirmation to the new address. Until it's confirmed I keep using the old one.</p>
        </div>
      )}
      <div><button className="link-btn" onClick={signOut}>Sign out of this browser</button></div>
    </div>,
  );
}
