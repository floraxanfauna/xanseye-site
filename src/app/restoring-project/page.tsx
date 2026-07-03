import Link from "next/link";
import { SiteShell } from "@/components/SiteShell";
import styles from "../inner-page.module.css";

export default function RestoringProjectPage() {
  return (
    <SiteShell currentPath="/restoring-project">
      <main className={styles.main}>
        <section className={styles.hero}>
          <span className={styles.kicker}>Restoring</span>
          <h1>Bring damaged or faded heirloom photos back to life.</h1>
          <p>
            Digital restoration services include repair, color correction, detail recovery, and
            print-ready exports for family archiving.
          </p>
        </section>

        <section className={styles.section}>
          <h2>How It Works</h2>
          <ul className={styles.list}>
            <li>Send a scan or clear photo of your original print</li>
            <li>Receive a quote based on complexity and turnaround</li>
            <li>Approve a proof before final delivery</li>
          </ul>
          <div className={styles.ctaRow}>
            <Link href="/contact-me" className={styles.primaryBtn}>
              Start a Restoration Request
            </Link>
          </div>
        </section>
      </main>
    </SiteShell>
  );
}