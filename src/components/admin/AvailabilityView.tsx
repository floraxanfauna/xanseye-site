"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import Calendar, { ymdOf } from "../Calendar";
import { api } from "./api";
import { useToast } from "./Toast";
import { formatTime, formatDateShort } from "@/lib/time";

type Brk = { start: string; end: string };

export default function AvailabilityView({ embedded }: { embedded?: boolean }) {
  const { show, node } = useToast();
  const [seasons, setSeasons] = useState<any[]>([]);
  const [seasonId, setSeasonId] = useState("");
  const [tz, setTz] = useState("America/Denver");
  const now = new Date();
  const [view, setView] = useState({ y: now.getFullYear(), m: now.getMonth() + 1 });
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [slots, setSlots] = useState<any[]>([]);
  const [form, setForm] = useState({ startTime: "10:00", endTime: "12:30", durationMin: 30, bufferMin: 15 });
  const [breaks, setBreaks] = useState<Brk[]>([]);
  const [preview, setPreview] = useState<any[] | null>(null);
  const [selectedSlots, setSelectedSlots] = useState<Set<string>>(new Set());
  const [lastClosed, setLastClosed] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    Promise.all([api("GET", "seasons"), api("GET", "settings")]).then(([s, st]) => {
      setSeasons(s.seasons.filter((x: any) => x.status !== "archived")); setTz(st.settings.timezone);
      const pub = s.seasons.find((x: any) => x.status === "published") ?? s.seasons[0];
      if (pub) setSeasonId(pub.id);
    }).catch((e) => show(e.message, "error"));
  }, [show]);

  const loadSlots = useCallback(async () => {
    if (!seasonId) return;
    const last = new Date(Date.UTC(view.y, view.m, 0)).getUTCDate();
    const r = await api("GET", `slots?from=${ymdOf(view.y, view.m, 1)}&to=${ymdOf(view.y, view.m, last)}`);
    setSlots(r.slots);
  }, [seasonId, view]);
  useEffect(() => { loadSlots(); }, [loadSlots]);

  const counts = useMemo(() => { const c: Record<string, number> = {}; for (const s of slots) if (s.state === "open") c[s.date] = (c[s.date] ?? 0) + 1; return c; }, [slots]);
  const byDate = useMemo(() => { const m = new Map<string, any[]>(); for (const s of slots) m.set(s.date, [...(m.get(s.date) ?? []), s]); return [...m.entries()]; }, [slots]);
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

  const payload = () => ({ seasonId, dates: [...picked].sort(), ...form, breaks: breaks.filter((b) => b.start && b.end) });

  async function doPreview() {
    if (!picked.size) return show("Pick at least one date on the calendar first.", "error");
    setBusy(true);
    try { setPreview((await api("POST", "slots/preview", payload())).days); } catch (e: any) { show(e.message, "error"); } finally { setBusy(false); }
  }
  async function doPublish() {
    setBusy(true);
    try {
      const r = await api("POST", "slots/publish", payload());
      show(`Published ${r.created} time${r.created === 1 ? "" : "s"}${r.skippedConflicts.length ? `. Skipped ${r.skippedConflicts.length} that overlapped something` : ""}.`);
      setPreview(null); setPicked(new Set()); loadSlots();
    } catch (e: any) { show(e.message, "error"); } finally { setBusy(false); }
  }
  async function closeSelected() {
    const ids = [...selectedSlots];
    if (!ids.length) return;
    if (!confirm(`Close ${ids.length} time${ids.length === 1 ? "" : "s"}? Clients won't be able to book them. Booked sessions are never touched.`)) return;
    const r = await api("POST", "slots/close", { ids });
    setLastClosed(ids.filter((i) => !r.refused.some((x: any) => x.id === i)));
    show(`Closed ${r.closed}.${r.refused.length ? ` ${r.refused.length} already booked, so cancel or reschedule those from Sessions.` : ""}`, r.refused.length ? "error" : "ok");
    setSelectedSlots(new Set()); loadSlots();
  }
  async function undo() { const r = await api("POST", "slots/reopen", { ids: lastClosed }); setLastClosed([]); show(`Reopened ${r.reopened}.`); loadSlots(); }

  const toggle = (d: string) => setPicked((p) => { const n = new Set(p); n.has(d) ? n.delete(d) : n.add(d); return n; });

  return (
    <div className="stack">
      {node}
      {!embedded && <h1>Availability</h1>}
      <div className="grid-2">
        <section className="card stack" aria-labelledby="pick-h">
          <h2 id="pick-h" style={{ fontSize: "1.4rem", margin: 0 }}>1. Pick dates</h2>
          <div className="field" style={{ marginBottom: 0 }}>
            <label className="label" htmlFor="season">Season these times belong to</label>
            <select id="season" value={seasonId} onChange={(e) => setSeasonId(e.target.value)}>{seasons.map((s) => <option key={s.id} value={s.id}>{s.name}{s.status === "draft" ? " (draft)" : ""}</option>)}</select>
          </div>
          <Calendar mode="multi" year={view.y} month={view.m} today={today} available={counts} selected={null} multi={picked} onSelect={toggle} onMonth={(y, m) => setView({ y, m })} minMonth={{ y: now.getFullYear(), m: now.getMonth() + 1 }} maxMonth={{ y: now.getFullYear() + 2, m: 12 }} />
          <p className="small muted" style={{ margin: 0 }}>{picked.size ? `${picked.size} date${picked.size === 1 ? "" : "s"} picked: ${[...picked].sort().slice(0, 6).join(", ")}${picked.size > 6 ? "…" : ""}` : "Tap days to pick them. Small numbers show times already published."} {picked.size > 0 && <button className="link-btn" onClick={() => setPicked(new Set())}>Clear</button>}</p>
        </section>

        <section className="card stack" aria-labelledby="times-h">
          <h2 id="times-h" style={{ fontSize: "1.4rem", margin: 0 }}>2. Set the times</h2>
          <div className="row">
            <div className="field" style={{ marginBottom: 0, flex: "1 1 130px" }}><label className="label" htmlFor="st">First session starts</label><input id="st" type="time" value={form.startTime} onChange={(e) => setForm({ ...form, startTime: e.target.value })} /></div>
            <div className="field" style={{ marginBottom: 0, flex: "1 1 130px" }}><label className="label" htmlFor="en">Last session ends by</label><input id="en" type="time" value={form.endTime} onChange={(e) => setForm({ ...form, endTime: e.target.value })} /></div>
          </div>
          <div className="row">
            <div className="field" style={{ marginBottom: 0, flex: "1 1 130px" }}><label className="label" htmlFor="du">Session length (min)</label><input id="du" type="number" min={10} max={480} value={form.durationMin} onChange={(e) => setForm({ ...form, durationMin: Number(e.target.value) })} /></div>
            <div className="field" style={{ marginBottom: 0, flex: "1 1 130px" }}><label className="label" htmlFor="bu">Buffer between (min)</label><input id="bu" type="number" min={0} max={240} value={form.bufferMin} onChange={(e) => setForm({ ...form, bufferMin: Number(e.target.value) })} /></div>
          </div>
          <div>
            {breaks.map((b, i) => (
              <div className="row" key={i} style={{ marginBottom: 8 }}>
                <label className="small">Break from <input type="time" aria-label="Break start" value={b.start} onChange={(e) => setBreaks(breaks.map((x, j) => (j === i ? { ...x, start: e.target.value } : x)))} /></label>
                <label className="small">to <input type="time" aria-label="Break end" value={b.end} onChange={(e) => setBreaks(breaks.map((x, j) => (j === i ? { ...x, end: e.target.value } : x)))} /></label>
                <button className="btn btn-ghost btn-sm" onClick={() => setBreaks(breaks.filter((_, j) => j !== i))}>Remove</button>
              </div>
            ))}
            {breaks.length < 4 && <button className="btn btn-ghost btn-sm" onClick={() => setBreaks([...breaks, { start: "12:00", end: "13:00" }])}>+ Add a lunch break / blackout</button>}
          </div>
          <div className="row"><button className="btn btn-ghost" disabled={busy} onClick={doPreview}>Preview times</button></div>
          {preview && (
            <div className="stack" aria-live="polite">
              <h3 style={{ margin: 0 }}>Preview</h3>
              {preview.map((d) => (
                <div key={d.date}><strong>{formatDateShort(new Date(d.date + "T19:00:00Z"), "UTC")}</strong>{d.error ? <div className="error">{d.error}</div> : <div className="row" style={{ gap: 6, marginTop: 4 }}>{d.slots.map((s: any) => <span key={s.startsAt} className="badge">{formatTime(new Date(s.startsAt), tz)}–{formatTime(new Date(s.endsAt), tz)}</span>)}{!d.slots.length && <span className="muted">No sessions fit</span>}</div>}</div>
              ))}
              <button className="btn btn-primary" disabled={busy || preview.every((d) => d.error || !d.slots.length)} onClick={doPublish}>Publish these times</button>
              <p className="small muted" style={{ margin: 0 }}>Times that overlap something already published or booked are skipped, never forced.</p>
            </div>
          )}
        </section>
      </div>

      <section className="card stack" aria-labelledby="pub-h">
        <div className="row between"><h2 id="pub-h" style={{ fontSize: "1.4rem", margin: 0 }}>Published times this month</h2>
          <div className="row">{lastClosed.length > 0 && <button className="btn btn-ghost btn-sm" onClick={undo}>Undo last close</button>}<button className="btn btn-danger btn-sm" disabled={!selectedSlots.size} onClick={closeSelected}>Close {selectedSlots.size || ""} selected</button></div></div>
        {byDate.length === 0 && <p className="muted">Nothing published this month.</p>}
        {byDate.map(([date, list]) => (
          <div key={date}><strong>{formatDateShort(new Date(date + "T19:00:00Z"), "UTC")}</strong>
            <div className="row" style={{ gap: 8, marginTop: 6 }}>
              {list.map((s: any) => {
                const label = `${formatTime(new Date(s.startsAt), tz)}${s.booking ? ` · ${s.booking.ref}` : s.state === "closed" ? " · closed" : ""}`;
                return s.booking ? <span key={s.id} className="badge badge-ok">{label}</span> : s.state === "closed" ? <span key={s.id} className="badge badge-warn">{label}</span> : (
                  <label key={s.id} className="choice"><input type="checkbox" checked={selectedSlots.has(s.id)} onChange={(e) => setSelectedSlots((p) => { const n = new Set(p); e.target.checked ? n.add(s.id) : n.delete(s.id); return n; })} /><span>{label}</span></label>
                );
              })}
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}
