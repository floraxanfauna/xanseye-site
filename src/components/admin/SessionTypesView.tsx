"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { api } from "./api";
import { useToast } from "./Toast";
import { dollars } from "@/lib/format";

type Cfg = any;
const LENGTHS = [15, 20, 25, 30, 40, 45, 60, 75, 90, 120, 180];
const BREAKS = [0, 5, 10, 15, 20, 30, 45, 60];
const NOTICE = [[0, "No minimum"], [2, "2 hours"], [12, "12 hours"], [24, "1 day"], [48, "2 days"], [72, "3 days"], [168, "1 week"], [336, "2 weeks"]] as const;
const COLORS = ["#1F4D37", "#8FB8D6", "#B5651D", "#7A4E8C", "#C6A458", "#B23A48", "#3B6E8F"];
const withCur = (list: number[], cur: number) => (list.includes(cur) ? list : [...list, cur].sort((a, b) => a - b));
const money = (c: number | null) => (c == null ? "" : String(c / 100));
const cents = (v: string) => (v.trim() === "" ? null : Math.round(Number(v) * 100));

function Num({ id, label, value, onChange, hint, ph }: { id: string; label: string; value: string; onChange: (v: string) => void; hint?: string; ph?: string }) {
  return <div className="field" style={{ marginBottom: 0, flex: "1 1 170px" }}><label className="label" htmlFor={id}>{label}</label><input id={id} type="number" min={0} step="any" value={value} placeholder={ph} onChange={(e) => onChange(e.target.value)} />{hint && <span className="hint">{hint}</span>}</div>;
}

