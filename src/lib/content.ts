import { z } from "zod";
import { contrastRatio, hexToRgb } from "./color";

/**
 * Everything the owner edits in the Page editor lives in this one JSON document per season
 * (draft + published copies). The owner never sees JSON — the editor writes it for them.
 */
const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Use a color like #6875AE");

export const ColorsSchema = z.object({
  bg: hex,        // page background
  surface: hex,   // cards
  text: hex,      // body text
  accent: hex,    // primary buttons / selected states
  accentText: hex,// text on accent
  sage: hex,      // soft highlight (available dates)
  gold: hex,      // small decorative accent
});
export type Colors = z.infer<typeof ColorsSchema>;

export const THEMES: Record<string, { label: string; colors: Colors }> = {
  // Light tan page, deep forest green buttons and text accents, light blue highlights.
  forest: { label: "Forest", colors: { bg: "#F3EADB", surface: "#FBF7EE", text: "#1E2B22", accent: "#1F4D37", accentText: "#FBF7EE", sage: "#CFE3F0", gold: "#8FB8D6" } },
  autumn: { label: "Autumn", colors: { bg: "#F7FAFC", surface: "#FFFFFF", text: "#27313C", accent: "#4F5C9A", accentText: "#FFFFFF", sage: "#DCE7DC", gold: "#C6A458" } },
  holiday: { label: "Holiday", colors: { bg: "#FBF8F6", surface: "#FFFFFF", text: "#2A2523", accent: "#8C2F39", accentText: "#FFFFFF", sage: "#DDE8DD", gold: "#C6A458" } },
  spring: { label: "Spring", colors: { bg: "#FAFBF7", surface: "#FFFFFF", text: "#27312B", accent: "#4E7A63", accentText: "#FFFFFF", sage: "#E3EEDF", gold: "#C6A458" } },
  studio: { label: "Studio", colors: { bg: "#F7F7F7", surface: "#FFFFFF", text: "#222222", accent: "#3A3F47", accentText: "#FFFFFF", sage: "#E4E7E4", gold: "#B8975A" } },
};

const faq = z.object({ q: z.string().trim().min(1).max(200), a: z.string().trim().min(1).max(2000) });
const step = z.object({ title: z.string().trim().min(1).max(80), body: z.string().trim().min(1).max(500) });
const photo = z.object({ assetId: z.string().uuid(), alt: z.string().trim().max(200) });

export const ContentSchema = z.object({
  title: z.string().trim().min(1).max(80),              // season name, e.g. "Autumn Mini Sessions"
  siteName: z.string().trim().min(1).max(80),
  logoAssetId: z.string().uuid().nullable(),
  headline: z.string().trim().min(1).max(120),
  subhead: z.string().trim().max(300),
  buttonText: z.string().trim().min(1).max(40),
  theme: z.string(),
  colors: ColorsSchema,
  photos: z.array(photo).max(8),
  /** Launch essentials. null = owner has not decided yet; never invented. */
  facts: z.object({
    durationMin: z.number().int().min(10).max(480).nullable(),
    sessionPriceCents: z.number().int().min(0).max(1_000_000).nullable(),
    location: z.string().trim().max(200),
    deliverables: z.string().trim().max(200),
    turnaround: z.string().trim().max(200),
  }),
  depositPolicy: z.enum(["credit", "refundable", "nonrefundable"]).nullable(),
  refundTerms: z.string().trim().max(1500),
  rescheduleCutoffHours: z.number().int().min(0).max(720).nullable(),
  beautyCopy: z.string().trim().max(600),
  howItWorks: z.array(step).max(6),
  prepNotes: z.string().trim().max(1500),
  faqs: z.array(faq).max(12),
  termsText: z.string().trim().max(3000),
  show: z.object({ facts: z.boolean(), howItWorks: z.boolean(), prep: z.boolean(), faqs: z.boolean() }),
  /** true while placeholder business values are in use; blocks live publishing until the owner confirms they're real. */
  demoValues: z.boolean().default(false),
});
export type PageContent = z.infer<typeof ContentSchema>;

