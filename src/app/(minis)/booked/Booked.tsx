"use client";
import { useEffect, useRef, useState } from "react";
import { formatWhen } from "@/lib/time";
import { dollars } from "@/lib/format";

interface Status { found: boolean; ref?: string; status?: string; startsAt?: string; timezone?: string; demo?: boolean; depositCents?: number; location?: string; contact?: "email" | "phone_only" | "none"; email?: boolean; emailWorks?: boolean }

export default function Booked() {
  const [s, setS] = useState<Status | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [tries, setTries] = useState(0);
  const canceled = typeof window !== "undefined" && new URLSearchParams(window.location.search).get("canceled") === "1";
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let stop = false;
    async function poll(n: number) {
      try {
        const j: Status = await (await fetch("/api/public/booking-status", { cache: "no-store" })).json();
        if (stop) return;
        setS(j); setTries(n);
        // keep checking while payment is being confirmed (the server confirms only from a verified payment event)
        if (j.found && j.status === "hold" && n < 45 && !canceled) timer.current = setTimeout(() => poll(n + 1), 2000);
      } catch { if (!stop && n < 45) timer.current = setTimeout(() => poll(n + 1), 3000); }
    }
    poll(0);
    return () => { stop = true; if (timer.current) clearTimeout(timer.current); };
  }, [canceled]);

  async function showLink() {
    const r = await fetch("/api/public/claim-access", { method: "POST" });
    const j = await r.json();
    if (r.ok) setLink(j.link);
  }

  function download() {
    if (!s?.startsAt || !s.timezone) return;
    const lines = [
      "Mini photo session confirmation", "",
      `Reference: ${s.ref}`, `When: ${formatWhen(new Date(s.startsAt), s.timezone)}`, s.location ? `Where: ${s.location}` : "",
      s.demo ? "DEMO booking: no real payment was taken." : `Deposit paid: ${dollars(s.depositCents ?? 0)}`, "",
      link ? "Your private link (keep it secret; anyone with it can edit your answers):" : "", link ?? "",
    ].filter((x) => x !== "");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/plain" }));
    a.download = `mini-session-${s.ref}.txt`; a.click();
  }

  const wrap = (c: React.ReactNode) => <main className="wrap" style={{ maxWidth: 680, padding: "48px 0 80px" }}><div className="card card-float stack">{c}</div></main>;

  if (!s) return wrap(<p aria-live="polite">Checking your booking…</p>);
  if (!s.found) return wrap(<><h1>We couldn't find a booking in this browser</h1><p>If you just paid, give it a minute and refresh. If you booked on another device, use the link in your confirmation email, or <a href="/manage/recover">request a new sign-in link</a>.</p><a className="btn btn-primary" href="/mini-sessions">Back to the booking page</a></>);

  if (s.status === "confirmed") {
    const when = formatWhen(new Date(s.startsAt!), s.timezone!);
    return wrap(
      <>
        {s.demo && <div className="banner banner-demo"><strong>Demo booking.</strong> No real payment was taken.</div>}
        <h1>You're booked!</h1>
        <p style={{ fontSize: "1.2rem" }}><strong>{when}</strong>{s.location ? <><br />{s.location}</> : null}</p>
        <p className="muted">Reference <strong>{s.ref}</strong> · Deposit {s.demo ? "(demo)" : "received"}: {dollars(s.depositCents ?? 0)}</p>

        {s.contact === "email" && s.emailWorks && <div className="banner banner-ok">A confirmation is on its way to your email, with a private link to update your answers any time. Check your spam folder if it doesn't show up.</div>}
        {s.contact === "email" && !s.emailWorks && <div className="banner banner-info" role="note"><strong>Email isn't switched on yet, so no confirmation email was sent.</strong> Please save your private link below.</div>}
        {s.contact !== "email" && (
          <div className="banner banner-info" role="note">
            <strong>{s.contact === "phone_only" ? "No email on file, so I can't email you a confirmation or reminders." : "No contact info on file, so I can't email or call you."}</strong> Please save your private link below. It's the only way back into your booking.{s.contact === "none" ? " If you lose it, I can't verify who you are without contact details." : ""}
          </div>
        )}
        {link ? (
          <div className="stack"><label className="label" htmlFor="lk">Your private link</label><input id="lk" readOnly value={link} onFocus={(e) => e.currentTarget.select()} /><p className="small muted">Keep this private. Anyone with the link can edit your answers.</p></div>
        ) : (
          <button className="btn btn-ghost" onClick={showLink}>{s.contact === "email" ? "Show my private link here too" : "Show my private link"}</button>
        )}
        <div className="row">
          <button className="btn btn-ghost" onClick={download}>Download confirmation</button>
          {link && <a className="btn btn-primary" href={link.replace(/^https?:\/\/[^/]+/, "")}>Edit my answers</a>}
        </div>
      </>,
    );
  }
  if (s.status === "hold") {
    if (canceled) return wrap(<><h1>Payment canceled</h1><p>Nothing was charged. Your time is only held for a short while. To book, start again.</p><a className="btn btn-primary" href="/mini-sessions">Back to the booking page</a></>);
    return wrap(<><h1>Payment received, confirming your booking…</h1><p aria-live="polite">{tries < 40 ? "This usually takes a few seconds. Please keep this page open." : "This is taking longer than usual. Don't pay again. Refresh in a minute, or check your email."}</p></>);
  }
  if (s.status === "review") return wrap(<><h1>We're sorting out a snag</h1><p>Your payment arrived but your booking needs a quick manual check. I've been notified and will email or call you soon. Please don't pay again.</p></>);
  return wrap(<><h1>This hold has ended</h1><p>No payment was taken for it. You can pick a time and try again.</p><a className="btn btn-primary" href="/mini-sessions">Back to the booking page</a></>);
}