function Editor({ type, onSaved, onClose, notify }: { type: any; onSaved: () => void; onClose: () => void; notify: (t: string, k?: "ok" | "error") => void }) {
  const [name, setName] = useState<string>(type.name);
  const [color, setColor] = useState<string>(type.color);
  const [c, setC] = useState<Cfg>(type.config);
  const [busy, setBusy] = useState(false);
  const set = (p: Partial<Cfg>) => setC((x: Cfg) => ({ ...x, ...p }));
  const minGap = c.durationMin + c.bufferMin;

  async function save() {
    setBusy(true);
    try { await api("PUT", `type/${type.id}`, { name, color, config: c }); notify("Saved."); onSaved(); } catch (e: any) { notify(e.message, "error"); } finally { setBusy(false); }
  }
  const setReminder = (i: number, p: any) => set({ reminders: c.reminders.map((r: any, j: number) => (j === i ? { ...r, ...p } : r)) });

  return (
    <div className="card card-float stack" role="region" aria-label={`Edit ${type.name}`}>
      <div className="row between"><h2 style={{ margin: 0, fontSize: "1.5rem" }}>Edit session type</h2><button className="btn btn-ghost btn-sm" onClick={onClose}>Close</button></div>

      <section className="stack" aria-labelledby="d-h"><h3 id="d-h" style={{ margin: 0 }}>1. Details</h3>
        <div className="field" style={{ marginBottom: 0 }}><label className="label" htmlFor="tn">Session name</label><input id="tn" value={name} onChange={(e) => setName(e.target.value)} placeholder="Mini Session" /></div>
        <fieldset className="field" style={{ marginBottom: 0 }}><legend className="small">Calendar color</legend><div className="choices">{COLORS.map((x) => <label key={x} className="choice"><input type="radio" name="col" checked={color === x} onChange={() => setColor(x)} /><span><i style={{ width: 16, height: 16, borderRadius: 4, background: x, display: "inline-block" }} aria-hidden /> {x === color ? "Selected" : ""}</span></label>)}</div></fieldset>
        <div className="row">
          <div className="field" style={{ marginBottom: 0 }}><label className="label" htmlFor="du">Length</label><select id="du" value={c.durationMin} onChange={(e) => set({ durationMin: Number(e.target.value) })}>{withCur(LENGTHS, c.durationMin).map((m) => <option key={m} value={m}>{m} minutes</option>)}</select></div>
          <Num id="pr" label="Total price ($)" value={money(c.priceCents)} onChange={(v) => set({ priceCents: cents(v) })} hint="Leave blank to use your page's price." />
          <Num id="dp" label="Deposit ($)" value={money(c.depositCents)} onChange={(v) => set({ depositCents: cents(v) })} hint="Blank = your usual deposit." />
          <Num id="mp" label="Most people" value={String(c.maxPeople)} onChange={(v) => set({ maxPeople: Math.max(1, Number(v) || 1) })} />
        </div>
        <div className="field" style={{ marginBottom: 0 }}><label className="label" htmlFor="lo">Where it happens (in person)</label><input id="lo" value={c.location} onChange={(e) => set({ location: e.target.value })} placeholder="Leave blank to use your page's location" /></div>
        <div className="field" style={{ marginBottom: 0 }}><label className="label" htmlFor="in">Instructions clients see while booking</label><textarea id="in" value={c.instructions} onChange={(e) => set({ instructions: e.target.value })} placeholder="What to wear, where to park, what to bring…" /></div>
      </section>

      <section className="stack" aria-labelledby="r-h"><h3 id="r-h" style={{ margin: 0 }}>2. Booking rules</h3>
        <div className="row">
          <div className="field" style={{ marginBottom: 0 }}><label className="label" htmlFor="bu">Break after each session</label><select id="bu" value={c.bufferMin} onChange={(e) => set({ bufferMin: Number(e.target.value) })}>{withCur(BREAKS, c.bufferMin).map((m) => <option key={m} value={m}>{m === 0 ? "No break" : `${m} minutes`}</option>)}</select></div>
          <div className="field" style={{ marginBottom: 0 }}><label className="label" htmlFor="iv">Start times every</label>
            <select id="iv" value={c.intervalMin ?? ""} onChange={(e) => set({ intervalMin: e.target.value === "" ? null : Number(e.target.value) })}><option value="">Right after the last one ({minGap} min)</option>{[15, 20, 30, 45, 60, 90, 120].filter((m) => m >= minGap).map((m) => <option key={m} value={m}>Every {m} minutes</option>)}</select></div>
          <div className="field" style={{ marginBottom: 0 }}><label className="label" htmlFor="mn">Minimum notice</label><select id="mn" value={c.minNoticeHours} onChange={(e) => set({ minNoticeHours: Number(e.target.value) })}>{NOTICE.map(([h, l]) => <option key={h} value={h}>{l}</option>)}{!NOTICE.some(([h]) => h === c.minNoticeHours) && <option value={c.minNoticeHours}>{c.minNoticeHours} hours</option>}</select></div>
        </div>
        <fieldset className="field" style={{ marginBottom: 0 }}><legend className="small">How far ahead can clients book?</legend>
          <div className="choices">
            <label className="choice"><input type="radio" name="win" checked={c.window.kind === "indefinite"} onChange={() => set({ window: { ...c.window, kind: "indefinite" } })} /><span>As far as I've published</span></label>
            <label className="choice"><input type="radio" name="win" checked={c.window.kind === "rolling"} onChange={() => set({ window: { ...c.window, kind: "rolling" } })} /><span>A rolling window</span></label>
            <label className="choice"><input type="radio" name="win" checked={c.window.kind === "fixed"} onChange={() => set({ window: { ...c.window, kind: "fixed" } })} /><span>Between two dates</span></label>
          </div>
          {c.window.kind === "rolling" && <div className="row" style={{ marginTop: 8 }}><Num id="rd" label="Days from today" value={String(c.window.rollingDays)} onChange={(v) => set({ window: { ...c.window, rollingDays: Math.max(1, Number(v) || 1) } })} /></div>}
          {c.window.kind === "fixed" && <div className="row" style={{ marginTop: 8 }}>
            <div className="field" style={{ marginBottom: 0 }}><label className="label" htmlFor="wf">From</label><input id="wf" type="date" value={c.window.from ?? ""} onChange={(e) => set({ window: { ...c.window, from: e.target.value || null } })} /></div>
            <div className="field" style={{ marginBottom: 0 }}><label className="label" htmlFor="wt">Until</label><input id="wt" type="date" value={c.window.to ?? ""} onChange={(e) => set({ window: { ...c.window, to: e.target.value || null } })} /></div></div>}
        </fieldset>
      </section>

      <section className="stack" aria-labelledby="a-h"><h3 id="a-h" style={{ margin: 0 }}>3. After someone books</h3>
        <div className="field" style={{ marginBottom: 0 }}><label className="label" htmlFor="cm">Confirmation message</label><textarea id="cm" value={c.confirmationMessage} onChange={(e) => set({ confirmationMessage: e.target.value })} placeholder="Shown on the confirmation page and in their email. A warm welcome, what happens next…" /></div>
        <label className="choice"><input type="checkbox" checked={c.sendConfirmationEmail} onChange={(e) => set({ sendConfirmationEmail: e.target.checked })} /><span>Email the client a confirmation</span></label>
        <label className="choice"><input type="checkbox" checked={c.allowClientReschedule} onChange={(e) => set({ allowClientReschedule: e.target.checked })} /><span>Let clients reschedule themselves</span></label>
        <label className="choice"><input type="checkbox" checked={c.allowClientCancel} onChange={(e) => set({ allowClientCancel: e.target.checked })} /><span>Let clients cancel themselves</span></label>
        {(c.allowClientReschedule || c.allowClientCancel) && <div className="row"><Num id="co" label="Only until this many hours before" value={String(c.clientChangeCutoffHours)} onChange={(v) => set({ clientChangeCutoffHours: Math.max(0, Number(v) || 0) })} hint="After that, they contact you." /></div>}
        <p className="hint" style={{ margin: 0 }}>When a client cancels, you're alerted and the deposit decision is yours (it appears under "Needs attention").</p>
      </section>

      <section className="stack" aria-labelledby="m-h"><h3 id="m-h" style={{ margin: 0 }}>4. Reminders (emails, up to two)</h3>
        {c.reminders.map((r: any, i: number) => (
          <div key={i} className="card stack" style={{ boxShadow: "none", background: "var(--tint)" }}>
            <div className="row"><div className="field" style={{ marginBottom: 0 }}><label className="label" htmlFor={`rh${i}`}>Reminder {i + 1}: send this many hours before</label><input id={`rh${i}`} type="number" min={1} max={336} value={r.hoursBefore} onChange={(e) => setReminder(i, { hoursBefore: Math.max(1, Number(e.target.value) || 1) })} style={{ width: 120 }} /></div>
              <button className="btn btn-ghost btn-sm" onClick={() => set({ reminders: c.reminders.filter((_: any, j: number) => j !== i) })}>Remove</button></div>
            <div className="field" style={{ marginBottom: 0 }}><label className="label" htmlFor={`rs${i}`}>Subject (optional)</label><input id={`rs${i}`} value={r.subject} onChange={(e) => setReminder(i, { subject: e.target.value })} placeholder="Leave blank for a friendly default" /></div>
            <div className="field" style={{ marginBottom: 0 }}><label className="label" htmlFor={`rb${i}`}>Message (optional)</label><textarea id={`rb${i}`} value={r.body} onChange={(e) => setReminder(i, { body: e.target.value })} placeholder="Leave blank for the built-in reminder with the time, place and a link to manage their booking." /></div>
          </div>
        ))}
        {c.reminders.length < 2 && <div><button className="btn btn-ghost btn-sm" onClick={() => set({ reminders: [...c.reminders, { hoursBefore: 24, subject: "", body: "" }] })}>+ Add a reminder</button></div>}
        <p className="hint" style={{ margin: 0 }}>In your own words you can use: <code>{"{first_name}"}</code> <code>{"{when}"}</code> <code>{"{where}"}</code> <code>{"{session}"}</code> <code>{"{manage_link}"}</code>. Reminders go by email only.</p>
      </section>

      <div className="row"><button className="btn btn-primary" disabled={busy} onClick={save}>Save session type</button><Link className="btn btn-ghost" href={`/admin/availability?type=${type.id}`}>Set my hours →</Link></div>
    </div>
  );
}

