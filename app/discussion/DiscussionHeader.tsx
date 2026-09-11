import type { ReactNode } from "react";

import styles from "./discussion.module.css";

/** Shared masthead keeps every forum route in the same visual system. */
export default function DiscussionHeader({
  eyebrow,
  title,
  children,
  compact = false,
}: {
  eyebrow: string;
  title: string;
  children?: ReactNode;
  compact?: boolean;
}) {
  return (
    <header className={`${styles.pageHeader} ${compact ? styles.compactHeader : ""}`}>
      <p>{eyebrow}</p>
      <div>
        <h1>{title}</h1>
        {children && <div className={styles.headerCopy}>{children}</div>}
      </div>
    </header>
  );
}
