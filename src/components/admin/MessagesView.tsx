"use client";
import { useEffect, useState } from "react";
import { api } from "./api";

export default function MessagesView() {
  const [rows, setRows] = useState<any[] | null>(null);
  useEffect(() => { api("GET", "notifications").then((r) => setRows(r.notifications)); }, []);
  return (
    <div className="stack">
      <h1>Messages</h1>
      <p className="muted" style={{ marginTop: -8 }}>A log of every email this system tried to send, so you can check what went out. Private sign-in links are never stored here.</p>
      {!rows ? <p>Loading…</p> : rows.length === 0 ? <div className="card muted">Nothing yet.</div> : (
        <ul className="list">{rows.map((r) => (
          <li key={r.id}>
            <details><summary style={{ cursor: "pointer", minHeight: 44, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <strong>{r.subject}</strong><span className="muted small">to {r.to_addr} · {new Date(r.created_at).toLocaleString()}</span>
              {r.status === "dev_not_delivered" ? <span className="badge badge-warn">dev mailbox · NOT delivered</span> : <span className="badge badge-ok">{r.status} via {r.provider}</span>}
            </summary><pre style={{ whiteSpace: "pre-wrap", fontFamily: "inherit" }}>{r.body_text}</pre></details>
          </li>))}</ul>
      )}
    </div>
  );
}
