"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Calendar from "../Calendar";
import { api } from "./api";
import { useToast } from "./Toast";
import { formatTime, formatDateShort } from "@/lib/time";
import type { Schedule, Range } from "@/lib/schedule";

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const label = (hhmm: string) => { if (hhmm === "24:00") return "Midnight"; const [h, m] = hhmm.split(":").map(Number); return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`; };
const OPTS = (() => { const o: string[] = []; for (let m = 5 * 60; m < 24 * 60; m += 15) o.push(`${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`); return o; })();

function TimeSelect({ value, onChange, aria, end }: { value: string; onChange: (v: string) => void; aria: string; end?: boolean }) {
  const opts = end ? [...OPTS.slice(1), "24:00"] : OPTS;
  return <select aria-label={aria} value={value} onChange={(e) => onChange(e.target.value)} style={{ width: "auto", minWidth: 118 }}>{!opts.includes(value) && <option value={value}>{label(value)}</option>}{opts.map((o) => <option key={o} value={o}>{label(o)}</option>)}</select>;
}

function RangeEditor({ ranges, onChange, name }: { ranges: Range[]; onChange: (r: Range[]) => void; name: string }) {
  const set = (i: number, patch: Partial<Range>) => onChange(ranges.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  return (
    <div className="stack" style={{ gap: 8 }}>
      {ranges.map((r, i) => (
        <div className="row" key={i} style={{ gap: 8 }}>
          <TimeSelect value={r.start} aria={`${name} range ${i + 1} start`} onChange={(v) => set(i, { start: v })} />
          <span aria-hidden>–</span>
          <TimeSelect end value={r.end} aria={`${name} range ${i + 1} end`} onChange={(v) => set(i, { end: v })} />
          <button className="icon-btn" aria-label={`Remove ${name} range ${i + 1}`} onClick={() => onChange(ranges.filter((_, j) => j !== i))}>✕</button>
        </div>
      ))}
    </div>
  );
}

export default function ScheduleView() {
  const { show, node } = useToast();
  const [sch, setSch] = useState<Schedule | null>(null);
  const [saved, setSaved] = useState("");
  const [seasons, setSeasons] = useState<any[]>([]);
  const [tz, setTz] = useState("America/Denver");
  const [pv, setPv] = useState<any>(null);
  const [pvErr, setPvErr] = useState<string | null>(null);
  const [copyFrom, setCopyFrom] = useState<number | null>(null);
  const [copyTo, setCopyTo] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [replace, setReplace] = useState(false);
  const [ov, setOv] = useState<{ dates: Set<string>; off: boolean; ranges: Range[] } | null>(null);
  const now = new Date();
  const [pvMonth, setPvMonth] = useState({ y: now.getFullYear(), m: now.getMonth() + 1 });
  const [ovMonth, setOvMonth] = useState({ y: now.getFullYear(), m: now.getMonth() + 1 });
  const [pvDate, setPvDate] = useState<string | null>(null);
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

  useEffect(() => {
    Promise.all([api("GET", "schedule"), api("GET", "seasons"), api("GET", "settings")]).then(([s, ss, st]) => {
      const list = ss.seasons.filter((x: any) => x.status !== "archived");
      setSeasons(list); setTz(st.settings.timezone);
      const sc: Schedule = s.schedule;
      if (!sc.seasonId) sc.seasonId = (list.find((x: any) => x.status === "published") ?? list[0])?.id ?? null;
      setSch(sc); setSaved(JSON.stringify(s.schedule));
    }).catch((e) => show(e.message, "error"));
  }, [show]);

  const dirty = sch ? JSON.stringify(sch) !== saved : false;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refresh = useCallback((s: Schedule) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      try { setPv(await api("POST", "schedule/preview", { schedule: s })); setPvErr(null); } catch (e: any) { setPvErr(e.message); }
    }, 350);
  }, []);
  useEffect(() => { if (sch) refresh(sch); }, [sch, refresh]);

  const set = (patch: Partial<Schedule>) => setSch((p) => (p ? { ...p, ...patch } : p));
  const setDay = (i: number, r: Range[]) => sch && set({ weekly: sch.weekly.map((x, j) => (j === i ? r : x)) });

  const counts = useMemo(() => { const c: Record<string, number> = {}; for (const d of pv?.days ?? []) if (d.slots.length) c[d.date] = d.slots.length; return c; }, [pv]);
  const newCount = useMemo(() => (pv?.days ?? []).reduce((n: number, d: any) => n + d.slots.filter((s: any) => !s.published).length, 0), [pv]);
  const oldCount = useMemo(() => (pv?.days ?? []).reduce((n: number, d: any) => n + d.slots.filter((s: any) => s.published).length, 0), [pv]);
  const dayErrors = (pv?.days ?? []).filter((d: any) => d.error);

  async function save(): Promise<boolean> {
    if (!sch) return false;
    try { await api("PUT", "schedule", { schedule: sch }); setSaved(JSON.stringify(sch)); show("Schedule saved."); return true; } catch (e: any) { show(e.message, "error"); return false; }
  }
  async function publish() {
    if (!sch?.seasonId) return show("Choose which season these times belong to.", "error");
    if (dirty && !(await save())) return;
    if (replace && !confirm("Replace unbooked times in this range with the schedule above? Booked sessions are never touched.")) return;
    setBusy(true);
    try {
      const r = await api("POST", "schedule/publish", { seasonId: sch.seasonId, replaceUnbooked: replace });
      show(`Published ${r.created} new time${r.created === 1 ? "" : "s"}${r.removed ? `, replaced ${r.removed}` : ""}${r.alreadyPublished ? `. ${r.alreadyPublished} were already live` : ""}${r.skippedConflicts.length ? `. Skipped ${r.skippedConflicts.length} that overlapped a booking` : ""}.`);
      setPv(await api("POST", "schedule/preview", { schedule: sch }));
    } catch (e: any) { show(e.message, "error"); } finally { setBusy(false); }
  }
  function saveOverride() {
    if (!sch || !ov || !ov.dates.size) return;
    const dates = [...ov.dates];
    const entries = dates.map((date) => ({ date, ranges: ov.off ? null : ov.ranges }));
    set({ overrides: [...sch.overrides.filter((o) => !ov.dates.has(o.date)), ...entries].sort((a, b) => a.date.localeCompare(b.date)) });
    setOv(null);
  }

  if (!sch) return <div>{node}<p>Loading…</p></div>;
  const dayTimes = pvDate ? (pv?.days.find((d: any) => d.date === pvDate)?.slots ?? []) : [];

  return (
    <div className="grid-2" style={{ alignItems: "start" }}>
      {node}
      <div className="stack">
        <section className="card stack" aria-labelledby="wk-h">
          <h2 id="wk-h" style={{ fontSize: "1.4rem", margin: 0 }}>Weekly hours</h2>
          <p className="hint" style={{ margin: 0 }}>When are you usually free for mini sessions? Switch a day on and set your hours.</p>
          {DAYS.map((name, i) => {
            const on = sch.weekly[i].length > 0;
            return (
              <div key={name} className="row" style={{ alignItems: "flex-start", gap: 14, borderTop: i ? "1px solid var(--line)" : "none", paddingTop: i ? 10 : 0 }}>
                <label className="choice" style={{ width: 150 }}><input type="checkbox" checked={on} onChange={(e) => setDay(i, e.target.checked ? [{ start: "10:00", end: "12:00" }] : [])} /><span>{name}</span></label>
                <div style={{ flex: "1 1 280px" }}>
                  {on ? (
                    <div className="row" style={{ alignItems: "flex-start" }}>
                      <RangeEditor name={name} ranges={sch.weekly[i]} onChange={(r) => setDay(i, r)} />
                      <button className="icon-btn" aria-label={`Add another time range on ${name}`} title="Add another range" disabled={sch.weekly[i].length >= 4} onClick={() => { const last = sch.weekly[i].at(-1)!; setDay(i, [...sch.weekly[i], { start: last.end === "24:00" ? "20:00" : last.end, end: "24:00" }]); }}>＋</button>
                      <button className="icon-btn" aria-label={`Copy ${name}'s hours to other days`} title="Copy to other days" onClick={() => { setCopyFrom(copyFrom === i ? null : i); setCopyTo(new Set()); }}>⧉</button>
                    </div>
                  ) : <span className="muted" style={{ lineHeight: "46px" }}>Unavailable</span>}
                  {copyFrom === i && (
                    <div className="card" style={{ marginTop: 8, boxShadow: "none", background: "var(--tint)" }} role="group" aria-label={`Copy ${name} to`}>
                      <strong className="small">Copy {name}'s hours to:</strong>
                      <div className="choices" style={{ margin: "8px 0" }}>{DAYS.map((d, j) => j !== i && <label key={d} className="choice"><input type="checkbox" checked={copyTo.has(j)} onChange={(e) => setCopyTo((p) => { const n = new Set(p); e.target.checked ? n.add(j) : n.delete(j); return n; })} /><span>{d.slice(0, 3)}</span></label>)}</div>
                      <div className="row"><button className="btn btn-primary btn-sm" onClick={() => { set({ weekly: sch.weekly.map((r, j) => (copyTo.has(j) ? structuredClone(sch.weekly[i]) : r)) }); setCopyFrom(null); }}>Apply</button><button className="btn btn-ghost btn-sm" onClick={() => setCopyFrom(null)}>Cancel</button></div>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </section>

        <section className="card stack" aria-labelledby="ses-h">
          <h2 id="ses-h" style={{ fontSize: "1.4rem", margin: 0 }}>Session settings</h2>
          <fieldset className="field" style={{ marginBottom: 0 }}><legend>How long is each session?</legend>
            <div className="choices">{[15, 20, 30, 45, 60, 90].map((m) => <label key={m} className="choice"><input type="radio" name="dur" checked={sch.durationMin === m} onChange={() => set({ durationMin: m })} /><span>{m} min</span></label>)}</div></fieldset>
          <div className="row">
            <div className="field" style={{ marginBottom: 0 }}><label className="label" htmlFor="buf">Break between sessions</label>
              <select id="buf" value={sch.bufferMin} onChange={(e) => set({ bufferMin: Number(e.target.value) })}>{[0, 5, 10, 15, 20, 30, 45, 60].map((m) => <option key={m} value={m}>{m === 0 ? "No break" : `${m} minutes`}</option>)}</select></div>
            <div className="field" style={{ marginBottom: 0, flex: "1 1 220px" }}><label className="label" htmlFor="sn">These times belong to</label>
              <select id="sn" value={sch.seasonId ?? ""} onChange={(e) => set({ seasonId: e.target.value || null })}><option value="">Choose a season…</option>{seasons.map((s) => <option key={s.id} value={s.id}>{s.name}{s.status === "draft" ? " (draft)" : ""}</option>)}</select></div>
          </div>
          <div className="row">
            <div className="field" style={{ marginBottom: 0 }}><label className="label" htmlFor="wf">Starts on (optional)</label><input id="wf" type="date" value={sch.windowFrom ?? ""} onChange={(e) => set({ windowFrom: e.target.value || null })} /></div>
            <div className="field" style={{ marginBottom: 0 }}><label className="label" htmlFor="wt">Ends on (optional)</label><input id="wt" type="date" value={sch.windowTo ?? ""} onChange={(e) => set({ windowTo: e.target.value || null })} /></div>
          </div>
          <label className="choice"><input type="checkbox" checked={sch.autoFill} onChange={(e) => set({ autoFill: e.target.checked })} /><span>Keep adding new dates automatically as time goes on</span></label>
          <p className="hint" style={{ margin: 0 }}>Leave the end date empty to keep going as far ahead as clients can book. With the box ticked, new weeks appear on their own; times you've closed stay closed.</p>
        </section>

        <section className="card stack" aria-labelledby="ov-h">
          <h2 id="ov-h" style={{ fontSize: "1.4rem", margin: 0 }}>Date overrides</h2>
          <p className="hint" style={{ margin: 0 }}>Holidays, vacations or a special extra day? Override the weekly hours for specific dates.</p>
          {sch.overrides.length === 0 && !ov && <p className="muted" style={{ margin: 0 }}>None yet.</p>}
          <ul className="list">{sch.overrides.map((o) => <li key={o.date} className="row between"><span><strong>{formatDateShort(new Date(o.date + "T19:00:00Z"), "UTC")}</strong> · {o.ranges ? o.ranges.map((r) => `${label(r.start)}–${label(r.end)}`).join(", ") : "Unavailable all day"}</span><button className="btn btn-ghost btn-sm" onClick={() => set({ overrides: sch.overrides.filter((x) => x.date !== o.date) })}>Remove</button></li>)}</ul>
          {!ov ? <div><button className="btn btn-ghost btn-sm" onClick={() => setOv({ dates: new Set(), off: true, ranges: [{ start: "10:00", end: "12:00" }] })}>+ Add an override</button></div> : (
            <div className="card stack" style={{ boxShadow: "none", background: "var(--tint)" }}>
              <strong>1. Tap the dates</strong>
              <Calendar mode="multi" year={ovMonth.y} month={ovMonth.m} today={today} available={{}} selected={null} multi={ov.dates} onSelect={(d) => setOv((p) => { if (!p) return p; const n = new Set(p.dates); n.has(d) ? n.delete(d) : n.add(d); return { ...p, dates: n }; })} onMonth={(y, m) => setOvMonth({ y, m })} minMonth={{ y: now.getFullYear(), m: now.getMonth() + 1 }} maxMonth={{ y: now.getFullYear() + 2, m: 12 }} />
              <strong>2. What happens on those dates?</strong>
              <label className="choice"><input type="radio" name="ovk" checked={ov.off} onChange={() => setOv({ ...ov, off: true })} /><span>I'm unavailable all day</span></label>
              <label className="choice"><input type="radio" name="ovk" checked={!ov.off} onChange={() => setOv({ ...ov, off: false })} /><span>I have different hours</span></label>
              {!ov.off && <div className="row"><RangeEditor name="Override" ranges={ov.ranges} onChange={(r) => setOv({ ...ov, ranges: r })} /><button className="icon-btn" aria-label="Add a range" disabled={ov.ranges.length >= 4} onClick={() => setOv({ ...ov, ranges: [...ov.ranges, { start: "14:00", end: "16:00" }] })}>＋</button></div>}
              <div className="row"><button className="btn btn-primary btn-sm" disabled={!ov.dates.size || (!ov.off && !ov.ranges.length)} onClick={saveOverride}>Add override{ov.dates.size > 1 ? ` (${ov.dates.size} dates)` : ""}</button><button className="btn btn-ghost btn-sm" onClick={() => setOv(null)}>Cancel</button></div>
            </div>
          )}
        </section>
      </div>

      <div className="stack" style={{ position: "sticky", top: 12 }}>
        <section className="card stack" aria-labelledby="pv-h">
          <h2 id="pv-h" style={{ fontSize: "1.4rem", margin: 0 }}>What clients will see</h2>
          {pvErr && <div className="banner banner-error" role="alert">{pvErr}</div>}
          {!pv ? <div className="skeleton" style={{ minHeight: 200 }} /> : (
            <>
              <Calendar mode="pick" year={pvMonth.y} month={pvMonth.m} today={today} available={counts} selected={pvDate} onSelect={setPvDate} onMonth={(y, m) => setPvMonth({ y, m })} minMonth={{ y: now.getFullYear(), m: now.getMonth() + 1 }} maxMonth={{ y: now.getFullYear() + 2, m: 12 }} />
              {pvDate && <div><strong>{formatDateShort(new Date(pvDate + "T19:00:00Z"), "UTC")}</strong><div className="row" style={{ gap: 6, marginTop: 6 }}>{dayTimes.map((s: any) => <span key={s.startsAt} className={`badge ${s.published ? "badge-ok" : "badge-warn"}`} title={s.published ? "Already published" : "Will be published"}>{formatTime(new Date(s.startsAt), tz)}</span>)}{!dayTimes.length && <span className="muted">Nothing on this date.</span>}</div></div>}
              {dayErrors.length > 0 && <div className="banner banner-error" role="alert">{dayErrors.slice(0, 3).map((d: any) => <div key={d.date}>{d.date}: {d.error}</div>)}</div>}
              <p className="small" style={{ margin: 0 }}><span className="badge badge-warn">{newCount} new</span> <span className="badge badge-ok">{oldCount} already live</span> through {pv.to}. Times are shown in {tz}.</p>
            </>
          )}
          <label className="choice"><input type="checkbox" checked={replace} onChange={(e) => setReplace(e.target.checked)} /><span>Replace unbooked times in this range</span></label>
          <p className="hint" style={{ margin: 0 }}>Use this after changing your hours so old, unbooked times disappear. Booked sessions are never touched.</p>
          <div className="row">
            <button className="btn btn-ghost" disabled={!dirty} onClick={save}>Save schedule</button>
            <button className="btn btn-primary" disabled={busy || !sch.seasonId || (newCount === 0 && !replace)} onClick={publish}>{newCount ? `Publish ${newCount} new time${newCount === 1 ? "" : "s"}` : "Publish times"}</button>
          </div>
          {dirty && <span className="badge badge-warn" style={{ justifySelf: "start" }}>Unsaved changes</span>}
        </section>
      </div>
    </div>
  );
}
