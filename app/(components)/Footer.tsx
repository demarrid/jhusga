import Image from "next/image";
import Link from "next/link";

import { getSessionString } from "../utils";
import styles from "./Footer.module.css";

export default function Footer() {
  return (
    <footer className={styles.footer}>
      <div className={styles.topline}>
        <Link className={styles.identity} href="/">
          <Image src="/logo.png" alt="" width={58} height={58} />
          <span>
            The {getSessionString()}
            <strong>Student Government Association</strong>
            at Johns Hopkins University
          </span>
        </Link>

        <nav className={styles.navigation} aria-label="Footer navigation">
          <Link href="/about">About</Link>
          <Link href="/documents">Documents</Link>
          <Link href="/contact">Contact</Link>
          <Link href="/discussion">Discussion</Link>
        </nav>
      </div>

      <div className={styles.finePrint}>
        <p>Student representation, legislation, and public records.</p>
        <p>
          &copy; {new Date().getFullYear()} Student Government Association at
          Johns Hopkins University.
        </p>
      </div>
    </footer>
  );
}
