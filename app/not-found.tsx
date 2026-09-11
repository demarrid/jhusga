import Link from "next/link";

import styles from "./not-found.module.css";

/** A missing route should still feel like part of the public site. */
export default function NotFound() {
  return (
    <main className={styles.page}>
      <p className={styles.code}>404 · Not found</p>
      <div>
        <h1>This page isn&apos;t in the record.</h1>
        <p>The address may have changed, or the document may no longer be listed.</p>
        <Link href="/">Return home →</Link>
      </div>
    </main>
  );
}
