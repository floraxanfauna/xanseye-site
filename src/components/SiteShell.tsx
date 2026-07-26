import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import styles from "./SiteShell.module.css";

const navItems = [
  { label: "Home", href: "/" },
  { label: "Pricing", href: "/pricing" },
  { label: "Weddings", href: "/weddings" },
  { label: "About Me", href: "/about-us" },
  { label: "Contact Me", href: "/contact-me" },
  { label: "Restoring", href: "/restoring-project" },
];

type SiteShellProps = {
  currentPath: string;
  children: ReactNode;
};

export function SiteShell({ currentPath, children }: SiteShellProps) {
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.brandWrap}>
          <Image
            src="/brand-assets/XanseyeWebsiteBannerLogo.png"
            alt="Xan's Eye Photography"
            width={3000}
            height={1300}
            className={styles.brand}
            priority
          />
        </div>
        <nav>
          <ul className={styles.navList}>
            {navItems.map((item) => {
              const isCurrent = item.href === currentPath;

              return (
                <li key={item.label}>
                  <Link href={item.href} className={isCurrent ? styles.active : undefined}>
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      </header>

      <div className={styles.content}>{children}</div>

      <footer className={styles.footerNav}>
        <nav aria-label="Footer navigation">
          <ul className={styles.bottomNavList}>
            {navItems.map((item) => {
              const isCurrent = item.href === currentPath;

              return (
                <li key={`footer-${item.label}`}>
                  <Link href={item.href} className={isCurrent ? styles.bottomActive : undefined}>
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      </footer>
    </div>
  );
}