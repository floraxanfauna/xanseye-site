import Link from "next/link";
import { SiteShell } from "@/components/SiteShell";
import styles from "../inner-page.module.css";

export default function AboutPage() {
  return (
    <SiteShell currentPath="/about-us">
      <main className={styles.main}>
        <section className={styles.hero}>
          <span className={styles.kicker}>About Me</span>
          <h1>Hi, I&apos;m Xan. I photograph the moments you never want to forget.</h1>
          <p>
            I&apos;m based near Austin and Georgetown, and I work with families, couples, newborns,
            and business owners across Texas and destination locations.
          </p>
        </section>

        <section className={styles.section}>
          <h2>My Style</h2>
          <p>
            Warm tones, candid movement, and subtle direction. I focus on genuine connection,
            helping you feel comfortable while creating images that look timeless.
          </p>
          <div className={styles.ctaRow}>
            <Link href="/contact-me" className={styles.primaryBtn}>
              Say Hello
            </Link>
          </div>
        </section>
      </main>
    </SiteShell>
  );
}