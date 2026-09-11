import Link from "next/link";

import HeroBackground from "@/app/(components)/HeroBackground";
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
        <HeroBackground />
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

      <section
        className={styles.quickLinks}
        id="quick-links"
        aria-labelledby="quick-links-heading"
      >
        <div className={`${styles.sectionLabel} ${styles.sectionLabelOnWhite}`}>
          <span>02</span>
          <h2 id="quick-links-heading">Quick Links</h2>
        </div>

        <ul className={styles.quickLinksList}>
          <li>
            <Link href="/documents">
              <span className={styles.quickLinkName}>Documents</span>
              <span className={styles.arrow} aria-hidden="true">↗</span>
              <span className={styles.quickLinkNote}>
                Legislation, meeting minutes, and the governing documents of the
                SGA, searchable in full.
              </span>
            </Link>
          </li>
          <li>
            <Link href="/contact#funding">
              <span className={styles.quickLinkName}>Club Funding</span>
              <span className={styles.arrow} aria-hidden="true">↗</span>
              <span className={styles.quickLinkNote}>
                How a Registered Student Organization (RSO) can request funding from SGA.
              </span>
            </Link>
          </li>
          <li>
            <Link href="/discussion">
              <span className={styles.quickLinkName}>Discussion</span>
              <span className={styles.arrow} aria-hidden="true">↗</span>
              <span className={styles.quickLinkNote}>
                Bring issues to the Student Body and to the Senators who vote
                on it.
              </span>
            </Link>
          </li>
        </ul>
      </section>
    </div>
  );
}
