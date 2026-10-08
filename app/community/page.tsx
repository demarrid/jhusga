import type { Metadata } from "next";
import Link from "next/link";

import { pageMetadata } from "@/lib/seo";

import styles from "./community.module.css";

export const metadata: Metadata = pageMetadata({
  title: "Community",
  description:
    "Community resources are moving. Public conversation is available now in " +
    "Discussion; additional campus resources will appear here as they are published.",
  path: "/community",
});

export default function Community() {
    return (
        <main className={styles.page}>
            <p className={styles.label}>Community</p>
            <div>
              <h1>Community resources are moving.</h1>
              <p>
                Public conversation is available now in Discussion. Additional
                campus resources will appear here as they are published.
              </p>
              <Link className={styles.discussionLink} href="/discussion">
                Open the discussion →
              </Link>
            </div>
        </main>
    );
}
