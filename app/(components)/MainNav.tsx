"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import styles from "./Header.module.css";

const LINKS = [
  { href: "/about", label: "About" },
  { href: "/documents", label: "Documents" },
  { href: "/contact", label: "Contact" },
  { href: "/discussion", label: "Discussion" },
] as const;

/** The section link is current on its own page and on any page nested under it. */
function isCurrentSection(pathname: string, href: string) {
  const path = pathname.length > 1 ? pathname.replace(/\/$/, "") : pathname;
  return path === href || path.startsWith(`${href}/`);
}

export default function MainNav() {
  const pathname = usePathname();

  return (
    <nav className={styles.navigation} aria-label="Main navigation">
      {LINKS.map(({ href, label }) => {
        const active = isCurrentSection(pathname, href);
        return (
          <Link
            key={href}
            href={href}
            className={active ? styles.active : undefined}
            aria-current={active ? "page" : undefined}
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
