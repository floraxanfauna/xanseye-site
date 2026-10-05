"use client";
import { useId } from "react";
import { COMM, PURPOSES, PURPOSE_LABELS, type FieldKey, type Intake } from "@/lib/intake";

type Errs = Partial<Record<FieldKey, string>>;
interface Props {
  value: Intake;
  onChange: (next: Intake) => void;
  errors?: Errs;
  maxPeople: number;
  beautyPrice: string;       // e.g. "$40"
  beautyCopy: string;
  mode?: "book" | "manage";
}

const NA_LABEL = "N/A (prefer not to answer)";

function Err({ id, msg }: { id: string; msg?: string }) {
  if (!msg) return null;
  return <div className="error" id={id} role="alert"><span aria-hidden>⚠</span>{msg}</div>;
}

function NaChoice({ checked, onChange, name }: { checked: boolean; onChange: (on: boolean) => void; name?: string }) {
  return (
    <label className="choice na na-row">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} name={name} />
      <span>{NA_LABEL}</span>
    </label>
  );
}

const OrientIcon = ({ kind }: { kind: string }) => (
  <svg className="orient-icon" viewBox="0 0 28 20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8">
    {kind === "landscape" && <rect x="3" y="4" width="22" height="12" rx="2" />}
    {kind === "portrait" && <rect x="9" y="1.5" width="10" height="17" rx="2" />}
    {kind === "mix" && (<><rect x="2" y="5" width="15" height="10" rx="2" /><rect x="20" y="3" width="6" height="14" rx="1.5" /></>)}
    {kind === "no_preference" && <path d="M5 10h18M18 5l5 5-5 5" strokeLinecap="round" strokeLinejoin="round" />}
  </svg>
);

