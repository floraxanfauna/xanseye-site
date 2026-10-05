import { z } from "zod";

/**
 * Every intake question can be unanswered, explicitly N/A ("prefer not to answer"),
 * or answered. These three states are stored distinctly — N/A is never written into a
 * numeric or email value.
 */
const stateOf = <T extends z.ZodTypeAny>(value: T) =>
  z.discriminatedUnion("state", [
    z.object({ state: z.literal("unanswered") }),
    z.object({ state: z.literal("na") }),
    z.object({ state: z.literal("answered"), value }),
  ]);

const text = (max: number) => z.string().trim().min(1).max(max);

export const ORIENTATIONS = ["landscape", "portrait", "mix", "no_preference"] as const;
export const BEAUTY = ["yes", "no", "more_info"] as const;
export const POSING = ["posed", "candid", "mix", "no_preference"] as const;
export const COMM = ["email", "phone", "either"] as const;
export const PURPOSES = ["christmas_card", "family_wall", "school_portrait", "anniversary", "just_because", "other"] as const;

export const PURPOSE_LABELS: Record<(typeof PURPOSES)[number], string> = {
  christmas_card: "Christmas / holiday card",
  family_wall: "Family photo for the wall",
  school_portrait: "School portrait",
  anniversary: "Anniversary",
  just_because: "Just because",
  other: "Something else",
};

const participant = z.object({ firstName: text(60), relationship: z.string().trim().max(60).optional() });

export const IntakeSchema = z.object({
  name: stateOf(text(120)),
  email: stateOf(z.string().trim().toLowerCase().email().max(200)),
  phone: stateOf(z.string().trim().min(5).max(40).regex(/^[0-9+().\-\s ext]+$/i, "Phone numbers can only have digits, spaces, + ( ) - .")),
  commPref: stateOf(z.enum(COMM)),
  peopleCount: stateOf(z.number().int().min(1).max(50)),
  participants: stateOf(z.array(participant).min(1).max(20)),
  purposes: stateOf(z.object({ choices: z.array(z.enum(PURPOSES)).min(1), otherText: z.string().trim().max(200).optional() })),
  hopes: stateOf(text(2000)),
  orientation: stateOf(z.enum(ORIENTATIONS)),
  beautyEdit: stateOf(z.enum(BEAUTY)),
  posing: stateOf(z.enum(POSING)),
  comfort: stateOf(text(2000)),
  photoRelease: z.enum(["no", "yes"]).default("no"), // separate optional consent; defaults to no
});
export type Intake = z.infer<typeof IntakeSchema>;

const U = { state: "unanswered" as const };
export const emptyIntake = (): Intake => ({
  name: U, email: U, phone: U, commPref: U, peopleCount: U, participants: U, purposes: U,
  hopes: U, orientation: U, beautyEdit: U, posing: U, comfort: U, photoRelease: "no",
});

/** Used by the booking flow: every question must be answered OR explicitly N/A. */
export function unansweredQuestions(i: Intake): string[] {
  return (Object.keys(FIELD_LABELS) as (keyof typeof FIELD_LABELS)[])
    .filter((k) => k !== "photoRelease" && (i[k] as any).state === "unanswered")
    .map((k) => FIELD_LABELS[k]);
}

export const FIELD_LABELS = {
  name: "Name",
  email: "Email",
  phone: "Phone",
  commPref: "Preferred contact",
  peopleCount: "Number of people",
  participants: "People being photographed",
  purposes: "What the photos are for",
  hopes: "What you hope we capture",
  orientation: "Photo orientation",
  beautyEdit: "Beauty editing (2 photos, +$40 total)",
  posing: "Posed or candid",
  comfort: "Comfort & access notes",
  photoRelease: "OK to share photos publicly",
} as const;
export type FieldKey = keyof typeof FIELD_LABELS;

const ORIENT_L: Record<string, string> = { landscape: "Landscape (horizontal)", portrait: "Portrait (vertical)", mix: "A mix", no_preference: "No preference" };
const BEAUTY_L: Record<string, string> = { yes: "Yes, please", no: "No, thank you", more_info: "I'd like more information" };
const POSING_L: Record<string, string> = { posed: "Posed smiles", candid: "Candid, natural moments", mix: "A mix", no_preference: "No preference" };
const COMM_L: Record<string, string> = { email: "Email", phone: "Phone", either: "Either" };

