"use client";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import Calendar, { ymdOf } from "../Calendar";
import { api } from "./api";
import { useToast } from "./Toast";
import { formatDateLong, localParts } from "@/lib/time";

const pad = (n: number) => String(n).padStart(2, "0");
const label = (hhmm: string) => { const [h, m] = hhmm.split(":").map(Number); return `${((h + 11) % 12) + 1}:${pad(m)} ${h < 12 ? "AM" : "PM"}`; };
const STARTS = (() => { const o: string[] = []; for (let m = 5 * 60; m < 24 * 60; m += 5) o.push(`${pad(Math.floor(m / 60))}:${pad(m % 60)}`); return o; })();
const LENGTHS = [15, 20, 25, 30, 40, 45, 50, 60, 75, 90, 120];
const BREAKS = [0, 5, 10, 15, 20, 30, 45, 60];
const withCur = (list: number[], cur: number) => (list.includes(cur) ? list : [...list, cur].sort((a, b) => a - b));

interface Row { id: string; startsAt: string; endsAt: string; bufferEnd: string; state: string; booking: { id: string; ref: string } | null }

function SlotRow({ s, tz, date, onChanged, notify }: { s: Row; tz: string; date: string; onChanged: () => void; notify: (t: string, k?: "ok" | "error") => void }) {
  const lp = localParts(new Date(s.startsAt), tz);
  const startNow = `${pad(lp.h)}:${pad(lp.mi)}`;
  const lenNow = Math.round((+new Date(s.endsAt) - +new Date(s.startsAt)) / 60000);
  const brkNow = Math.round((+new Date(s.bufferEnd) - +new Date(s.endsAt)) / 60000);
  const [start, setStart] = useState(startNow), [len, setLen] = useState(lenNow), [brk, setBrk] = useState(brkNow);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setStart(startNow); setLen(lenNow); setBrk(brkNow); }, [startNow, lenNow, brkNow]);
  const changed = start !== startNow || len !== lenNow || brk !== brkNow;
  const run = async (fn: () => Promise<string | void>) => { setBusy(true); try { const m = await fn(); if (m) notify(m); onChanged(); } catch (e: any) { notify(e.message, "error"); } finally { setBusy(false); } };

  if (s.booking) return (
    <li className="row between"><span><strong>{label(startNow)}</strong> · {lenNow} min <span className="badge badge-ok">booked {s.booking.ref}</span></span>
      <Link className="btn btn-ghost btn-sm" href={`/admin/sessions/${s.booking.id}`}>Open session</Link></li>
  );
  const hidden = s.state === "closed";
  return (
    <li className="stack" style={{ gap: 8, opacity: hidden ? .75 : 1 }}>
      <div className="row" style={{ gap: 10, alignItems: "end" }}>
        <div className="field" style={{ marginBottom: 0 }}><label className="label small" htmlFor={`st-${s.id}`}>Starts</label>
          <select id={`st-${s.id}`} value={start} onChange={(e) => setStart(e.target.value)} style={{ width: "auto", minWidth: 120 }}>{(STARTS.includes(start) ? STARTS : [...STARTS, start].sort()).map((o) => <option key={o} value={o}>{label(o)}</option>)}</select></div>
        <div className="field" style={{ marginBottom: 0 }}><label className="label small" htmlFor={`ln-${s.id}`}>Length</label>
          <select id={`ln-${s.id}`} value={len} onChange={(e) => setLen(Number(e.target.value))} style={{ width: "auto" }}>{withCur(LENGTHS, len).map((o) => <option key={o} value={o}>{o} min</option>)}</select></div>
        <div className="field" style={{ marginBottom: 0 }}><label className="label small" htmlFor={`br-${s.id}`}>Break after</label>
          <select id={`br-${s.id}`} value={brk} onChange={(e) => setBrk(Number(e.target.value))} style={{ width: "auto" }}>{withCur(BREAKS, brk).map((o) => <option key={o} value={o}>{o === 0 ? "none" : `${o} min`}</option>)}</select></div>
        <button className="btn btn-primary btn-sm" disabled={!changed || busy} onClick={() => run(async () => { await api("POST", "slots/update", { id: s.id, date, startTime: start, durationMin: len, bufferMin: brk }); return "Time updated."; })}>Save</button>
        <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => run(async () => { await api("POST", hidden ? "slots/reopen" : "slots/close", { ids: [s.id] }); return hidden ? "Time is bookable again." : "Time hidden from clients."; })}>{hidden ? "Show to clients" : "Hide"}</button>
        <button className="btn btn-danger btn-sm" disabled={busy} onClick={() => { if (confirm(`Remove the ${label(startNow)} time?`)) run(async () => { await api("POST", "slots/delete", { id: s.id }); return "Time removed."; }); }}>Remove</button>
      </div>
      {hidden && <span className="small muted">Hidden: clients can't see or book this time.</span>}
    </li>
  );
}

