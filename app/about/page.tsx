import Link from "next/link";

import { getSections, type Section } from "@/api/sections";
import GeneratedProse from "@/app/(components)/GeneratedProse";
import { getSessionString } from "@/app/utils";
import { SECTION_KEYS } from "@/lib/sections";

import styles from "./about.module.css";

// Read on request so a daily document sync appears without a redeploy.
export const dynamic = "force-dynamic";

/**
 * One office described directly from the constitution and bylaws. Keeping
 * every office in the same row treatment makes this long page easy to scan.
 */
function Position({
  title,
  section,
  level = 3,
}: {
  title: string;
  section: Section | null;
  level?: 3 | 4;
}) {
  const Heading = level === 3 ? "h3" : "h4";

  return (
    <article className={styles.position}>
      <Heading>{title}</Heading>
      <div className={styles.generatedProse}>
        <GeneratedProse section={section} bulleted />
      </div>
    </article>
  );
}

/** A consistent numbered label anchors each chapter of the organization. */
function SectionLabel({ number, title }: { number: string; title: string }) {
  return (
    <div className={styles.sectionLabel}>
      <span>{number}</span>
      <h2>{title}</h2>
    </div>
  );
}

export default async function About() {
  const sections = await getSections(SECTION_KEYS);
  const session = getSessionString();
  const at = (key: string): Section | null => sections[key] ?? null;

  return (
    <main className={styles.page}>
      <section className={styles.hero}>
        <div className={styles.heroLabel}>The {session} session</div>
        <div className={styles.heroContent}>
          <h1>
            About
            <span>the SGA</span>
          </h1>
          <p>
            The Student Government Association (SGA) at Johns Hopkins
            University is an official representative body of the undergraduate
            student body. Through elections and appointments, SGA members are
            tasked with advocating for students with University administration.
          </p>
        </div>
      </section>

      <section className={styles.chapter}>
        <SectionLabel number="01" title="What the SGA does" />
        <div className={styles.chapterContent}>
          <div className={styles.generatedProse}>
            <GeneratedProse section={at("about.overview")} />
          </div>

          <p className={styles.lead}>
            The purpose of the SGA is for motivated students to deliberate and
            cooperate with one another to pass legislation and persuade
            University administrators to support student interests.
          </p>

          <p>
            Outside of hosting public Senate, Committee, Executive, and Judicial
            meetings, as well as funding Registered Student Organizations
            (RSOs), consulting faculty, and recordkeeping, some examples of the
            most impactful work of the SGA is:
          </p>

          <ol className={styles.impactList}>
            <li><span>01</span>Lowering Bloomberg Student Center (BSC) dining prices</li>
            <li><span>02</span>Adding a Boba shop to Levering Hall dining</li>
            <li><span>03</span>Making iClicker free for students (in classes which require it)</li>
          </ol>
        </div>
      </section>

      <section className={`${styles.chapter} ${styles.structure}`}>
        <SectionLabel number="02" title="Structure" />
        <div className={styles.chapterContent}>
          <p className={styles.lead}>
            Mirroring the federal government of the United States, the majority
            of SGA positions are in the Executive, Legislative, and Judicial
            branches. Two further bodies sit outside them: the Committee on
            Student Elections, which runs the elections, and the Programming
            Councils, which run each class&apos;s events.
          </p>

          <p className={styles.directoryLink}>
            For who currently holds each of these positions, see the{" "}
            <Link href="/contact">{session} contact directory <span aria-hidden="true">↗</span></Link>.
          </p>
        </div>
      </section>

      <section className={styles.chapter} id="executive">
        <SectionLabel number="03" title="Executive branch" />
        <div className={styles.chapterContent}>
          <div className={styles.generatedProse}>
            <GeneratedProse section={at("about.executive.overview")} />
          </div>
          <div className={styles.positions}>
            <Position title="Student Body President" section={at("about.executive.president")} />
            <Position title="Student Body Vice President" section={at("about.executive.vice_president")} />
            <Position title="Secretary" section={at("about.executive.secretary")} />
            <Position title="Treasurer" section={at("about.executive.treasurer")} />
            <Position title="Director of Communications" section={at("about.executive.communications")} />
            <Position title="Student Body Chair of Programming" section={at("about.executive.programming")} />
          </div>
        </div>
      </section>

      <section className={`${styles.chapter} ${styles.tintedChapter}`} id="legislative">
        <SectionLabel number="04" title="Legislative branch" />
        <div className={styles.chapterContent}>
          <div className={styles.generatedProse}>
            <GeneratedProse section={at("about.legislative.overview")} />
          </div>
          <div className={styles.positions}>
            <Position title="President of the Senate" section={at("about.legislative.president_of_senate")} />
            <Position title="Class Senators and Class Presidents" section={at("about.legislative.class_senators")} />
            <Position title="KSAS and WSE Senators" section={at("about.legislative.academic_senators")} />
            <Position title="Student Organization Senators" section={at("about.legislative.rso_senators")} />
            <Position title="Caucuses and Caucus Chairs" section={at("about.legislative.caucuses")} />

            <div className={styles.subsection}>
              <h3>Committees</h3>
              <div className={styles.generatedProse}>
                <GeneratedProse section={at("about.legislative.committees")} />
              </div>
            </div>
            <Position title="Committee chairs" section={at("about.legislative.committee_chairs")} level={4} />
          </div>
        </div>
      </section>

      <section className={styles.chapter} id="judicial">
        <SectionLabel number="05" title="Judicial branch" />
        <div className={styles.chapterContent}>
          <div className={styles.generatedProse}>
            <GeneratedProse section={at("about.judicial.overview")} />
          </div>
          <div className={styles.positions}>
            <Position title="Chief Justice" section={at("about.judicial.chief_justice")} />
            <Position title="Justices" section={at("about.judicial.justices")} />
          </div>
        </div>
      </section>

      <section className={`${styles.chapter} ${styles.tintedChapter}`} id="elections">
        <SectionLabel number="06" title="Committee on Student Elections" />
        <div className={styles.chapterContent}>
          <div className={styles.generatedProse}>
            <GeneratedProse section={at("about.cse.overview")} />
          </div>
        </div>
      </section>

      <section className={styles.chapter} id="programming">
        <SectionLabel number="07" title="Programming councils" />
        <div className={styles.chapterContent}>
          <div className={styles.generatedProse}>
            <GeneratedProse section={at("about.programming.overview")} />
          </div>
          <div className={styles.positions}>
            <Position title="Council officers" section={at("about.programming.officers")} />
          </div>
        </div>
      </section>
    </main>
  );
}
