import Image from "next/image";
import Link from "next/link";
import { SiteShell } from "@/components/SiteShell";
import styles from "./page.module.css";

export default function Home() {
  return (
    <SiteShell currentPath="/">
      <main className={styles.main}>
        <section className={styles.hero}>
          <span className={styles.kicker}>Georgetown / Austin, TX + Destination</span>
          <h1>Story-forward photography for weddings, families, newborns, and brands.</h1>
          <p>
            Capturing warm, honest moments with an editorial touch. Rebuilt for faster updates,
            modern booking flow, and a better mobile experience.
          </p>
          <div className={styles.heroActions}>
            <Link href="/contact-me" className={styles.primaryBtn}>
              Book a Session
            </Link>
            <a
              href="https://xancraven.smugmug.com/"
              className={styles.secondaryBtn}
              target="_blank"
              rel="noopener noreferrer"
            >
              View Galleries
            </a>
          </div>
        </section>

        <section className={styles.featured}>
          <h2>Featured In</h2>
          <p>London&apos;s Mummy Magazine and Vogue UK.</p>
          <Image
            src="/vogue-mummy.png"
            alt="As seen in Vogue UK and Mummy Magazine"
            width={900}
            height={360}
            className={styles.featureImage}
          />
        </section>

        <section className={styles.cardSection}>
          <h3>Pricing</h3>
          <p>Custom collections for weddings, lifestyle, branding, and restoration projects.</p>
          <Link href="/pricing" className={styles.inlineLink}>
            Explore packages
          </Link>
        </section>

        <section className={styles.cardSection}>
          <h3>Contact</h3>
          <p>Let&apos;s plan your session. Email: hello@xanseye.com</p>
          <Link href="/contact-me" className={styles.inlineLink}>
            Start your inquiry
          </Link>
        </section>
      </main>
    </SiteShell>
  );
}