export default function SlotEditor({ typeId, seasonId: seasonProp }: { typeId: string; seasonId: string }) {
  const { show, node } = useToast();
  const now = new Date();
  const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const seasonId = seasonProp;
  const [tz, setTz] = useState("America/Denver");
  const [dur0, setDur0] = useState(30);
  const [brk0, setBrk0] = useState(15);
  const [view, setView] = useState({ y: now.getFullYear(), m: now.getMonth() + 1 });
  const [date, setDate] = useState<string | null>(null);
  const [slots, setSlots] = useState<any[]>([]);
  const [add, setAdd] = useState({ start: "10:00", len: 30, brk: 15 });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    Promise.all([api("GET", `type/${typeId}`), api("GET", "settings")]).then(([t, st]) => {
      setTz(st.settings.timezone); setDur0(t.type.config.durationMin); setBrk0(t.type.config.bufferMin);
      setAdd((a) => ({ ...a, len: t.type.config.durationMin, brk: t.type.config.bufferMin }));
    }).catch((e) => show(e.message, "error"));
  }, [show, typeId]);

  const load = useCallback(async () => {
    const last = new Date(Date.UTC(view.y, view.m, 0)).getUTCDate();
    const r = await api("GET", `slots?from=${ymdOf(view.y, view.m, 1)}&to=${ymdOf(view.y, view.m, last)}&type=${typeId}`);
    setSlots(r.slots);
  }, [view, typeId]);
  useEffect(() => { load().catch((e) => show(e.message, "error")); }, [load, show]);

  const counts = useMemo(() => { const c: Record<string, number> = {}; for (const s of slots) if (s.state === "open") c[s.date] = (c[s.date] ?? 0) + 1; return c; }, [slots]);
  const dayRows: Row[] = useMemo(() => slots.filter((s) => s.date === date), [slots, date]);

  async function addTime() {
    if (!date || !seasonId) return;
    setBusy(true);
    try { await api("POST", "slots/add", { seasonId, typeId, date, startTime: add.start, durationMin: add.len, bufferMin: add.brk }); show("Time added."); await load(); }
    catch (e: any) { show(e.message, "error"); } finally { setBusy(false); }
  }

  return (
    <div className="grid-2" style={{ alignItems: "start" }}>
      {node}
      <section className="card stack" aria-labelledby="ed-h">
        <h2 id="ed-h" style={{ fontSize: "1.4rem", margin: 0 }}>1. Pick a date</h2>
        <p className="hint" style={{ margin: 0 }}>Small numbers show how many times are open. Pick any day to change its times or add an extra one.</p>
        <Calendar mode="multi" year={view.y} month={view.m} today={today} available={counts} selected={null} multi={new Set(date ? [date] : [])} onSelect={setDate} onMonth={(y, m) => setView({ y, m })} minMonth={{ y: now.getFullYear(), m: now.getMonth() + 1 }} maxMonth={{ y: now.getFullYear() + 2, m: 12 }} />
      </section>

      <section className="card stack" aria-labelledby="ed2-h">
        <h2 id="ed2-h" style={{ fontSize: "1.4rem", margin: 0 }}>2. Change its times</h2>
        {!date ? <div className="empty"><p className="muted" style={{ margin: 0 }}>Pick a date on the calendar.</p></div> : (
          <>
            <strong>{formatDateLong(new Date(date + "T19:00:00Z"), "UTC").replace(/, \d{4}$/, "")}</strong>
            {dayRows.length === 0 ? <p className="muted" style={{ margin: 0 }}>No times on this day yet. Add one below.</p> : (
              <ul className="list">{dayRows.map((s) => <SlotRow key={s.id} s={s} tz={tz} date={date} onChanged={load} notify={show} />)}</ul>
            )}
            <div className="card stack" style={{ boxShadow: "none", background: "var(--tint)" }}>
              <strong>+ Add an extra time on this day</strong>
              <div className="row" style={{ gap: 10, alignItems: "end" }}>
                <div className="field" style={{ marginBottom: 0 }}><label className="label small" htmlFor="a-st">Starts</label>
                  <select id="a-st" value={add.start} onChange={(e) => setAdd({ ...add, start: e.target.value })} style={{ width: "auto", minWidth: 120 }}>{STARTS.map((o) => <option key={o} value={o}>{label(o)}</option>)}</select></div>
                <div className="field" style={{ marginBottom: 0 }}><label className="label small" htmlFor="a-ln">Length</label>
                  <select id="a-ln" value={add.len} onChange={(e) => setAdd({ ...add, len: Number(e.target.value) })} style={{ width: "auto" }}>{withCur(LENGTHS, dur0).map((o) => <option key={o} value={o}>{o} min</option>)}</select></div>
                <div className="field" style={{ marginBottom: 0 }}><label className="label small" htmlFor="a-br">Break after</label>
                  <select id="a-br" value={add.brk} onChange={(e) => setAdd({ ...add, brk: Number(e.target.value) })} style={{ width: "auto" }}>{withCur(BREAKS, brk0).map((o) => <option key={o} value={o}>{o === 0 ? "none" : `${o} min`}</option>)}</select></div>
                <button className="btn btn-primary btn-sm" disabled={busy || !seasonId} onClick={addTime}>Add time</button>
              </div>
            </div>
            <p className="small muted" style={{ margin: 0 }}>Times that are already booked can't be edited here. Open their session to reschedule or cancel. Times can't overlap each other. If you move or remove a time, your weekly schedule and auto-fill won't bring it back. To start over from your usual hours, publish the weekly schedule with "Replace unbooked times" ticked.</p>
          </>
        )}
      </section>
    </div>
  );
}
