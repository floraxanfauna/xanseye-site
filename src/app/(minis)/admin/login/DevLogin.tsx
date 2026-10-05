"use client";
export default function DevLogin() {
  async function go() { const r = await fetch("/api/auth/dev-login", { method: "POST" }); if (r.ok) window.location.href = "/admin"; }
  return (
    <div className="banner banner-demo stack">
      <strong>Local development only</strong>
      <span className="small">This button exists because ALLOW_DEV_LOGIN=1 on this computer. It is switched off on the live website.</span>
      <button className="btn btn-ghost" onClick={go}>Sign in as owner (dev)</button>
    </div>
  );
}
