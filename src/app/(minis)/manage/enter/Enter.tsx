"use client";
import { useEffect, useState } from "react";

/** The secret lives in the URL #fragment: browsers never send it to servers, logs or other sites. We swap it for a cookie, then scrub the URL. */
export default function Enter() {
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    const token = window.location.hash.slice(1);
    window.history.replaceState(null, "", window.location.pathname);
    if (!token) { setErr("This link is incomplete. Please use the full link from your email."); return; }
    fetch("/api/manage/exchange", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }) })
      .then(async (r) => { if (r.ok) window.location.replace("/manage"); else setErr((await r.json()).error || "That link didn't work."); })
      .catch(() => setErr("I couldn't reach the server. Please try again."));
  }, []);
  return (
    <main className="wrap" style={{ maxWidth: 560, padding: "60px 0" }}>
      <div className="card stack">
        {!err ? <p aria-live="polite">Opening your booking…</p> : (<><h1>That link didn't work</h1><p>{err}</p><a className="btn btn-primary" href="/manage/recover">Get a new sign-in link</a></>)}
      </div>
    </main>
  );
}