/** Human-readable value of one field. Always labels N/A and unanswered explicitly. */
export function displayField(i: Intake, k: FieldKey): string {
  if (k === "photoRelease") return i.photoRelease === "yes" ? "Yes" : "No";
  const f = i[k] as { state: string; value?: any };
  if (f.state === "unanswered") return "(not answered)";
  if (f.state === "na") return "N/A — prefers not to answer";
  const v = f.value;
  switch (k) {
    case "peopleCount": return String(v);
    case "participants": return (v as any[]).map((p) => (p.relationship ? `${p.firstName} (${p.relationship})` : p.firstName)).join(", ");
    case "purposes": {
      const names = (v.choices as (typeof PURPOSES)[number][]).map((c) => (c === "other" && v.otherText ? `Other: ${v.otherText}` : PURPOSE_LABELS[c]));
      return names.join(", ");
    }
    case "orientation": return ORIENT_L[v];
    case "beautyEdit": return BEAUTY_L[v];
    case "posing": return POSING_L[v];
    case "commPref": return COMM_L[v];
    default: return String(v);
  }
}

export interface FieldChange { field: FieldKey; label: string; before: string; after: string }

/** Material changes between two intake versions (no-op saves return []). */
export function diffIntake(before: Intake | null, after: Intake): FieldChange[] {
  const out: FieldChange[] = [];
  for (const k of Object.keys(FIELD_LABELS) as FieldKey[]) {
    const a = before ? displayField(before, k) : "(new)";
    const b = displayField(after, k);
    if (a !== b) out.push({ field: k, label: FIELD_LABELS[k], before: a, after: b });
  }
  return out;
}

export function renderIntakeText(i: Intake): string {
  return (Object.keys(FIELD_LABELS) as FieldKey[]).map((k) => `${FIELD_LABELS[k]}: ${displayField(i, k)}`).join("\n");
}

/** What the owner can truthfully do about reaching this client. */
export function contactSituation(i: Intake): "email" | "phone_only" | "none" {
  if (i.email.state === "answered") return "email";
  if (i.phone.state === "answered") return "phone_only";
  return "none";
}

export function firstNameOf(i: Intake): string | null {
  if (i.participants.state === "answered") return i.participants.value[0].firstName;
  if (i.name.state === "answered") return i.name.value.split(/\s+/)[0];
  return null;
}

/** Digits with a leading + preserved; for storage next to the display value. */
export function normalizePhone(raw: string): string {
  const t = raw.trim();
  const plus = t.startsWith("+");
  const digits = t.replace(/\D/g, "");
  return (plus ? "+" : "") + digits;
}

/** Tidy what the form produced: blank "answers" go back to unanswered, empty people rows are dropped. */
export function normalizeIntake(i: Intake): Intake {
  const out: any = structuredClone(i);
  for (const k of ["name", "email", "phone", "hopes", "comfort"] as const) {
    const f = out[k];
    if (f.state === "answered") { const v = String(f.value ?? "").trim(); out[k] = v ? { state: "answered", value: v } : { state: "unanswered" }; }
  }
  if (out.peopleCount.state === "answered" && !Number.isFinite(out.peopleCount.value)) out.peopleCount = { state: "unanswered" };
  if (out.participants.state === "answered") {
    const rows = (out.participants.value as any[]).map((p) => ({ firstName: String(p.firstName ?? "").trim(), relationship: String(p.relationship ?? "").trim() || undefined })).filter((p) => p.firstName);
    out.participants = rows.length ? { state: "answered", value: rows } : { state: "unanswered" };
  }
  if (out.purposes.state === "answered" && !out.purposes.value.choices.length) out.purposes = { state: "unanswered" };
  return out as Intake;
}

/** Per-question messages for inline errors. Empty object means the form can be submitted. */
export function fieldErrors(raw: Intake): Partial<Record<FieldKey, string>> {
  const i = normalizeIntake(raw);
  const errs: Partial<Record<FieldKey, string>> = {};
  const parsed = IntakeSchema.safeParse(i);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const k = issue.path[0] as FieldKey;
      if (!errs[k]) errs[k] = issue.path.length > 1 && issue.message ? friendly(k, issue.message) : "Please check this answer, or choose N/A.";
    }
  }
  for (const k of Object.keys(FIELD_LABELS) as FieldKey[]) {
    if (k !== "photoRelease" && (i[k] as any).state === "unanswered" && !errs[k]) errs[k] = "Please answer this, or choose N/A.";
  }
  return errs;
}
function friendly(k: FieldKey, msg: string): string {
  if (k === "email") return "That doesn't look like an email address. Fix it or choose N/A.";
  if (k === "phone") return "Use digits, spaces, + ( ) or -. Fix it or choose N/A.";
  if (k === "peopleCount") return "Enter a whole number, or choose N/A.";
  return msg.length < 80 ? msg : "Please check this answer, or choose N/A.";
}
