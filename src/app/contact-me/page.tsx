import { SiteShell } from "@/components/SiteShell";
import styles from "../inner-page.module.css";

export default function ContactPage() {
  return (
    <SiteShell currentPath="/contact-me">
      <main className={styles.main}>
        <section className={styles.hero}>
          <span className={styles.kicker}>Contact</span>
          <h1>Tell me what you&apos;re dreaming up, and I&apos;ll help shape the shoot.</h1>
          <p>
            From weddings and newborn sessions to restoration requests, email is the fastest way to
            connect. You&apos;ll get availability, options, and clear next steps.
          </p>
        </section>

        <section className={styles.section}>
          <h2>Email Me</h2>
          <p>
            To reduce spam scraping, the address is written in human format below. Copy it into your
            mail app, or tap the button.
          </p>
          <ul className={styles.list}>
            <li>Email: hello [at] xanseye [dot] com</li>
            <li>Service areas: Austin, Georgetown, and destination sessions</li>
            <li>Typical response time: 24-48 hours</li>
          </ul>
          <div className={styles.ctaRow}>
            <a className={styles.primaryBtn} href="mailto:hello@xanseye.com?subject=Photography%20Inquiry">
              Open Email Draft
            </a>
          </div>
        </section>
      </main>
    </SiteShell>
  );
}