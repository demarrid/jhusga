import Link from "next/link";

import styles from "./community.module.css";

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
