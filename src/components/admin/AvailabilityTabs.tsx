"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import ScheduleView from "./ScheduleView";
import AvailabilityView from "./AvailabilityView";
import SlotEditor from "./SlotEditor";
import { api } from "./api";

export default function AvailabilityTabs() {
  const [tab, setTab] = useState<"weekly" | "dates" | "edit">("weekly");
  const [types, setTypes] = useState<any[] | null>(null);
  const [typeId, setTypeId] = useState("");
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([api("GET", "seasons"), api("GET", "types")]).then(([s, t]) => {
      const live = s.seasons.find((x: any) => x.status === "published") ?? s.seasons[0];
      const list = (t.types as any[]).filter((x) => x.active || true);
      list.sort((a, b) => (a.seasonId === live?.id ? -1 : 0) - (b.seasonId === live?.id ? -1 : 0));
      setTypes(list);
      const want = new URLSearchParams(window.location.search).get("type");
      setTypeId(list.find((x) => x.id === want)?.id ?? list[0]?.id ?? "");
    }).catch((e) => setErr(e.message));
  }, []);

  const pick = (id: string) => { setTypeId(id); try { const u = new URL(window.location.href); u.searchParams.set("type", id); window.history.replaceState(null, "", u.toString()); } catch { /* ignore */ } };
  const type = types?.find((x) => x.id === typeId);

  if (err) return <div className="banner banner-error" role="alert">{err}</div>;
  if (!types) return <p>Loading…</p>;
  if (!type) return <div className="card stack"><h1 style={{ margin: 0 }}>Availability</h1><p>You need a session type first.</p><Link className="btn btn-primary" href="/admin/session-types">Create a session type</Link></div>;

  return (
    <div className="stack">
      <h1 style={{ marginBottom: 0 }}>Availability</h1>
      <p className="muted" style={{ margin: 0 }}>Set your usual hours once, then publish. Only published times can be booked; free time on your calendar is never made public automatically.</p>
      <div className="row" style={{ gap: 12 }}>
        <div className="field" style={{ marginBottom: 0 }}>
          <label className="label" htmlFor="typesel">Setting hours for</label>
          <select id="typesel" value={typeId} onChange={(e) => pick(e.target.value)} style={{ minWidth: 240, borderLeft: `6px solid ${type.color}` }}>
            {types.map((t) => <option key={t.id} value={t.id}>{t.name}{t.active ? "" : " (hidden)"} · {t.config.durationMin} min</option>)}
          </select>
        </div>
        <Link className="btn btn-ghost btn-sm" href="/admin/session-types" style={{ alignSelf: "end" }}>Manage session types</Link>
      </div>
      <div className="row" role="tablist" aria-label="How to set availability">
        <button role="tab" aria-selected={tab === "weekly"} className={`btn btn-sm ${tab === "weekly" ? "btn-primary" : "btn-ghost"}`} onClick={() => setTab("weekly")}>Weekly schedule</button>
        <button role="tab" aria-selected={tab === "edit"} className={`btn btn-sm ${tab === "edit" ? "btn-primary" : "btn-ghost"}`} onClick={() => setTab("edit")}>Edit individual times</button>
        <button role="tab" aria-selected={tab === "dates"} className={`btn btn-sm ${tab === "dates" ? "btn-primary" : "btn-ghost"}`} onClick={() => setTab("dates")}>Add several dates at once</button>
      </div>
      {tab === "weekly" ? <ScheduleView key={typeId} typeId={typeId} /> : tab === "edit" ? <SlotEditor key={typeId} typeId={typeId} seasonId={type.seasonId} /> : <AvailabilityView key={typeId} embedded typeId={typeId} seasonId={type.seasonId} />}
    </div>
  );
}