export default function IntakeForm({ value: v, onChange, errors = {}, maxPeople, beautyPrice, beautyCopy }: Props) {
  const uid = useId();
  const set = (patch: Partial<Intake>) => onChange({ ...v, ...patch });
  const id = (k: string) => `${uid}-${k}`;

  /** A free-text / number question with an N/A switch. */
  function textQ(k: "name" | "email" | "phone" | "hopes" | "comfort", label: string, o: { type?: string; hint?: string; area?: boolean; autoComplete?: string; placeholder?: string }) {
    const f = v[k] as { state: string; value?: string };
    const na = f.state === "na";
    const val = f.state === "answered" ? (f.value ?? "") : "";
    const common = {
      id: id(k), value: val, disabled: na, "aria-invalid": !!errors[k], "aria-describedby": errors[k] ? id(k + "-e") : undefined, placeholder: o.placeholder,
      onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => set({ [k]: e.target.value === "" ? { state: "unanswered" } : { state: "answered", value: e.target.value } } as Partial<Intake>),
    };
    return (
      <div className="field">
        <label className="label" htmlFor={id(k)}>{label}</label>
        {o.hint && <div className="hint">{o.hint}</div>}
        {o.area ? <textarea {...common} /> : <input type={o.type ?? "text"} autoComplete={o.autoComplete} inputMode={k === "phone" ? "tel" : undefined} {...common} />}
        <NaChoice checked={na} onChange={(on) => set({ [k]: on ? { state: "na" } : { state: "unanswered" } } as Partial<Intake>)} />
        <Err id={id(k + "-e")} msg={errors[k]} />
      </div>
    );
  }

  /** A single-choice question: radios + N/A. */
  function radioQ<T extends string>(k: "commPref" | "orientation" | "beautyEdit" | "posing", legend: string, opts: { v: T; label: string; icon?: string }[], hint?: React.ReactNode) {
    const f = v[k] as { state: string; value?: T };
    const cur = f.state === "na" ? "na" : f.state === "answered" ? f.value : "";
    return (
      <fieldset className="field" aria-describedby={errors[k] ? id(k + "-e") : undefined}>
        <legend>{legend}</legend>
        {hint && <div className="hint">{hint}</div>}
        <div className="choices" role="radiogroup">
          {opts.map((o) => (
            <label className="choice" key={o.v}>
              <input type="radio" name={id(k)} checked={cur === o.v} onChange={() => set({ [k]: { state: "answered", value: o.v } } as Partial<Intake>)} />
              <span>{o.icon && <OrientIcon kind={o.icon} />}{o.label}</span>
            </label>
          ))}
          <label className="choice na">
            <input type="radio" name={id(k)} checked={cur === "na"} onChange={() => set({ [k]: { state: "na" } } as Partial<Intake>)} />
            <span>{NA_LABEL}</span>
          </label>
        </div>
        <Err id={id(k + "-e")} msg={errors[k]} />
      </fieldset>
    );
  }

  const people = v.peopleCount;
  const parts = v.participants;
  const rows = parts.state === "answered" ? parts.value : [{ firstName: "" }];
  const purposes = v.purposes;
  const chosen = purposes.state === "answered" ? purposes.value.choices : [];
  const otherText = purposes.state === "answered" ? purposes.value.otherText ?? "" : "";
  const setPurpose = (choices: (typeof PURPOSES)[number][], other = otherText) => set({ purposes: choices.length ? { state: "answered", value: { choices, otherText: other } } : { state: "unanswered" } });

  return (
    <div>
      {textQ("name", "Your name", { autoComplete: "name", placeholder: "Jane Smith" })}
      {textQ("email", "Email", { type: "email", autoComplete: "email", placeholder: "you@example.com", hint: "Used for your confirmation and a private link to update your answers." })}
      {textQ("phone", "Phone", { type: "tel", autoComplete: "tel", placeholder: "(555) 123-4567", hint: "Optional. I only use it to coordinate your session. No marketing texts." })}
      {radioQ("commPref", "How would you like me to reach you?", [{ v: "email", label: "Email" }, { v: "phone", label: "Phone" }, { v: "either", label: "Either is fine" }].slice(0, COMM.length))}

      <div className="q-block" />
      <div className="field">
        <label className="label" htmlFor={id("people")}>How many people will be photographed?</label>
        <input id={id("people")} type="number" min={1} max={maxPeople} inputMode="numeric" disabled={people.state === "na"} aria-invalid={!!errors.peopleCount}
          value={people.state === "answered" ? people.value : ""} aria-describedby={errors.peopleCount ? id("people-e") : undefined}
          onChange={(e) => set({ peopleCount: e.target.value === "" ? { state: "unanswered" } : { state: "answered", value: Number(e.target.value) } })} />
        <div className="hint">Up to {maxPeople} people per mini session.</div>
        <NaChoice checked={people.state === "na"} onChange={(on) => set({ peopleCount: on ? { state: "na" } : { state: "unanswered" } })} />
        <Err id={id("people-e")} msg={errors.peopleCount} />
      </div>

      <fieldset className="field" aria-describedby={errors.participants ? id("parts-e") : undefined}>
        <legend>Who's coming? (first names only)</legend>
        <div className="hint">Children's full names and birthdays aren't needed.</div>
        {parts.state !== "na" && (
          <div className="stack">
            {rows.map((r, i) => (
              <div className="row" key={i} style={{ alignItems: "end" }}>
                <div style={{ flex: "1 1 160px" }}>
                  <label className="label small" htmlFor={id("pn" + i)}>First name</label>
                  <input id={id("pn" + i)} type="text" value={r.firstName} autoComplete="off"
                    onChange={(e) => { const next = rows.map((x, j) => (j === i ? { ...x, firstName: e.target.value } : x)); set({ participants: { state: "answered", value: next } }); }} />
                </div>
                <div style={{ flex: "1 1 140px" }}>
                  <label className="label small" htmlFor={id("pr" + i)}>Relationship (optional)</label>
                  <input id={id("pr" + i)} type="text" value={r.relationship ?? ""} placeholder="e.g. daughter"
                    onChange={(e) => { const next = rows.map((x, j) => (j === i ? { ...x, relationship: e.target.value } : x)); set({ participants: { state: "answered", value: next } }); }} />
                </div>
                {rows.length > 1 && <button type="button" className="btn btn-ghost btn-sm" aria-label={`Remove person ${i + 1}`} onClick={() => set({ participants: { state: "answered", value: rows.filter((_, j) => j !== i) } })}>Remove</button>}
              </div>
            ))}
            {rows.length < 20 && <div><button type="button" className="btn btn-ghost btn-sm" onClick={() => set({ participants: { state: "answered", value: [...rows, { firstName: "" }] } })}>+ Add another person</button></div>}
          </div>
        )}
        <NaChoice checked={parts.state === "na"} onChange={(on) => set({ participants: on ? { state: "na" } : { state: "unanswered" } })} />
        <Err id={id("parts-e")} msg={errors.participants} />
      </fieldset>

      <div className="q-block" />
      <fieldset className="field" aria-describedby={errors.purposes ? id("purp-e") : undefined}>
        <legend>What are you hoping to use these photos for?</legend>
        <div className="hint">Choose all that apply.</div>
        <div className="choices">
          {PURPOSES.map((p) => (
            <label className="choice" key={p}>
              <input type="checkbox" disabled={purposes.state === "na"} checked={chosen.includes(p)}
                onChange={(e) => setPurpose(e.target.checked ? [...chosen, p] : chosen.filter((c) => c !== p))} />
              <span>{PURPOSE_LABELS[p]}</span>
            </label>
          ))}
          <label className="choice na">
            <input type="checkbox" checked={purposes.state === "na"} onChange={(e) => set({ purposes: e.target.checked ? { state: "na" } : { state: "unanswered" } })} />
            <span>{NA_LABEL}</span>
          </label>
        </div>
        {chosen.includes("other") && (
          <div style={{ marginTop: 8 }}>
            <label className="label small" htmlFor={id("other")}>Tell me more (optional)</label>
            <input id={id("other")} type="text" value={otherText} onChange={(e) => setPurpose(chosen, e.target.value)} />
          </div>
        )}
        <Err id={id("purp-e")} msg={errors.purposes} />
      </fieldset>

      {textQ("hopes", "Tell me what you hope we capture", { area: true, hint: "A feeling, a moment, a tradition. Whatever matters to you." })}

      {radioQ("orientation", "Do you prefer landscape or portrait photos?", [
        { v: "landscape", label: "Landscape (horizontal)", icon: "landscape" }, { v: "portrait", label: "Portrait (vertical)", icon: "portrait" },
        { v: "mix", label: "A mix", icon: "mix" }, { v: "no_preference", label: "No preference", icon: "no_preference" },
      ])}

      {radioQ("beautyEdit", `Would you like two photos beauty edited for an additional ${beautyPrice} total?`, [
        { v: "yes", label: "Yes, please" }, { v: "no", label: "No, thank you" }, { v: "more_info", label: "I'd like more information" },
      ], <>{beautyCopy} <strong>{beautyPrice} covers two photos in total</strong>, billed later. It is not charged today.</>)}

      {radioQ("posing", "What matters most to you?", [
        { v: "posed", label: "Posed smiles" }, { v: "candid", label: "Candid, natural moments" }, { v: "mix", label: "A mix of both" }, { v: "no_preference", label: "No preference" },
      ])}

      {textQ("comfort", "Anything that would help everyone feel comfortable?", { area: true, hint: "Movement breaks, avoiding forced smiles, sensory preferences, accessibility, or anything else you'd like me to know. No explanations needed." })}

      <div className="field">
        <label className="choice">
          <input type="checkbox" checked={v.photoRelease === "yes"} onChange={(e) => set({ photoRelease: e.target.checked ? "yes" : "no" })} />
          <span>It's okay to share a few of our photos publicly (portfolio or social). Optional; you can change this any time.</span>
        </label>
      </div>
    </div>
  );
}
