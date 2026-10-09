import type { Metadata } from "next";
import { getActiveSeason, getSeason, getSeasonBySlug } from "@/lib/seasons";
import { getSettings } from "@/lib/settings";
import { currentOwner } from "@/lib/auth";
import { cssVars, type PageContent } from "@/lib/content";
import { localDate } from "@/lib/time";
import { dollars } from "@/lib/format";
import BookingFlow, { type BookingConfig } from "@/components/BookingFlow";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // first visit in demo mode sets up sample content

type SP = Promise<{ season?: string; preview?: string }>;

async function resolve(sp: Awaited<SP>): Promise<{ slug: string; id: string; content: PageContent; preview: boolean } | null> {
  if (sp.preview) {
    if (!(await currentOwner())) return null;
    const s = await getSeason(sp.preview);
    return s ? { slug: s.slug, id: s.id, content: s.draft, preview: true } : null;
  }
  let s = sp.season ? await getSeasonBySlug(sp.season) : await getActiveSeason();
  if (!s && !sp.season) { await (await import("@/lib/seed")).ensureDemoSeed(); s = await getActiveSeason(); }
  if (!s || s.status !== "published" || !s.published) return null;
  return { slug: s.slug, id: s.id, content: s.published, preview: false };
}

export async function generateMetadata({ searchParams }: { searchParams: SP }): Promise<Metadata> {
  const r = await resolve(await searchParams);
  if (!r) return { title: "Mini Sessions" };
  return { title: `${r.content.title} | ${r.content.siteName}`, description: r.content.subhead, robots: r.preview ? { index: false } : undefined };
}

