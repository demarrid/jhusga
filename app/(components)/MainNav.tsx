"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import styles from "./Header.module.css";

/*
 * The header is on every page, so a link it prefetches is fetched on every page
 * view. Cached pages are cheap to prefetch; the documents listing and the forum
 * render on request, so they load only when a reader actually opens them.
 */
const LINKS = [
  { href: "/about", label: "About", prefetch: true },
  { href: "/documents", label: "Documents", prefetch: false },
  { href: "/contact", label: "Contact", prefetch: true },
  { href: "/discussion", label: "Discussion", prefetch: false },
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
      {LINKS.map(({ href, label, prefetch }) => {
        const active = isCurrentSection(pathname, href);
        return (
          <Link
            key={href}
            href={href}
            prefetch={prefetch ? undefined : false}
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
