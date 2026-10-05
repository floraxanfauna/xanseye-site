"use client";
import { useState } from "react";

export default function DemoPay({ bookingId }: { bookingId: string }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function act(outcome: "pay" | "cancel") {
    setBusy(true); setErr(null);
    const r = await fetch("/api/demo/pay", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ bookingId, outcome }) });
    const j = await r.json();
    if (!r.ok) { setErr(j.error || "Something went wrong"); setBusy(false); return; }
    window.location.href = outcome === "pay" ? "/booked" : "/booked?canceled=1";
  }
  return (
    <main className="wrap" style={{ maxWidth: 520, padding: "60px 0" }}>
      <div className="card card-float stack">
        <span className="badge badge-warn" style={{ justifySelf: "start" }}>DEMO PAYMENT</span>
        <h1 style={{ fontSize: "2rem" }}>Practice deposit</h1>
        <p>This stands in for Stripe's secure payment page. <strong>No card is used and no money moves.</strong> When Stripe is connected, clients will see Stripe's real page here instead.</p>
        {err && <div className="banner banner-error" role="alert">{err}</div>}
        <button className="btn btn-primary" disabled={busy} onClick={() => act("pay")}>Pay the deposit (demo)</button>
        <button className="btn btn-ghost" disabled={busy} onClick={() => act("cancel")}>Cancel and go back</button>
      </div>
    </main>
  );
}