export default async function MiniSessions({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  let r: Awaited<ReturnType<typeof resolve>> = null;
  let setupNote: string | null = null;
  try {
    r = await resolve(sp);
    if (!r) setupNote = (await import("@/lib/seed")).seedError();
  } catch (e) {
    setupNote = e instanceof Error ? e.message.slice(0, 300) : null;
    // Database not connected yet: show the friendly page instead of an error, and say why in the server log.
    console.error("[mini-sessions] page unavailable:", e instanceof Error ? e.message : e);
  }
  if (!r) {
    return (
      <main className="wrap" style={{ padding: "80px 0", textAlign: "center" }}>
        <h1>Mini sessions are opening soon</h1>
        <p className="muted">Booking isn't open yet. Please check back soon.</p>
        {process.env.DEMO_SEED === "1" && setupNote && <p className="small muted" style={{ maxWidth: 640, margin: "24px auto" }}>Setup note (only visible while DEMO_SEED is on): {setupNote}</p>}
      </main>
    );
  }
  const c = r.content;
  const s = await getSettings();
  const today = localDate(new Date(), s.timezone);
  const img = (id: string) => `/api/assets/${id}`;
  const logo = c.logoAssetId ? img(c.logoAssetId) : "/xanseye-logo-trim.png";
  const photos = c.photos.slice(0, 3);

  const cfg: BookingConfig = {
    seasonSlug: r.slug, timezone: s.timezone, today, depositCents: s.depositCents, beautyEditCents: s.beautyEditCents, maxPeople: s.maxPeople, demo: s.demoMode,
    sessionPriceCents: c.facts.sessionPriceCents, depositPolicy: c.depositPolicy, durationMin: c.facts.durationMin, location: c.facts.location,
    termsText: c.termsText, refundTerms: c.refundTerms, holdMinutes: s.holdMinutes, beautyCopy: c.beautyCopy, buttonText: c.buttonText, preview: r.preview,
  };
  const f = c.facts;
  const factItems = [
    f.durationMin ? ["Length", `${f.durationMin} minutes`] : null,
    f.sessionPriceCents != null ? ["Session price", dollars(f.sessionPriceCents)] : null,
    ["Deposit", `${dollars(s.depositCents)} to reserve${c.depositPolicy === "credit" ? " (credited)" : ""}`],
    f.deliverables ? ["You receive", f.deliverables] : null,
    f.location ? ["Where", f.location] : null,
    f.turnaround ? ["Delivery", f.turnaround] : null,
  ].filter(Boolean) as string[][];

  return (
    <div style={cssVars(c.colors) as React.CSSProperties}>
      <a className="skip" href="#book">Skip to booking</a>
      <header className="site-header">
        <div className="wrap">
          <a className="btn btn-ghost btn-sm home-link" href="/" aria-label="Back to the xanseye.com home page"><span aria-hidden>←</span> <span className="long">xanseye.com</span><span className="short">Home</span></a>
          <a className="brand" href="/mini-sessions" aria-label={`${c.siteName} home`}><img src={logo} alt="" /><span className="sr-only">{c.siteName}</span></a>
          <nav className="nav" aria-label="Main">
            <a href="#book">Mini Sessions</a>
            {c.show.howItWorks && <a href="#how">How it works</a>}
            {c.show.faqs && c.faqs.length > 0 && <a href="#faq">FAQ</a>}
          </nav>
          <a className="btn btn-primary btn-sm header-cta" href="#book">{c.buttonText}</a>
        </div>
      </header>

      <main id="main">
        <section className="hero">
          <div className="wrap hero-grid">
            <div>
              <p className="small muted" style={{ margin: 0, textTransform: "uppercase", letterSpacing: ".1em", fontWeight: 600 }}>{c.title}</p>
              <h1>{c.headline}</h1>
              {c.subhead && <p>{c.subhead}</p>}
            </div>
            {photos.length > 0 && (
              <div className={`hero-photos ${photos.length === 1 ? "one" : photos.length === 2 ? "two" : ""}`}>
                {photos.map((p, i) => (
                  <figure key={p.assetId}>
                    <img src={img(p.assetId)} alt={p.alt} loading={i === 0 ? "eager" : "lazy"} />
                    {s.demoMode && <span className="demo-tag">Sample photo</span>}
                  </figure>
                ))}
              </div>
            )}
          </div>
        </section>

        <div className="wrap">
          {c.show.facts && factItems.length > 0 && (
            <dl className="facts" style={{ margin: "6px 0 22px" }}>
              {factItems.map(([k, v]) => <div className="fact" key={k}><dt style={{ display: "contents" }}><b>{k}</b></dt><dd style={{ margin: 0 }}><span>{v}</span></dd></div>)}
            </dl>
          )}
          <BookingFlow cfg={cfg} />

          {c.show.howItWorks && c.howItWorks.length > 0 && (
            <section id="how" className="section" aria-labelledby="how-h">
              <h2 id="how-h">How it works</h2>
              <div className="steps-how">{c.howItWorks.map((h) => <div className="card" key={h.title}><h3>{h.title}</h3><p style={{ margin: 0 }}>{h.body}</p></div>)}</div>
            </section>
          )}
          {c.show.prep && c.prepNotes && (
            <section className="section" aria-labelledby="prep-h" style={{ paddingTop: 0 }}>
              <h2 id="prep-h">Getting ready</h2>
              <div className="card" style={{ whiteSpace: "pre-wrap" }}>{c.prepNotes}</div>
            </section>
          )}
          {c.show.faqs && c.faqs.length > 0 && (
            <section id="faq" className="section faq" aria-labelledby="faq-h" style={{ paddingTop: 0 }}>
              <h2 id="faq-h">Questions</h2>
              {c.faqs.map((q) => <details key={q.q}><summary>{q.q}</summary><p>{q.a}</p></details>)}
            </section>
          )}
        </div>
      </main>

      <footer className="site-footer">
        <div className="wrap row between">
          <span>{c.siteName}</span>
          <span><a href="/">← Back to xanseye.com</a> · Already booked? <a href="/manage/recover">Manage your session</a></span>
        </div>
      </footer>
    </div>
  );
}
