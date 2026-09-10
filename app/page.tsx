import Link from "next/link";

import BlueJayAsciiVideo from "@/app/(components)/BlueJayAsciiVideo";
import styles from "@/app/home.module.css";

export default function Home() {
  return (
    <div className={styles.page}>
      <section className={styles.hero}>
        <div className={styles.copy}>
          <h1 className={styles.title}>
            <span className={styles.session}>The 114th</span>
            <span>Student Government Association</span>
            <span className={styles.university}>at Johns Hopkins University</span>
          </h1>

          {/* This prompt is an invitation to ask the archive, not browse it. */}
          <Link className={styles.primaryLink} href="/documents?mode=ask">
            <span>See what happened this week</span>
            <span className={styles.arrow} aria-hidden="true">↗</span>
          </Link>
        </div>

        <BlueJayAsciiVideo />
      </section>

      <section
        className={styles.introduction}
        id="about-sga"
        aria-labelledby="about-sga-heading"
      >
        <div className={styles.sectionLabel}>
          <span>01</span>
          <h2 id="about-sga-heading">About the SGA</h2>
        </div>

        <div className={styles.introductionCopy}>
          <p>
            The Student Government Association (SGA) at Johns Hopkins University
            is the representative body of undergraduate students. It is a
            student-run organization that is responsible for representing the
            interests of the student body to the University&apos;s administration.
          </p>
          <Link href="/about">
            Learn how the SGA works <span aria-hidden="true">→</span>
          </Link>
        </div>
      </section>
    </div>
  );
}