export function defaultContent(name = "Autumn Mini Sessions"): PageContent {
  return {
    title: name,
    siteName: "Xan's Eye Photography",
    logoAssetId: null,
    headline: "A little session. A lasting memory.",
    subhead: "Choose a date, pick a time, and tell me what matters to you.",
    buttonText: "Book a mini session",
    theme: "forest",
    colors: THEMES.forest.colors,
    photos: [],
    facts: { durationMin: null, sessionPriceCents: null, location: "", deliverables: "", turnaround: "" },
    depositPolicy: null,
    refundTerms: "",
    rescheduleCutoffHours: null,
    beautyCopy: "Beauty editing is extra, detailed retouching on two photos of your choice. It's separate from the standard color and exposure edits every delivered photo gets.",
    howItWorks: [
      { title: "Pick a time", body: "Choose an open date and time that works for you." },
      { title: "Tell me about you", body: "Share who's coming and what you hope for. Skip anything you'd rather not answer." },
      { title: "Reserve with a deposit", body: "A small deposit holds your spot. You can update your answers any time afterward." },
    ],
    prepNotes: "",
    faqs: [],
    termsText: "",
    show: { facts: true, howItWorks: true, prep: true, faqs: true },
    demoValues: false,
  };
}

export type Missing = { field: string; label: string }[];

/** Business values the owner must choose before live (non-demo) booking. Nothing is invented. */
export function launchGaps(c: PageContent): Missing {
  const m: Missing = [];
  if (c.demoValues) m.push({ field: "demoValues", label: "Replace the demo price, length, location and terms with your real ones, then tick \"These are my real values\"" });
  if (c.facts.sessionPriceCents == null) m.push({ field: "facts.sessionPriceCents", label: "Total session price" });
  if (c.facts.durationMin == null) m.push({ field: "facts.durationMin", label: "Session length" });
  if (!c.facts.location) m.push({ field: "facts.location", label: "Session location" });
  if (!c.facts.deliverables) m.push({ field: "facts.deliverables", label: "Number of photos delivered" });
  if (!c.facts.turnaround) m.push({ field: "facts.turnaround", label: "Delivery turnaround" });
  if (!c.depositPolicy) m.push({ field: "depositPolicy", label: "What happens to the deposit (credit / refundable / non-refundable)" });
  if (!c.refundTerms) m.push({ field: "refundTerms", label: "Cancellation & refund terms" });
  if (c.rescheduleCutoffHours == null) m.push({ field: "rescheduleCutoffHours", label: "Reschedule cutoff (hours before)" });
  if (!c.termsText) m.push({ field: "termsText", label: "Booking terms the client agrees to" });
  return m;
}

export interface ContrastIssue { pair: string; ratio: number; need: number }
/** WCAG AA checks for the owner's color choices. */
export function contrastIssues(c: Colors): ContrastIssue[] {
  const checks: [string, string, string, number][] = [
    ["Body text on page background", c.text, c.bg, 4.5],
    ["Body text on cards", c.text, c.surface, 4.5],
    ["Button text on accent color", c.accentText, c.accent, 4.5],
    ["Accent color on cards (links, selected dates)", c.accent, c.surface, 4.5],
    ["Body text on soft highlight", c.text, c.sage, 4.5],
  ];
  const out: ContrastIssue[] = [];
  for (const [pair, a, b, need] of checks) {
    const r = contrastRatio(a, b);
    if (r < need) out.push({ pair, ratio: Math.round(r * 100) / 100, need });
  }
  return out;
}

/** Page CSS variables derived from the owner's colors. */
export function cssVars(c: Colors): Record<string, string> {
  const rgb = hexToRgb(c.accent) ?? [79, 92, 154];
  return {
    "--bg": c.bg, "--surface": c.surface, "--text": c.text, "--accent": c.accent, "--accent-text": c.accentText,
    "--sage": c.sage, "--gold": c.gold, "--accent-rgb": rgb.join(","),
  };
}

export function parseContent(raw: unknown): PageContent {
  const base = defaultContent();
  const merged = { ...base, ...(raw as object) } as any;
  merged.facts = { ...base.facts, ...(merged.facts ?? {}) };
  merged.show = { ...base.show, ...(merged.show ?? {}) };
  merged.colors = { ...base.colors, ...(merged.colors ?? {}) };
  return ContentSchema.parse(merged);
}
