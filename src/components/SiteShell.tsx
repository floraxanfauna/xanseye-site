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
            src="/brand-assets/logo_primary.png"
            alt="Xan's Eye Photography"
            width={2624}
            height={1847}
            className={styles.brand}
            priority
          />
        </div>
        <div className={styles.rule} />
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
    </div>
  );
}