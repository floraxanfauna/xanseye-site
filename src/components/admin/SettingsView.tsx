"use client";
import { useCallback, useEffect, useState } from "react";
import { api } from "./api";
import { useToast } from "./Toast";

export default function SettingsView() {
  const { show, node } = useToast();
  const [s, setS] = useState<any>(null);
  const [integ, setInteg] = useState<any>(null);
  const [cals, setCals] = useState<any[]>([]);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [gaps, setGaps] = useState<any[]>([]);
  const [savingCals, setSavingCals] = useState(false);
  async function toggleCal(id: string, on: boolean) {
    const next = new Set(chosen); on ? next.add(id) : next.delete(id);
    setChosen(next); setSavingCals(true);
    try {
      const r = await api("POST", "google/conflicts", { ids: [...next] });
      setChosen(new Set(r.ids)); // what the server actually stored
      show("Saved.");
    } catch (e: any) {
      setChosen(chosen); show(`Couldn't save: ${e.message}`, "error"); // roll back so the screen never lies
    } finally { setSavingCals(false); }
  }
  const q = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("google") : null;

  const load = useCallback(async () => {
    const [st, ov] = await Promise.all([api("GET", "settings"), api("GET", "overview")]);
    setS(st.settings); setInteg(ov.integrations); setGaps(ov.launchGaps);
    setChosen(new Set(ov.integrations.google.conflictCalendarIds));
    if (ov.integrations.google.status === "connected") api("GET", "google/calendars").then((r) => setCals(r.calendars)).catch(() => {});
  }, []);
  useEffect(() => { load().catch((e) => show(e.message, "error")); }, [load, show]);

  const save = async (patch: any, ok = "Saved.") => { try { const r = await api("PUT", "settings", patch); setS(r.settings); show(ok); await load(); } catch (e: any) { show(e.message, "error"); } };
  if (!s || !integ) return <div>{node}<p>Loading…</p></div>;
  const g = integ.google;
  const num = (k: string, label: string, hint?: string, unit?: number) => (
    <div className="field" style={{ marginBottom: 0 }}><label className="label" htmlFor={k}>{label}</label>
      <input id={k} type="number" min={0} step="any" defaultValue={unit ? s[k] / unit : s[k]} onBlur={(e) => { const v = Number(e.target.value); if (Number.isFinite(v) && v !== (unit ? s[k] / unit : s[k])) save({ [k]: unit ? Math.round(v * unit) : v }); }} />{hint && <span className="hint">{hint}</span>}</div>
  );

  return (
    <div className="stack">
      {node}
      <h1>Settings</h1>
      {q === "connected" && <div className="banner banner-ok" role="status">Google connected. Your "Xan's Eye — Mini Sessions" calendar was created.</div>}
      {q && q !== "connected" && <div className="banner banner-error" role="alert">{q === "no_refresh" ? "Google didn't give long-term access. Remove this app at myaccount.google.com/permissions, then connect again." : "Google connection didn't finish. Please try again."}</div>}

      <section className="card stack">
        <h2 style={{ margin: 0, fontSize: "1.4rem" }}>Going live</h2>
        <p style={{ margin: 0 }}>Mode: <span className={`badge ${s.demoMode ? "badge-warn" : "badge-ok"}`}>{s.demoMode ? "DEMO: no real money, placeholder values allowed" : "LIVE"}</span></p>
        {gaps.length > 0 && <div className="banner banner-demo"><strong>Still to finish in Page editor:</strong><ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>{gaps.map((x: any) => <li key={x.field}>{x.label}</li>)}</ul></div>}
        <div className="row">{s.demoMode
          ? <button className="btn btn-primary" onClick={() => confirm("Go live? Clients will pay real deposits through Stripe.") && save({ demoMode: false }, "You're live!")}>Go live</button>
          : <button className="btn btn-ghost" onClick={() => save({ demoMode: true }, "Back in demo mode.")}>Switch back to demo mode</button>}</div>
        <p className="small muted" style={{ margin: 0 }}>Going live requires: a published season with your real values, and Stripe connected. Do a full test booking first.</p>
      </section>

      <section className="card stack">
        <h2 style={{ margin: 0, fontSize: "1.4rem" }}>Connections</h2>
        <div className="stack" style={{ gap: 6 }}>
          <strong>Google (calendar + Docs)</strong>
          {!g.configured ? <div className="banner banner-info">Google isn't set up on the server yet. See SETUP.md → "Google".</div>
            : g.status === "connected" ? (<>
              <div><span className="badge badge-ok">Connected</span> as {g.account}{g.checkedAt && <span className="small muted"> · checked {new Date(g.checkedAt).toLocaleString()}</span>}</div>
              <fieldset className="field" style={{ marginBottom: 0 }}><legend className="small">Calendars that should BLOCK booking times (read-only check)</legend>
                <div className="choices">{cals.filter((c) => c.id !== g.calendarId).map((c) => <label key={c.id} className="choice"><input type="checkbox" checked={chosen.has(c.id)} disabled={savingCals} onChange={(e) => toggleCal(c.id, e.target.checked)} /><span>{c.name}</span></label>)}</div>
                {cals.length === 0 && <p className="hint">Loading your calendars…</p>}
                <p className="hint" role="status">{savingCals ? "Saving…" : chosen.size ? `✓ Saved. ${chosen.size} calendar${chosen.size === 1 ? "" : "s"} will block booking times.` : "No calendars selected, so only your published times and bookings decide what's open."}</p>
                <p className="hint">iCloud-only calendars can't be checked from here. Put those events on a Google calendar, or block those times by hand.</p>
              </fieldset>
              <div className="row"><button className="btn btn-ghost btn-sm" onClick={async () => { const r = await api("POST", "google/check", {}); show(`Connection: ${r.result}`); load(); }}>Test connection</button><button className="btn btn-danger btn-sm" onClick={async () => { if (confirm("Disconnect Google? Calendar and Doc syncing stops until you reconnect.")) { await api("POST", "google/disconnect", {}); load(); } }}>Disconnect</button></div>
            </>) : (<>
              <div>{g.status === "needs_reauth" ? <span className="badge badge-bad">Needs reconnecting</span> : <span className="badge badge-warn">Not connected</span>} {g.error && <span className="small">{g.error}</span>}</div>
              <div><a className="btn btn-primary btn-sm" href="/api/auth/google/start?purpose=connect">Connect Google</a></div>
            </>)}
        </div>
        <div className="stack" style={{ gap: 6 }}><strong>Stripe (deposits)</strong><div>{integ.stripe.configured ? <span className="badge badge-ok">Connected ({integ.stripe.mode} mode)</span> : <span className="badge badge-warn">Not connected: practice payments only</span>}</div>{!integ.stripe.configured && <p className="small muted" style={{ margin: 0 }}>Add STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET on your host (SETUP.md → "Stripe").</p>}</div>
        <div className="stack" style={{ gap: 6 }}><strong>Email</strong><div>{integ.email.configured ? <span className="badge badge-ok">Sending via {integ.email.note}</span> : <span className="badge badge-warn">Not set up</span>}</div><p className="small muted" style={{ margin: 0 }}>{integ.email.note}</p></div>
      </section>

      <section className="card stack">
        <h2 style={{ margin: 0, fontSize: "1.4rem" }}>Booking rules</h2>
        <div className="grid-3">
          {num("depositCents", "Deposit ($)", "Charged at booking.", 100)}
          {num("beautyEditCents", "Beauty editing, TOTAL for two photos ($)", "Billed later, never added to the deposit.", 100)}
          {num("holdMinutes", "Hold a time while paying (minutes)", "At least 30 (Stripe's minimum).")}
          {num("minNoticeHours", "Minimum notice (hours)")}
          {num("horizonDays", "How far ahead people can book (days)")}
          {num("maxPerDay", "Max sessions per day", "A gentle limit for you.")}
          {num("maxPeople", "Max people per session")}
        </div>
        <div className="grid-3">
          <div className="field" style={{ marginBottom: 0 }}><label className="label" htmlFor="rem">Client reminders (hours before, comma separated)</label><input id="rem" defaultValue={s.reminderHours.join(", ")} onBlur={(e) => { const v = e.target.value.split(",").map((x) => Number(x.trim())).filter((x) => x > 0); save({ reminderHours: v }); }} /><span className="hint">Email only.</span></div>
          <div className="field" style={{ marginBottom: 0 }}><label className="label" htmlFor="rs">Daily run sheet email at</label><input id="rs" type="time" defaultValue={s.runSheetLocalTime} onBlur={(e) => e.target.value && save({ runSheetLocalTime: e.target.value })} /><span className="hint">Only on days you have sessions.</span></div>
          <div className="field" style={{ marginBottom: 0 }}><label className="label" htmlFor="oe">Send notifications to</label><input id="oe" type="email" defaultValue={s.ownerEmail} onBlur={(e) => e.target.value !== s.ownerEmail && save({ ownerEmail: e.target.value })} /></div>
        </div>
        <p className="small muted" style={{ margin: 0 }}>Timezone: {s.timezone} (daylight saving is handled automatically).</p>
      </section>

      <section className="card stack">
        <h2 style={{ margin: 0, fontSize: "1.4rem" }}>Checklists</h2>
        <div className="grid-2">
          <div className="field" style={{ marginBottom: 0 }}><label className="label" htmlFor="pc">Gear / prep checklist (one per line)</label><textarea id="pc" defaultValue={s.prepChecklist.map((i: any) => i.label).join("\n")} onBlur={(e) => save({ prepChecklist: e.target.value.split("\n").map((l) => l.trim()).filter(Boolean).slice(0, 20).map((label, i) => ({ key: `p${i}`, label })) })} /></div>
          <div className="field" style={{ marginBottom: 0 }}><label className="label" htmlFor="po">After-session checklist (one per line)</label><textarea id="po" defaultValue={s.postChecklist.map((i: any) => i.label).join("\n")} onBlur={(e) => save({ postChecklist: e.target.value.split("\n").map((l) => l.trim()).filter(Boolean).slice(0, 12).map((label, i) => ({ key: `s${i}`, label })) })} /></div>
        </div>
      </section>

      <section className="card stack">
        <h2 style={{ margin: 0, fontSize: "1.4rem" }}>See bookings in Apple Calendar</h2>
        <ol style={{ margin: 0, paddingLeft: 20 }}>
          <li>Connect Google above. That creates a calendar named <strong>Xan's Eye — Mini Sessions</strong> in your Google account.</li>
          <li><strong>iPhone:</strong> Settings → Calendar → Accounts → Add Account → Google → sign in → make sure Calendars is on.</li>
          <li><strong>Mac:</strong> Calendar → Calendar menu → Add Account → Google. Then tick the calendar in the sidebar.</li>
        </ol>
        <p className="small muted" style={{ margin: 0 }}>Apple Calendar shows your Google calendar. This app does not write into an iCloud-owned calendar. Apple refreshes Google calendars every so often, so a new booking can take a few minutes to appear on a device.</p>
      </section>

      <section className="card stack">
        <h2 style={{ margin: 0, fontSize: "1.4rem" }}>Your data</h2>
        <div className="row"><a className="btn btn-ghost btn-sm" href="/api/admin/export">Download a backup (JSON)</a></div>
        <p className="small muted" style={{ margin: 0 }}>Includes bookings, answers, payments and page versions. No passwords, tokens or card numbers are ever stored. To delete a client's personal data, open their session → "Erase personal data". Payment records are kept for your bookkeeping.</p>
      </section>
    </div>
  );
}
