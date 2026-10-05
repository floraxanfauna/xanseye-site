"use client";
import { useState } from "react";

export default function Recover() {
  const [email, setEmail] = useState("");
  const [done, setDone] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true);
    const r = await fetch("/api/manage/recover", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email }) });
    const j = await r.json().catch(() => ({}));
    setDone(r.status === 429 ? "Too many tries. Please wait a few minutes." : j.message || "Done."); setBusy(false);
  }
  return (
    <main className="wrap" style={{ maxWidth: 560, padding: "60px 0" }}>
      <form className="card card-float stack" onSubmit={submit}>
        <h1 style={{ fontSize: "2rem" }}>Manage your session</h1>
        <p>Enter the email you used to book and I'll send a one-time sign-in link. It expires in 30 minutes.</p>
        <div className="field"><label className="label" htmlFor="em">Email</label><input id="em" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
        <button className="btn btn-primary" disabled={busy}>Send my link</button>
        {done && <div className="banner banner-ok" role="status">{done}</div>}
        <details><summary style={{ cursor: "pointer", minHeight: 44, display: "flex", alignItems: "center" }}>I booked without an email</summary>
          <p className="small">Use the private link that was shown on screen when you booked (and in the confirmation file you could download). Without email or phone, I can't verify who you are to send a new one. Message me and we'll sort it out.</p></details>
        <a href="/mini-sessions">← Back to mini sessions</a>
      </form>
    </main>
  );
}
