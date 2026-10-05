import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { currentOwner, devLoginEnabled } from "@/lib/auth";
import { googleConfigured } from "@/lib/google/client";
import DevLogin from "./DevLogin";

export const metadata: Metadata = { title: "Owner sign-in", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

const ERRORS: Record<string, string> = {
  not_owner: "That Google account isn't allowed to manage this site. Use xanflorafauna@gmail.com.",
  google_not_configured: "Google sign-in isn't set up yet (needs GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET).",
  state: "That sign-in expired. Please try again.", denied: "Sign-in was canceled.", unverified: "That Google account's email isn't verified.", failed: "Sign-in didn't work. Please try again.",
};

export default async function Login({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  if (await currentOwner()) redirect("/admin");
  const { error } = await searchParams;
  const g = googleConfigured();
  return (
    <main className="wrap" style={{ maxWidth: 520, padding: "70px 0" }}>
      <div className="card card-float stack">
        <h1 style={{ fontSize: "2.2rem" }}>Owner sign-in</h1>
        <p className="muted">Only the owner's Google account can open the dashboard.</p>
        {error && <div className="banner banner-error" role="alert">{ERRORS[error] ?? "Sign-in didn't work."}</div>}
        {g ? <a className="btn btn-primary" href="/api/auth/google/start?purpose=login">Sign in with Google</a>
           : <div className="banner banner-info">Google sign-in isn't set up yet. See <strong>SETUP.md → Google</strong>.</div>}
        {devLoginEnabled() && <DevLogin />}
      </div>
    </main>
  );
}
