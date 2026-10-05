"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { api } from "./api";

const TABS = [
  { href: "/admin", label: "Today" },
  { href: "/admin/availability", label: "Availability" },
  { href: "/admin/sessions", label: "Sessions" },
  { href: "/admin/page-editor", label: "Page editor" },
  { href: "/admin/messages", label: "Messages" },
  { href: "/admin/settings", label: "Settings" },
  { href: "/admin/help", label: "Help" },
];

export default function AdminNav({ email }: { email: string }) {
  const path = usePathname();
  const [paused, setPaused] = useState<boolean | null>(null);
  useEffect(() => { api("GET", "settings").then((r) => setPaused(r.settings.paused)).catch(() => {}); }, []);
  async function togglePause() {
    const next = !paused;
    if (next && !confirm("Pause all new bookings? Existing bookings are not affected.")) return;
    await api("POST", "pause", { paused: next });
    setPaused(next);
  }
  async function out() { await fetch("/api/auth/logout", { method: "POST" }); window.location.href = "/admin/login"; }
  const active = (h: string) => (h === "/admin" ? path === "/admin" : path.startsWith(h));
  return (
    <div className="admin-bar no-print">
      <div className="wrap">
        <strong style={{ fontFamily: "var(--font-serif)", fontSize: "1.3rem" }}>Xan's Eye · Mini Sessions</strong>
        <nav className="tabs" aria-label="Dashboard">
          {TABS.map((t) => <Link key={t.href} href={t.href} aria-current={active(t.href) ? "page" : undefined}>{t.label}</Link>)}
        </nav>
        <div className="row" style={{ marginLeft: "auto" }}>
          {paused !== null && <button className={`btn btn-sm ${paused ? "btn-primary" : "btn-ghost"}`} onClick={togglePause} aria-pressed={paused}>{paused ? "▶ Resume bookings" : "⏸ Pause bookings"}</button>}
          <a className="btn btn-ghost btn-sm" href="/mini-sessions" target="_blank" rel="noreferrer">View page ↗</a>
          <button className="link-btn small" onClick={out} title={email}>Sign out</button>
        </div>
      </div>
    </div>
  );
}
