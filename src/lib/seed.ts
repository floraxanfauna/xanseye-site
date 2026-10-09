import { getDb } from "./db";
import { DEFAULT_SETTINGS, getSettings, saveSettings } from "./settings";
import { createSeason, publishSeason, saveDraft, listSeasons } from "./seasons";
import { defaultContent } from "./content";
import { publishSlots } from "./availability";
import { addDays, localDate } from "./time";

/** Demo content so the owner can see a working page on day one. Everything here is clearly labeled demo. */
export async function seedDemo(opts: { slots?: boolean; photos?: boolean } = {}) {
  const db = await getDb();
  const have = await listSeasons();
  if (have.some((x) => x.status === "published")) return have.find((x) => x.status === "published")!;
  // A previous first-visit setup may have been cut off halfway: clear its unpublished demo leftovers and start clean.
  await db.query(`delete from seasons where name = 'Autumn Mini Sessions' and status = 'draft' and published is null`);
  if ((await listSeasons()).length) return null; // the owner has their own drafts; never touch them
  await saveSettings({ ...DEFAULT_SETTINGS });

  // Sample photos ship with the site (public/sample-photos); no image processing is needed for the demo.
  const photos: { url: string; alt: string }[] = opts.photos === false ? [] : [
    { url: "/sample-photos/mini-1-mountain-family.jpg", alt: "Sample photo: a family of six posing together on a green mountain hillside" },
    { url: "/sample-photos/mini-2-golden-light.jpg", alt: "Sample photo: a smiling couple with their toddler son in warm golden evening light" },
    { url: "/sample-photos/mini-3-autumn-family.jpg", alt: "Sample photo: a family of four in autumn clothes standing arm in arm in front of orange and gold fall trees" },
    { url: "/sample-photos/mini-4-garden-walk.jpg", alt: "Sample photo: a couple walking hand in hand with their young son along a shaded garden path" },
  ];
  const logoAssetId: string | null = null; // the default Xan's Eye logo is used

  const season = await createSeason("Autumn Mini Sessions");
  const c = defaultContent("Autumn Mini Sessions");
  c.logoAssetId = logoAssetId;
  c.photos = photos;
  c.demoValues = true;
  c.facts = {
    durationMin: 30, sessionPriceCents: 15000,
    location: "DEMO: a local park (replace with your real location)",
    deliverables: "DEMO: 10 edited photos", turnaround: "DEMO: about 2 weeks",
  };
  c.depositPolicy = "credit";
  c.refundTerms = "DEMO terms: replace with your own cancellation and refund policy.";
  c.rescheduleCutoffHours = 48;
  c.termsText = "DEMO terms: replace with the booking terms you want clients to agree to.";
  c.prepNotes = "DEMO notes: replace with your preparation tips, like what to wear and when to arrive.";
  c.faqs = [
    { q: "What if it rains?", a: "DEMO answer: replace with your real weather plan." },
    { q: "Can I change my answers later?", a: "Yes. After you book, you get a private link to update your form any time." },
  ];
  await saveDraft(season.id, c);
  const pub = await publishSeason(season.id, "seed");

  if (opts.slots !== false) {
    const tz = (await getSettings()).timezone;
    const today = localDate(new Date(), tz);
    const dates: string[] = [];
    for (let i = 8; i < 60 && dates.length < 6; i++) {
      const d = addDays(today, i);
      const dow = new Date(d + "T12:00:00Z").getUTCDay();
      if (dow === 6) dates.push(d); // Saturdays
    }
    await publishSlots({ seasonId: season.id, dates, startTime: "10:00", endTime: "12:30", durationMin: 30, bufferMin: 15 }, "seed");
  }
  return pub;
}

let seeding: Promise<unknown> | null = null;
let lastSeedError: string | null = null;
/** Why the last first-visit setup failed (shown only while DEMO_SEED=1, to make first launch debuggable). */
export const seedError = () => lastSeedError;
/** First-visit setup for demo mode (DEMO_SEED=1). Safe to call often; seeds at most once. */
export async function ensureDemoSeed() {
  if (process.env.DEMO_SEED !== "1") return;
  if (!seeding) seeding = seedDemo().then((r) => { lastSeedError = null; return r; }).catch((e) => { lastSeedError = e instanceof Error ? e.message : String(e); console.error("[seed] failed:", lastSeedError); seeding = null; });
  await seeding;
}
