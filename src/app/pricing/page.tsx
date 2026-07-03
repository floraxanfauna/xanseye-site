import Link from "next/link";
import { SiteShell } from "@/components/SiteShell";
import styles from "../inner-page.module.css";

export default function PricingPage() {
  return (
    <SiteShell currentPath="/pricing">
      <main className={styles.main}>
        <section className={styles.hero}>
          <span className={styles.kicker}>Pricing</span>
          <h1>Flexible photography collections for every season of life.</h1>
          <p>
            Session pricing depends on location, duration, and deliverables. Start with a package
            below, then customize with add-ons.
          </p>
        </section>

        <section className={styles.section}>
          <h2>Starting Collections</h2>
          <div className={styles.grid}>
            <article className={styles.card}>
              <h3>Weddings</h3>
              <p>From $2,400 - timeline planning, full-day coverage, and curated gallery delivery.</p>
            </article>
            <article className={styles.card}>
              <h3>Family + Newborn</h3>
              <p>From $425 - 60 minute session, style guide, and high-resolution downloads.</p>
            </article>
            <article className={styles.card}>
              <h3>Branding + Commercial</h3>
              <p>From $650 - customized shot list, licensing options, and fast turnaround.</p>
            </article>
          </div>
          <div className={styles.ctaRow}>
            <Link href="/contact-me" className={styles.primaryBtn}>
              Request Full Pricing Guide
            </Link>
          </div>
        </section>
      </main>
    </SiteShell>
  );
}