export default function SessionTypesView() {
  const { show, node } = useToast();
  const [seasons, setSeasons] = useState<any[]>([]);
  const [seasonId, setSeasonId] = useState("");
  const [types, setTypes] = useState<any[] | null>(null);
  const [editing, setEditing] = useState<string | null>(null);

  useEffect(() => { api("GET", "seasons").then((r) => { const l = r.seasons.filter((s: any) => s.status !== "archived"); setSeasons(l); setSeasonId((l.find((s: any) => s.status === "published") ?? l[0])?.id ?? ""); }).catch((e) => show(e.message, "error")); }, [show]);
  const load = useCallback(async () => { if (!seasonId) return; setTypes((await api("GET", `types?season=${seasonId}`)).types); }, [seasonId]);
  useEffect(() => { load().catch((e) => show(e.message, "error")); }, [load, show]);

  async function create(dup?: any) {
    const name = prompt(dup ? `Name for the copy of "${dup.name}"` : "Name for the new session type (e.g. Family Session)");
    if (!name) return;
    try { const r = await api("POST", dup ? `type/${dup.id}/duplicate` : "types", { seasonId, name, duplicateFrom: dup?.id }); await load(); setEditing(r.type.id); show("Created. Set it up below."); } catch (e: any) { show(e.message, "error"); }
  }
  async function toggle(t: any) { try { await api("PUT", `type/${t.id}`, { active: !t.active }); await load(); show(t.active ? "Hidden from clients." : "Open for booking."); } catch (e: any) { show(e.message, "error"); } }
  async function remove(t: any) {
    if (!confirm(`Delete "${t.name}"? If it has bookings, it's switched off instead so history is kept.`)) return;
    try { const r = await api("POST", `type/${t.id}/remove`, {}); await load(); show(r.result === "deleted" ? "Deleted." : "Switched off (it has booking history)."); } catch (e: any) { show(e.message, "error"); }
  }
  async function copy(link: string) { try { await navigator.clipboard.writeText(link); show("Link copied."); } catch { prompt("Copy this link:", link); } }

  return (
    <div className="stack">
      {node}
      <div className="row between"><div><h1 style={{ margin: 0 }}>Session types</h1><p className="muted" style={{ margin: "4px 0 0" }}>Each type is something clients can book, with its own length, price, hours and link.</p></div>
        <div className="row">{seasons.length > 1 && <select aria-label="Season" value={seasonId} onChange={(e) => { setSeasonId(e.target.value); setEditing(null); }} style={{ width: "auto" }}>{seasons.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>}<button className="btn btn-primary" onClick={() => create()}>+ New session type</button></div></div>

      {!types ? <p>Loading…</p> : (
        <div className="type-admin-grid">
          {types.map((t) => (
            <div key={t.id} className="card stack" style={{ borderTop: `6px solid ${t.color}`, opacity: t.active ? 1 : .7 }}>
              <div className="row between"><h2 style={{ margin: 0, fontSize: "1.4rem" }}>{t.name}</h2>{t.active ? <span className="badge badge-ok">Open for booking</span> : <span className="badge badge-warn">Hidden</span>}</div>
              <div className="muted">{t.config.durationMin} min · {t.config.priceCents != null ? dollars(t.config.priceCents) : "price from your page"} · up to {t.config.maxPeople} people</div>
              <div className="small"><strong>{t.openTimes}</strong> open time{t.openTimes === 1 ? "" : "s"} · <strong>{t.upcoming}</strong> upcoming booking{t.upcoming === 1 ? "" : "s"}</div>
              <div className="field" style={{ marginBottom: 0 }}><label className="label small" htmlFor={`l-${t.id}`}>Share this link</label>
                <div className="row" style={{ gap: 8 }}><input id={`l-${t.id}`} readOnly value={t.link} onFocus={(e) => e.currentTarget.select()} style={{ flex: 1, minWidth: 0 }} /><button className="btn btn-ghost btn-sm" onClick={() => copy(t.link)}>Copy</button></div></div>
              <div className="row">
                <button className="btn btn-primary btn-sm" onClick={() => setEditing(editing === t.id ? null : t.id)}>{editing === t.id ? "Close editor" : "Edit"}</button>
                <Link className="btn btn-ghost btn-sm" href={`/admin/availability?type=${t.id}`}>Set hours</Link>
                <button className="btn btn-ghost btn-sm" onClick={() => toggle(t)}>{t.active ? "Hide" : "Open"}</button>
                <button className="btn btn-ghost btn-sm" onClick={() => create(t)}>Duplicate</button>
                <button className="btn btn-danger btn-sm" onClick={() => remove(t)}>Delete</button>
              </div>
            </div>
          ))}
        </div>
      )}
      {editing && types?.find((t) => t.id === editing) && <Editor key={editing} type={types.find((t) => t.id === editing)} onSaved={load} onClose={() => setEditing(null)} notify={show} />}
    </div>
  );
}
