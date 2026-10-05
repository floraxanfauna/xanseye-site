"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "./api";
import { STEP_LABEL } from "./TodayView";
import { dollars } from "@/lib/format";

const FILTERS: [string, string][] = [["upcoming", "Upcoming"], ["past", "Past"], ["canceled", "Canceled & problems"], ["all", "All"]];

export default function SessionsView() {
  const [filter, setFilter] = useState("upcoming");
  const [rows, setRows] = useState<any[] | null>(null);
  useEffect(() => { setRows(null); api("GET", `sessions?filter=${filter}`).then((r) => setRows(r.sessions)); }, [filter]);
  return (
    <div className="stack">
      <h1>Sessions</h1>
      <div className="tabs" role="tablist" aria-label="Filter sessions">
        {FILTERS.map(([k, l]) => <button key={k} role="tab" aria-selected={filter === k} className={`btn btn-sm ${filter === k ? "btn-primary" : "btn-ghost"}`} onClick={() => setFilter(k)}>{l}</button>)}
      </div>
      {!rows ? <p>Loading…</p> : rows.length === 0 ? <div className="card"><p className="muted" style={{ margin: 0 }}>Nothing here.</p></div> : (
        <ul className="list">
          {rows.map((s) => (
            <li key={s.id}>
              <Link href={`/admin/sessions/${s.id}`} style={{ textDecoration: "none", color: "inherit", display: "block" }}>
                <div className="row between"><strong>{s.when}</strong><span className={`badge ${s.status === "confirmed" ? "" : "badge-bad"}`}>{s.status === "confirmed" ? STEP_LABEL[s.workflow] : s.status}</span></div>
                <div>{s.first ?? s.ref} · {s.people} people · {s.purpose} <span className="muted small">({s.ref})</span></div>
                <div className="small muted">Deposit {s.paymentStatus === "paid" ? `paid ${dollars(s.paidCents)}` : s.paymentStatus}{s.contactMissing ? " · ⚠ no email" : ""}{!s.synced.calendar ? " · calendar not synced" : ""}</div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
