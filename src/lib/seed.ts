import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { getDb } from "./db";
import { DEFAULT_SETTINGS, getSettings, saveSettings } from "./settings";
import { createSeason, publishSeason, saveDraft, listSeasons } from "./seasons";
import { defaultContent } from "./content";
import { publishSlots } from "./availability";
import { addDays, localDate } from "./time";
import { saveAsset } from "./assets";

/** Demo content so the owner can see a working page on day one. Everything here is clearly labeled demo. */
export async function seedDemo(opts: { slots?: boolean; photos?: boolean } = {}) {
  const db = await getDb();
  const have = await listSeasons();
  if (have.length) return have[0];
  await saveSettings({ ...DEFAULT_SETTINGS });

  const photos: { assetId: string; alt: string }[] = [];
  if (opts.photos !== false) {
    const dir = path.join(process.cwd(), "public", "sample-photos");
    const alts = [
      "Sample photo: a couple and their toddler sitting on the ground in autumn light",
      "Sample photo: parents and two daughters walking through fall foliage",
      "Sample photo: a family laughing together outdoors",
      "Sample photo: a couple holding their baby by a Christmas tree",
      "Sample photo: a family walking along a mountain trail",
      "Sample photo: a large family gathered under a big oak tree",
    ];
    if (fs.existsSync(dir)) {
      const files = fs.readdirSync(dir).filter((f) => f.endsWith(".jpg")).sort();
      for (const [i, f] of files.entries()) {
        const a = await saveAsset(fs.readFileSync(path.join(dir, f)), { alt: alts[i] ?? "Sample photo", isDemo: true });
        photos.push({ assetId: a.id, alt: alts[i] ?? "Sample photo" });
      }
    }
  }

  const logoFile = path.join(process.cwd(), "public", "xanseye-logo-trim.png");
  let logoAssetId: string | null = null;
  if (fs.existsSync(logoFile)) logoAssetId = (await saveAsset(fs.readFileSync(logoFile), { alt: "Xan's Eye Photography logo", isDemo: false, keepPng: true })).id;

  const season = await createSeason("Autumn Mini Sessions");
  const c = defaultContent("Autumn Mini Sessions");
  c.logoAssetId = logoAssetId;
  c.photos = photos.slice(0, 3);
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

export { sharp };
