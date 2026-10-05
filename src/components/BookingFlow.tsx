"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Calendar from "./Calendar";
import IntakeForm from "./IntakeForm";
import { emptyIntake, fieldErrors, normalizeIntake, displayField, FIELD_LABELS, type FieldKey, type Intake } from "@/lib/intake";
import { formatTime, formatDateLong, tzAbbrev, tzLongName } from "@/lib/time";
import { dollars } from "@/lib/format";

interface Slot { id: string; startsAt: string; endsAt: string; date: string }
interface Availability { paused: boolean; slots: Slot[]; dates: Record<string, number>; externalCheck: string; timezone: string }

export interface BookingConfig {
  seasonSlug: string; timezone: string; today: string; depositCents: number; beautyEditCents: number; maxPeople: number; demo: boolean;
  sessionPriceCents: number | null; depositPolicy: "credit" | "refundable" | "nonrefundable" | null; durationMin: number | null; location: string;
  termsText: string; refundTerms: string; holdMinutes: number; beautyCopy: string; buttonText: string; preview: boolean;
}

const STEPS = ["Date & time", "Your details", "Review & reserve"];

export default function BookingFlow({ cfg }: { cfg: BookingConfig }) {
  const [av, setAv] = useState<Availability | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [step, setStep] = useState(1);
  const [date, setDate] = useState<string | null>(null);
  const [slotId, setSlotId] = useState<string | null>(null);
  const [intake, setIntake] = useState<Intake>(() => emptyIntake());
  const [errors, setErrors] = useState<Partial<Record<FieldKey, string>>>({});
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [announce, setAnnounce] = useState("");
  const top = useRef<HTMLDivElement>(null);

  const [ty, tm] = cfg.today.split("-").map(Number);
  const [view, setView] = useState({ y: ty, m: tm });

  const load = useCallback(async () => {
    setLoadErr(null);
    try {
      const r = await fetch(`/api/public/availability?season=${encodeURIComponent(cfg.seasonSlug)}`, { cache: "no-store" });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || "Couldn't load times");
      const j: Availability = await r.json();
      setAv(j);
      const first = Object.keys(j.dates).sort()[0];
      if (first) { const [y, m] = first.split("-").map(Number); setView((v) => (v.y === ty && v.m === tm ? { y, m } : v)); }
    } catch (e) {
      setLoadErr(e instanceof Error ? e.message : "Couldn't load times");
    }
  }, [cfg.seasonSlug, ty, tm]);
  useEffect(() => { load(); }, [load]);

  const slot = useMemo(() => av?.slots.find((s) => s.id === slotId) ?? null, [av, slotId]);
  const daySlots = useMemo(() => (av && date ? av.slots.filter((s) => s.date === date) : []), [av, date]);
  const dateKeys = useMemo(() => Object.keys(av?.dates ?? {}).sort(), [av]);
  const lastKey = dateKeys[dateKeys.length - 1];
  const maxMonth = lastKey ? { y: Number(lastKey.slice(0, 4)), m: Number(lastKey.slice(5, 7)) } : { y: ty, m: tm };
  const nextWithTimes = dateKeys.find((d) => d.slice(0, 7) > `${view.y}-${String(view.m).padStart(2, "0")}`);

  const tz = cfg.timezone;
  const when = slot ? `${formatDateLong(new Date(slot.startsAt), tz)} at ${formatTime(new Date(slot.startsAt), tz)} ${tzAbbrev(new Date(slot.startsAt), tz)}` : "";
  const go = (n: number) => { setStep(n); setProblem(null); requestAnimationFrame(() => top.current?.scrollIntoView({ behavior: "smooth", block: "start" })); };

  function pickDate(d: string) {
    setDate(d); setSlotId(null);
    const n = av?.dates[d] ?? 0;
    setAnnounce(`${new Date(d + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" })} selected. ${n} time${n === 1 ? "" : "s"} available.`);
  }

  function toReview() {
    const errs = fieldErrors(intake);
    setErrors(errs);
    if (Object.keys(errs).length) {
      setProblem(`${Object.keys(errs).length} question${Object.keys(errs).length === 1 ? " needs" : "s need"} an answer. Every question can be answered N/A.`);
      const first = Object.keys(errs)[0];
      requestAnimationFrame(() => document.querySelector<HTMLElement>(`[aria-invalid=true], fieldset[aria-describedby] `)?.scrollIntoView({ block: "center", behavior: "smooth" }));
      void first;
      return;
    }
    go(3);
  }

  async function reserve() {
    if (cfg.preview) { setProblem("This is a preview, so booking is switched off."); return; }
    if (!agree) { setProblem("Please tick the box to agree to the booking terms."); return; }
    if (!slotId) { go(1); return; }
    setBusy(true); setProblem(null);
    try {
      const r = await fetch("/api/public/reserve", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ slotId, intake: normalizeIntake(intake), acceptedTerms: true }) });
      const j = await r.json();
      if (!r.ok) {
        if (j.code === "slot_unavailable" || j.code === "day_full") { setProblem(j.error); setSlotId(null); await load(); go(1); }
        else setProblem(j.error || "Something went wrong. Nothing was charged.");
        setBusy(false);
        return;
      }
      window.location.href = j.checkoutUrl;
    } catch {
      setProblem("I couldn't reach the server. Check your connection. Nothing was charged.");
      setBusy(false);
    }
  }

  const price = cfg.sessionPriceCents;
  const credited = cfg.depositPolicy === "credit";
  const beautyYes = intake.beautyEdit.state === "answered" && intake.beautyEdit.value === "yes";
  const balance = price == null ? null : Math.max(0, price - (credited ? cfg.depositCents : 0)) + (beautyYes ? cfg.beautyEditCents : 0);

  return (
    <section id="book" className="booking" aria-labelledby="book-h" ref={top}>
      <div className="card card-float">
        <h2 id="book-h" className="sr-only">Book your mini session</h2>
        {cfg.demo && <div className="banner banner-demo" style={{ marginBottom: 16 }}><strong>Demo mode.</strong> This page works end to end, but no real money moves and demo values are placeholders.</div>}
        {cfg.preview && <div className="banner banner-info" style={{ marginBottom: 16 }}><strong>Preview.</strong> You're seeing your draft. Booking is switched off here.</div>}

        <ol className="steps" aria-label="Booking steps" style={{ listStyle: "none", padding: 0 }}>
          {STEPS.map((s, i) => (
            <li key={s} style={{ display: "contents" }}>
              <span className={`step${step === i + 1 ? " on" : ""}${step > i + 1 ? " done" : ""}`} aria-current={step === i + 1 ? "step" : undefined}>
                <i>{step > i + 1 ? "✓" : i + 1}</i><span>{s}</span>
              </span>
              {i < 2 && <span className="step-sep" aria-hidden="true" />}
            </li>
          ))}
        </ol>

        <div className="sr-only" aria-live="polite">{announce}</div>
        {problem && <div className="banner banner-error" role="alert" style={{ marginBottom: 16 }}>{problem}</div>}

        {step > 1 && slot && (
          <div className="summary-bar">
            <span><strong>{when}</strong></span>
            <span className="muted small">{tzLongName(new Date(slot.startsAt), tz)}</span>
            {step === 2 && <button className="link-btn" type="button" onClick={() => go(1)}>Change time</button>}
          </div>
        )}

        {/* ---------------- step 1 ---------------- */}
        {step === 1 && (
          <div className="book-grid two">
            <div>
              <h3>1. Select a date</h3>
              {!av && !loadErr && <div className="skeleton" aria-busy="true" aria-label="Loading available dates" />}
              {loadErr && <div className="banner banner-error" role="alert">{loadErr} <button className="link-btn" onClick={load}>Try again</button></div>}
              {av?.paused && <div className="empty"><h3>Booking is paused right now</h3><p className="muted">New sessions will open soon. Please check back.</p></div>}
              {av && !av.paused && av.externalCheck === "error" && <div className="banner banner-info">I'm double-checking my calendar. Please try again in a minute. <button className="link-btn" onClick={load}>Refresh</button></div>}
              {av && !av.paused && dateKeys.length === 0 && av.externalCheck !== "error" && (
                <div className="empty"><h3>No open times right now</h3><p className="muted">All current sessions are booked. New dates are added regularly. Check back soon!</p></div>
              )}
              {av && !av.paused && dateKeys.length > 0 && (
                <>
                  <Calendar year={view.y} month={view.m} today={cfg.today} available={av.dates} selected={date} onSelect={pickDate}
                    onMonth={(y, m) => setView({ y, m })} minMonth={{ y: ty, m: tm }} maxMonth={maxMonth} />
                  {!Object.keys(av.dates).some((d) => d.startsWith(`${view.y}-${String(view.m).padStart(2, "0")}`)) && nextWithTimes && (
                    <p className="small" style={{ marginTop: 10 }}>No times this month. <button className="link-btn" onClick={() => { const [y, m] = nextWithTimes.split("-").map(Number); setView({ y, m }); }}>Jump to the next month with times →</button></p>
                  )}
                  <details className="date-alt">
                    <summary>See available dates as a list</summary>
                    <ul className="date-list">
                      {dateKeys.map((d) => (
                        <li key={d}><button type="button" className="btn btn-ghost btn-sm" style={{ width: "100%", justifyContent: "space-between" }} aria-pressed={date === d}
                          onClick={() => { pickDate(d); const [y, m] = d.split("-").map(Number); setView({ y, m }); }}>
                          <span>{formatDateLong(new Date(d + "T19:00:00Z"), "UTC").replace(/, \d{4}$/, "")}</span><span className="muted">{av.dates[d]} time{av.dates[d] === 1 ? "" : "s"}</span>
                        </button></li>
                      ))}
                    </ul>
                  </details>
                </>
              )}
            </div>

            <div>
              <h3>2. Choose a time</h3>
              <p className="muted small" style={{ marginTop: -4 }}>Times shown in {tzLongName(new Date(), tz)} ({tzAbbrev(new Date(date ? date + "T19:00:00Z" : Date.now()), tz)})</p>
              {!date && <div className="empty"><p className="muted" style={{ margin: 0 }}>Pick a date on the calendar to see its times.</p></div>}
              {date && (
                <div className="times" role="group" aria-label={`Times on ${date}`}>
                  {daySlots.map((s) => (
                    <button key={s.id} type="button" className="time" aria-pressed={slotId === s.id}
                      onClick={() => { setSlotId(s.id); setAnnounce(`${formatTime(new Date(s.startsAt), tz)} selected.`); }}>
                      {formatTime(new Date(s.startsAt), tz)}
                    </button>
                  ))}
                </div>
              )}
              <div style={{ marginTop: 26 }}>
                <button className="btn btn-primary" style={{ width: "100%" }} disabled={!slotId} onClick={() => go(2)}>
                  {slotId ? "Continue to your details →" : "Choose a date and time to continue"}
                </button>
                {slot && <p className="small muted" style={{ marginTop: 10 }}>Selected: <strong>{when}</strong></p>}
              </div>
            </div>
          </div>
        )}

        {/* ---------------- step 2 ---------------- */}
        {step === 2 && (
          <div>
            <h3>Your session details</h3>
            <p className="muted">Every question has an N/A option, so skip anything you'd rather not share. You can update your answers any time after booking.</p>
            <IntakeForm value={intake} onChange={(i) => { setIntake(i); if (Object.keys(errors).length) setErrors(fieldErrors(i)); }} errors={errors}
              maxPeople={cfg.maxPeople} beautyPrice={dollars(cfg.beautyEditCents)} beautyCopy={cfg.beautyCopy} />
            <div className="row between" style={{ marginTop: 10 }}>
              <button className="btn btn-ghost" type="button" onClick={() => go(1)}>← Back</button>
              <button className="btn btn-primary" type="button" onClick={toReview}>Review &amp; reserve →</button>
            </div>
          </div>
        )}

        {/* ---------------- step 3 ---------------- */}
        {step === 3 && slot && (
          <div className="grid-2">
            <div>
              <h3>Review your session</h3>
              <ul className="list">
                <li><strong>When</strong><br />{when}</li>
                {cfg.location && <li><strong>Where</strong><br />{cfg.location}</li>}
                {cfg.durationMin && <li><strong>Length</strong><br />{cfg.durationMin} minutes</li>}
                <li><strong>Your answers</strong>
                  <table className="t" style={{ marginTop: 6 }}><tbody>
                    {(Object.keys(FIELD_LABELS) as FieldKey[]).filter((k) => k !== "photoRelease").map((k) => (
                      <tr key={k}><th scope="row" style={{ width: "40%" }}>{FIELD_LABELS[k]}</th><td>{displayField(normalizeIntake(intake), k)}</td></tr>
                    ))}
                  </tbody></table>
                  <button className="link-btn" type="button" onClick={() => go(2)}>Edit answers</button>
                </li>
              </ul>
            </div>
            <div>
              <h3>Reserve your time</h3>
              <div className="card" style={{ boxShadow: "none", background: "var(--tint)" }}>
                <table className="t" style={{ marginBottom: 6 }}><tbody>
                  <tr><th scope="row">Session price</th><td>{price == null ? "To be confirmed" : dollars(price)}</td></tr>
                  <tr><th scope="row">Deposit due now</th><td><strong>{dollars(cfg.depositCents)}</strong></td></tr>
                  {beautyYes && <tr><th scope="row">Beauty editing (2 photos)</th><td>{dollars(cfg.beautyEditCents)} later</td></tr>}
                  <tr><th scope="row">Balance after session</th><td>{balance == null ? "—" : dollars(balance)}</td></tr>
                </tbody></table>
                <p className="small muted" style={{ marginBottom: 0 }}>
                  {credited ? "Your deposit is credited toward your session. " : ""}Beauty editing is {dollars(cfg.beautyEditCents)} total for two photos and is never charged today.
                </p>
              </div>
              {(cfg.refundTerms || cfg.termsText) && (
                <details style={{ margin: "14px 0" }}>
                  <summary style={{ cursor: "pointer", fontWeight: 600, minHeight: 44, display: "flex", alignItems: "center" }}>Booking terms &amp; refund policy</summary>
                  <div className="small" style={{ whiteSpace: "pre-wrap" }}>{cfg.termsText}{cfg.refundTerms ? `\n\n${cfg.refundTerms}` : ""}</div>
                </details>
              )}
              <label className="choice" style={{ margin: "8px 0 16px" }}>
                <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
                <span>I agree to the booking terms and cancellation policy. <em className="small muted">(Required to book; it isn't an optional question.)</em></span>
              </label>
              <button className="btn btn-primary" style={{ width: "100%" }} disabled={busy} onClick={reserve}>
                {busy ? "Holding your time…" : `Pay ${dollars(cfg.depositCents)} deposit to reserve →`}
              </button>
              <p className="small muted" style={{ marginTop: 10 }}>
                {cfg.demo ? "Demo: you'll see a practice payment page. No real card is used." : "You'll pay securely on Stripe's page. I never see your card number."} Your time is held for about {cfg.holdMinutes} minutes while you pay.
              </p>
              <button className="btn btn-ghost btn-sm" type="button" onClick={() => go(2)} style={{ marginTop: 8 }}>← Back</button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
