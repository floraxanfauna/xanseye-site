"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "./api";
import { useToast } from "./Toast";
import { THEMES, contrastIssues, launchGaps, type PageContent } from "@/lib/content";

const COLOR_FIELDS: [keyof PageContent["colors"], string, string][] = [
  ["bg", "Page background", "The soft color behind everything."], ["surface", "Cards", "Boxes that hold the calendar and forms."], ["text", "Text", "Main reading color."],
  ["accent", "Buttons & selected", "Your main color."], ["accentText", "Text on buttons", "Must be easy to read on your main color."], ["sage", "Available dates", "Soft highlight for open dates."], ["gold", "Little accents", "Small decorative touches."],
];

export default function EditorView() {
  const { show, node } = useToast();
  const [seasons, setSeasons] = useState<any[]>([]);
  const [id, setId] = useState("");
  const [c, setC] = useState<PageContent | null>(null);
  const [meta, setMeta] = useState<any>(null);
  const [dirty, setDirty] = useState(false);
  const [assets, setAssets] = useState<any[]>([]);
  const [versions, setVersions] = useState<any[]>([]);
  const [previewKey, setPreviewKey] = useState(0);
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop");
  const [busy, setBusy] = useState(false);

  const loadSeasons = useCallback(async (select?: string) => {
    const r = await api("GET", "seasons");
    setSeasons(r.seasons);
    const pick = select ?? id ?? "";
    setId(r.seasons.find((s: any) => s.id === pick)?.id ?? r.seasons.find((s: any) => s.status === "published")?.id ?? r.seasons[0]?.id ?? "");
  }, [id]);
  useEffect(() => { loadSeasons().catch((e) => show(e.message, "error")); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const loadSeason = useCallback(async () => {
    if (!id) return;
    const [r, v, a] = await Promise.all([api("GET", `season/${id}`), api("GET", `season/${id}/versions`), api("GET", "assets")]);
    setC(r.season.draft); setMeta(r.season); setVersions(v.versions); setAssets(a.assets); setDirty(false);
  }, [id]);
  useEffect(() => { loadSeason().catch((e) => show(e.message, "error")); }, [loadSeason, show]);

  const set = (patch: Partial<PageContent>) => { setC((p) => (p ? { ...p, ...patch } : p)); setDirty(true); };
  const setFacts = (patch: Partial<PageContent["facts"]>) => c && set({ facts: { ...c.facts, ...patch } });
  const issues = useMemo(() => (c ? contrastIssues(c.colors) : []), [c]);
  const gaps = useMemo(() => (c ? launchGaps(c) : []), [c]);

  async function save(): Promise<boolean> {
    if (!c) return false;
    setBusy(true);
    try { await api("PUT", `season/${id}/draft`, { content: c }); setDirty(false); setPreviewKey((k) => k + 1); show("Draft saved."); await loadSeasons(id); return true; }
    catch (e: any) { show(e.message, "error"); return false; } finally { setBusy(false); }
  }
  async function publish() {
    if (dirty && !(await save())) return;
    if (!confirm("Publish this page? Clients will see it at your booking link right away.")) return;
    setBusy(true);
    try { await api("POST", `season/${id}/publish`, {}); show("Published! Your page is live."); await loadSeason(); await loadSeasons(id); }
    catch (e: any) { show(e.message, "error"); } finally { setBusy(false); }
  }
  async function newSeason(dup: boolean) {
    const name = prompt(dup ? "Name for the copy (e.g. Holiday Mini Sessions)" : "Name for the new season (e.g. Spring Mini Sessions)");
    if (!name) return;
    try { const r = await api("POST", "seasons", { name, duplicateFrom: dup ? id : undefined }); await loadSeasons(r.season.id); show("Created. It starts as a draft."); } catch (e: any) { show(e.message, "error"); }
  }
  async function upload(file: File, forLogo = false) {
    const fd = new FormData(); fd.append("file", file); fd.append("alt", "");
    try {
      const r = await api("POST", "assets", fd);
      const a = await api("GET", "assets"); setAssets(a.assets);
      if (forLogo) set({ logoAssetId: r.id }); else if (c && c.photos.length < 8) set({ photos: [...c.photos, { assetId: r.id, alt: "" }] });
      show("Photo added. Describe it below for people using screen readers.");
    } catch (e: any) { show(e.message, "error"); }
  }
  async function restore(v: number) {
    if (!confirm(`Load version ${v} into your draft? Your current draft is replaced (the live page doesn't change until you publish).`)) return;
    await api("POST", `season/${id}/restore`, { version: v }); await loadSeason(); setPreviewKey((k) => k + 1); show(`Version ${v} loaded as your draft.`);
  }
  async function setStatus(action: "unpublish" | "archive") {
    if (!confirm(action === "archive" ? "Archive this season? It disappears from the list but bookings are kept." : "Take this page offline? Existing bookings are unaffected.")) return;
    await api("POST", `season/${id}/${action}`, {}); await loadSeasons(); show("Done.");
  }

  if (!c) return <div>{node}<p>Loading…</p></div>;
  const move = (i: number, d: number) => { const p = [...c.photos]; const j = i + d; if (j < 0 || j >= p.length) return; [p[i], p[j]] = [p[j], p[i]]; set({ photos: p }); };

  return (
    <div className="stack">
      {node}
      <div className="row between">
        <h1 style={{ margin: 0 }}>Page editor</h1>
        <div className="row">
          <select aria-label="Season" value={id} onChange={(e) => { if (dirty && !confirm("Discard unsaved changes?")) return; setId(e.target.value); }} style={{ width: "auto" }}>
            {seasons.map((s) => <option key={s.id} value={s.id}>{s.name} — {s.status === "published" ? "LIVE" : s.status}</option>)}
          </select>
          <button className="btn btn-ghost btn-sm" onClick={() => newSeason(false)}>+ New season</button>
          <button className="btn btn-ghost btn-sm" onClick={() => newSeason(true)}>Duplicate this one</button>
        </div>
      </div>
      <div className="row"><span className={`badge ${meta?.status === "published" ? "badge-ok" : "badge-warn"}`}>{meta?.status === "published" ? `Live (version ${meta.publishedVersion})` : meta?.status}</span>{dirty && <span className="badge badge-warn">Unsaved changes</span>}</div>

      <div className="grid-2" style={{ alignItems: "start" }}>
        <div className="stack">
          <section className="card stack"><h2 style={{ fontSize: "1.3rem", margin: 0 }}>Words</h2>
            <T label="Season name (also in the browser tab)" v={c.title} on={(v) => set({ title: v })} />
            <T label="Business name" v={c.siteName} on={(v) => set({ siteName: v })} />
            <T label="Big headline" v={c.headline} on={(v) => set({ headline: v })} />
            <T label="Sentence under the headline" v={c.subhead} on={(v) => set({ subhead: v })} area />
            <T label="Main button" v={c.buttonText} on={(v) => set({ buttonText: v })} />
          </section>

          <section className="card stack"><h2 style={{ fontSize: "1.3rem", margin: 0 }}>Colors</h2>
            <div className="row">{Object.entries(THEMES).map(([k, t]) => <button key={k} className={`btn btn-sm ${c.theme === k ? "btn-primary" : "btn-ghost"}`} aria-pressed={c.theme === k} onClick={() => set({ theme: k, colors: t.colors })}>{t.label}</button>)}<button className={`btn btn-sm ${c.theme === "custom" ? "btn-primary" : "btn-ghost"}`} onClick={() => set({ theme: "custom" })}>Custom</button></div>
            <div className="swatches">{COLOR_FIELDS.map(([k, label, hint]) => (
              <div key={k} className="field" style={{ marginBottom: 0 }}><label className="label small" htmlFor={`c-${k}`}>{label}</label><input id={`c-${k}`} type="color" value={c.colors[k]} onChange={(e) => set({ theme: "custom", colors: { ...c.colors, [k]: e.target.value } })} aria-describedby={`h-${k}`} /><span className="hint" id={`h-${k}`} style={{ maxWidth: 140 }}>{hint}</span></div>
            ))}</div>
            {issues.length ? <div className="banner banner-error" role="alert"><strong>Hard to read:</strong><ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>{issues.map((i) => <li key={i.pair}>{i.pair}: {i.ratio}:1 (needs {i.need}:1)</li>)}</ul>You can save, but you can't publish until these are fixed.</div> : <div className="banner banner-ok">✓ All colors pass the readability check.</div>}
          </section>

          <section className="card stack"><h2 style={{ fontSize: "1.3rem", margin: 0 }}>Photos</h2>
            <p className="hint" style={{ margin: 0 }}>The first three show at the top of your page. Use your own photos; sample photos are labeled on the page while demo mode is on.</p>
            {c.photos.map((p, i) => (
              <div className="photo-row" key={p.assetId + i}>
                <img src={`/api/assets/${p.assetId}`} alt="" />
                <div className="field" style={{ marginBottom: 0 }}><label className="label small" htmlFor={`alt${i}`}>Describe photo {i + 1} (for screen readers)</label><input id={`alt${i}`} value={p.alt} onChange={(e) => set({ photos: c.photos.map((x, j) => (j === i ? { ...x, alt: e.target.value } : x)) })} /></div>
                <div className="row" style={{ flexDirection: "column", gap: 4 }}>
                  <button className="btn btn-ghost btn-sm" aria-label={`Move photo ${i + 1} up`} disabled={i === 0} onClick={() => move(i, -1)}>↑</button>
                  <button className="btn btn-ghost btn-sm" aria-label={`Move photo ${i + 1} down`} disabled={i === c.photos.length - 1} onClick={() => move(i, 1)}>↓</button>
                  <button className="btn btn-ghost btn-sm" aria-label={`Remove photo ${i + 1}`} onClick={() => set({ photos: c.photos.filter((_, j) => j !== i) })}>✕</button>
                </div>
              </div>
            ))}
            <div className="row"><label className="btn btn-ghost btn-sm" style={{ cursor: "pointer" }}>＋ Upload a photo<input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = ""; }} /></label><span className="small muted">JPG, PNG or WebP, up to 12 MB</span></div>
            {assets.length > 0 && (
              <details><summary style={{ cursor: "pointer", minHeight: 44, display: "flex", alignItems: "center" }}>Choose from photos you've uploaded ({assets.length})</summary>
                <div className="row" style={{ gap: 8 }}>{assets.map((a) => (
                  <button key={a.id} className="btn btn-ghost" style={{ padding: 4, minHeight: 0 }} aria-label={`Add ${a.alt || "photo"}`} disabled={c.photos.length >= 8 || c.photos.some((p) => p.assetId === a.id)} onClick={() => set({ photos: [...c.photos, { assetId: a.id, alt: a.alt || "" }] })}><img src={`/api/assets/${a.id}`} alt="" style={{ width: 84, height: 60, objectFit: "cover", borderRadius: 6 }} /></button>
                ))}</div>
              </details>
            )}
            <div className="row"><strong>Logo</strong>{c.logoAssetId ? <img src={`/api/assets/${c.logoAssetId}`} alt="Current logo" style={{ height: 48 }} /> : <span className="muted">Using the default logo</span>}
              <label className="btn btn-ghost btn-sm" style={{ cursor: "pointer" }}>Replace<input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f, true); e.target.value = ""; }} /></label></div>
          </section>

          <section className="card stack"><h2 style={{ fontSize: "1.3rem", margin: 0 }}>Session details & policies</h2>
            {c.demoValues && <div className="banner banner-demo"><strong>These are demo values.</strong> Replace the price, length, location and terms with your real ones, then tick the box below. You can't go live until you do.</div>}
            <div className="row">
              <N label="Total session price ($)" v={c.facts.sessionPriceCents == null ? "" : String(c.facts.sessionPriceCents / 100)} on={(v) => setFacts({ sessionPriceCents: v === "" ? null : Math.round(Number(v) * 100) })} />
              <N label="Session length (minutes)" v={c.facts.durationMin == null ? "" : String(c.facts.durationMin)} on={(v) => setFacts({ durationMin: v === "" ? null : Number(v) })} />
            </div>
            <T label="Where is it? (shown publicly)" v={c.facts.location} on={(v) => setFacts({ location: v })} />
            <T label="What do they receive? (e.g. 10 edited photos)" v={c.facts.deliverables} on={(v) => setFacts({ deliverables: v })} />
            <T label="Delivery time (e.g. within 2 weeks)" v={c.facts.turnaround} on={(v) => setFacts({ turnaround: v })} />
            <div className="field"><label className="label" htmlFor="dp">What happens to the $5 deposit?</label>
              <select id="dp" value={c.depositPolicy ?? ""} onChange={(e) => set({ depositPolicy: (e.target.value || null) as any })}><option value="">— choose —</option><option value="credit">Credited toward the session price</option><option value="refundable">Refundable (see terms)</option><option value="nonrefundable">Non-refundable booking fee</option></select></div>
            <N label="Reschedule/cancel cutoff (hours before)" v={c.rescheduleCutoffHours == null ? "" : String(c.rescheduleCutoffHours)} on={(v) => set({ rescheduleCutoffHours: v === "" ? null : Number(v) })} />
            <T label="Cancellation & refund terms" v={c.refundTerms} on={(v) => set({ refundTerms: v })} area />
            <T label="Booking terms clients agree to" v={c.termsText} on={(v) => set({ termsText: v })} area />
            <T label="Beauty-editing explanation ($40 total for two photos)" v={c.beautyCopy} on={(v) => set({ beautyCopy: v })} area />
            <label className="choice"><input type="checkbox" checked={!c.demoValues} onChange={(e) => set({ demoValues: !e.target.checked })} /><span>These are my real values (no demo placeholders left)</span></label>
          </section>

          <section className="card stack"><h2 style={{ fontSize: "1.3rem", margin: 0 }}>Page sections</h2>
            <div className="row">{(["facts", "howItWorks", "prep", "faqs"] as const).map((k) => <label key={k} className="choice"><input type="checkbox" checked={c.show[k]} onChange={(e) => set({ show: { ...c.show, [k]: e.target.checked } })} /><span>Show {({ facts: "quick facts", howItWorks: "How it works", prep: "Getting ready", faqs: "Questions" })[k]}</span></label>)}</div>
            <T label="Getting-ready notes (what to wear, when to arrive…)" v={c.prepNotes} on={(v) => set({ prepNotes: v })} area />
            <h3 style={{ margin: "6px 0 0" }}>How it works</h3>
            {c.howItWorks.map((h, i) => <div key={i} className="stack" style={{ gap: 6 }}><T label={`Step ${i + 1} title`} v={h.title} on={(v) => set({ howItWorks: c.howItWorks.map((x, j) => (j === i ? { ...x, title: v } : x)) })} /><T label="Step text" v={h.body} on={(v) => set({ howItWorks: c.howItWorks.map((x, j) => (j === i ? { ...x, body: v } : x)) })} /><div><button className="btn btn-ghost btn-sm" onClick={() => set({ howItWorks: c.howItWorks.filter((_, j) => j !== i) })}>Remove step</button></div></div>)}
            {c.howItWorks.length < 6 && <div><button className="btn btn-ghost btn-sm" onClick={() => set({ howItWorks: [...c.howItWorks, { title: "New step", body: "Describe it here." }] })}>+ Add a step</button></div>}
            <h3 style={{ margin: "6px 0 0" }}>Questions &amp; answers</h3>
            {c.faqs.map((f, i) => <div key={i} className="stack" style={{ gap: 6 }}><T label="Question" v={f.q} on={(v) => set({ faqs: c.faqs.map((x, j) => (j === i ? { ...x, q: v } : x)) })} /><T label="Answer" v={f.a} on={(v) => set({ faqs: c.faqs.map((x, j) => (j === i ? { ...x, a: v } : x)) })} area /><div><button className="btn btn-ghost btn-sm" onClick={() => set({ faqs: c.faqs.filter((_, j) => j !== i) })}>Remove</button></div></div>)}
            {c.faqs.length < 12 && <div><button className="btn btn-ghost btn-sm" onClick={() => set({ faqs: [...c.faqs, { q: "New question", a: "Your answer." }] })}>+ Add a question</button></div>}
          </section>
        </div>

        <div className="stack" style={{ position: "sticky", top: 12 }}>
          <section className="card stack">
            <div className="row between"><h2 style={{ fontSize: "1.3rem", margin: 0 }}>Preview</h2>
              <div className="row"><button className={`btn btn-sm ${device === "desktop" ? "btn-primary" : "btn-ghost"}`} onClick={() => setDevice("desktop")}>Desktop</button><button className={`btn btn-sm ${device === "mobile" ? "btn-primary" : "btn-ghost"}`} onClick={() => setDevice("mobile")}>Phone</button></div></div>
            <p className="small muted" style={{ margin: 0 }}>Shows your last <em>saved</em> draft. Save to refresh it.</p>
            <div style={{ display: "grid", placeItems: "center" }}><iframe key={previewKey + device} className="preview-frame" title="Page preview" src={`/mini-sessions?preview=${id}`} style={{ width: device === "mobile" ? 390 : "100%", maxWidth: "100%" }} /></div>
            <div className="row"><button className="btn btn-ghost" disabled={busy || !dirty} onClick={save}>Save draft</button><button className="btn btn-primary" disabled={busy || issues.length > 0} onClick={publish}>Publish</button></div>
            {meta?.status === "published" && <div className="row"><button className="link-btn" onClick={() => setStatus("unpublish")}>Take offline</button></div>}
            {gaps.length > 0 && <details><summary style={{ cursor: "pointer", minHeight: 44, display: "flex", alignItems: "center" }}>{gaps.length} thing{gaps.length === 1 ? "" : "s"} to finish before going live</summary><ul className="small">{gaps.map((g) => <li key={g.field}>{g.label}</li>)}</ul></details>}
          </section>
          <section className="card stack"><h2 style={{ fontSize: "1.3rem", margin: 0 }}>Earlier versions</h2>
            {versions.length === 0 ? <p className="muted small" style={{ margin: 0 }}>Each time you publish, a version is kept here.</p> : <ul className="list">{versions.map((v) => <li key={v.version} className="row between"><span>Version {v.version} · {new Date(v.published_at).toLocaleDateString()}<br /><span className="small muted">{v.headline}</span></span><button className="btn btn-ghost btn-sm" onClick={() => restore(v.version)}>Load as draft</button></li>)}</ul>}
          </section>
        </div>
      </div>
    </div>
  );
}

function T({ label, v, on, area }: { label: string; v: string; on: (v: string) => void; area?: boolean }) {
  const id = "t-" + label.replace(/\W+/g, "-").toLowerCase();
  return <div className="field" style={{ marginBottom: 0 }}><label className="label" htmlFor={id}>{label}</label>{area ? <textarea id={id} value={v} onChange={(e) => on(e.target.value)} /> : <input id={id} type="text" value={v} onChange={(e) => on(e.target.value)} />}</div>;
}
function N({ label, v, on }: { label: string; v: string; on: (v: string) => void }) {
  const id = "n-" + label.replace(/\W+/g, "-").toLowerCase();
  return <div className="field" style={{ marginBottom: 0, flex: "1 1 180px" }}><label className="label" htmlFor={id}>{label}</label><input id={id} type="number" min={0} step="any" value={v} onChange={(e) => on(e.target.value)} /></div>;
}
