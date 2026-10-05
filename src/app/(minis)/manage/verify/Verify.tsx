"use client";
import { useEffect, useState } from "react";
export default function Verify() {
  const [state, setState] = useState<"working" | "ok" | "bad">("working");
  useEffect(() => {
    const token = window.location.hash.slice(1);
    window.history.replaceState(null, "", window.location.pathname);
    fetch("/api/manage/verify-email", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }) }).then((r) => setState(r.ok ? "ok" : "bad")).catch(() => setState("bad"));
  }, []);
  return (
    <main className="wrap" style={{ maxWidth: 560, padding: "60px 0" }}>
      <div className="card stack">
        {state === "working" && <p>Confirming…</p>}
        {state === "ok" && <><h1>Email confirmed</h1><p>I'll use this address for your confirmation, reminders and sign-in links.</p></>}
        {state === "bad" && <><h1>That link didn't work</h1><p>It may have expired. Open your booking and save your email again to get a fresh one.</p><a className="btn btn-primary" href="/manage/recover">Manage your session</a></>}
      </div>
    </main>
  );
}
