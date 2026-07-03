import Link from "next/link";
import { SiteShell } from "@/components/SiteShell";
import styles from "../inner-page.module.css";

export default function WeddingsPage() {
  return (
    <SiteShell currentPath="/weddings">
      <main className={styles.main}>
        <section className={styles.hero}>
          <span className={styles.kicker}>Weddings</span>
          <h1>Emotion-rich wedding storytelling with editorial polish.</h1>
          <p>
            From quiet getting-ready moments to packed dance floors, coverage is crafted to feel
            cinematic, relaxed, and true to your people.
          </p>
        </section>

        <section className={styles.section}>
          <h2>What&apos;s Included</h2>
          <ul className={styles.list}>
            <li>Custom timeline and location planning support</li>
            <li>Second photographer options for larger celebrations</li>
            <li>Online gallery with high-resolution downloads</li>
            <li>Print store integration and heirloom album upgrades</li>
          </ul>
          <div className={styles.ctaRow}>
            <a
              href="https://xancraven.smugmug.com/"
              target="_blank"
              rel="noopener noreferrer"
              className={styles.secondaryBtn}
            >
              View Full Gallery
            </a>
            <Link href="/contact-me" className={styles.primaryBtn}>
              Check Your Date
            </Link>
          </div>
        </section>
      </main>
    </SiteShell>
  );
}