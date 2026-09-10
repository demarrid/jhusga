import Link from "next/link";

import { getContactDirectory } from "@/api/contact";
import SourceChip from "@/app/(components)/SourceChip";
import { getSessionString } from "@/app/utils";
import { OFFICE_HOURS, OFFICE_HOURS_CHECKED } from "@/config/office-hours";
import { formatDateShort } from "@/lib/dates";
import {
  membersByGroup,
  type DirectoryCitation,
  type GroupInbox,
} from "@/lib/directory";

import styles from "./contact.module.css";

export const dynamic = "force-dynamic";

const FUNDING_GUIDE_URL =
  "https://jhu.campusgroups.com/get_file?eid=c53d17eb5f9e16b199c8d0db55a27983";
const SLI_FINANCE_EMAIL = "SLIFinance@jhu.edu";

function chipFrom(citation: DirectoryCitation) {
  return {
    documentTitle: citation.documentTitle,
    quote: citation.quote,
    href: `/documents/${citation.documentId}`,
    orphaned: false,
  };
}

/** A numbered page chapter matching the rest of the redesigned site. */
function SectionLabel({ number, title }: { number: string; title: string }) {
  return (
    <div className={styles.sectionLabel}>
      <span>{number}</span>
      <h2>{title}</h2>
    </div>
  );
}

export default async function Contact() {
  const directory = await getContactDirectory();
  const directorySections = membersByGroup(directory.members);
  const session = getSessionString();

  return (
    <main className={styles.page}>
      <header className={styles.pageHeader}>
        <p>The {session} session</p>
        <div>
          <h1>Contact</h1>
          <p>Funding help and contact details for the people representing Hopkins undergraduates.</p>
        </div>
      </header>

      <FinanceYourClub />

      <section className={`${styles.chapter} ${styles.directoryChapter}`}>
        <SectionLabel number="02" title="Member directory" />
        <div className={styles.chapterContent}>
          <p className={styles.lead}>
            Members of the {session} Student Government Association, with emails
            where the published {session} list has them.
          </p>

          {directory.sources.length > 0 && (
            <p className={styles.sourceNote}>
              Directory read from{" "}
              {directory.sources.map((source, index) => (
                <span key={source.id}>
                  {index > 0 && (index === directory.sources.length - 1 ? " and " : ", ")}
                  <Link href={`/documents/${source.id}`}>{source.title}</Link>
                </span>
              ))}
              . Source icons beside email addresses open the document where the
              address was published.
            </p>
          )}

          {/* Shared addresses belong beside individual member contact details. */}
          {directory.inboxes.length > 0 && (
            <section className={styles.generalContacts}>
              <h3>General contacts</h3>
              <ul className={styles.inboxList}>
                {directory.inboxes.map((inbox) => (
                  <InboxRow key={inbox.email} inbox={inbox} />
                ))}
              </ul>
            </section>
          )}

          <OfficeHours />

          {directorySections.length === 0 ? (
            <p className={styles.emptyState}>
              No {session} contact list is on file yet. Run <code>npm run sync</code> if the archive has one.
            </p>
          ) : (
            <div className={styles.directory}>
              {directorySections.map((section) => (
                <section className={styles.directoryGroup} key={section.group}>
                  <h3>{section.label}</h3>

                  {section.subgroups.map((subgroup) => (
                    <div className={styles.subgroup} key={subgroup.key ?? section.group}>
                      {subgroup.label && <h4>{subgroup.label}</h4>}
                      <ul>
                        {subgroup.members.map((member) => (
                          <li className={styles.member} key={member.name}>
                            <div className={styles.memberIdentity}>
                              {member.id ? (
                                <Link href={`/documents?mode=find&person=${member.id}`}>
                                  {member.name}
                                </Link>
                              ) : (
                                <strong>{member.name}</strong>
                              )}

                              {member.email && (
                                <span className={styles.email}>
                                  <a href={`mailto:${member.email}`}>{member.email}</a>
                                  {member.emailSource && <SourceChip mini citation={chipFrom(member.emailSource)} />}
                                </span>
                              )}
                            </div>

                            <div className={styles.memberDetails}>
                              {/* Roles stay plain; the member name already links to their records. */}
                              <div className={styles.positions}>
                                {member.positions.map((position) => (
                                  <span key={`${member.name}-${position}`}>{position}</span>
                                ))}
                              </div>

                              {member.committees && member.committees.length > 0 && (
                                <p className={styles.committees}>
                                  Committees: {member.committees.join(", ")}
                                </p>
                              )}
                            </div>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </section>
              ))}
            </div>
          )}
        </div>
      </section>
    </main>
  );
}

function InboxRow({ inbox }: { inbox: GroupInbox }) {
  return (
    <li>
      <strong>{inbox.label}</strong>
      <span>
        <a href={`mailto:${inbox.email}`}>{inbox.email}</a>
        <SourceChip
          citation={{
            documentTitle: inbox.documentTitle,
            quote: inbox.evidence,
            href: `/documents/${inbox.documentId}`,
            orphaned: false,
          }}
        />
      </span>
    </li>
  );
}

/** Keep the funding section to the decision points students actually need. */
function FinanceYourClub() {
  return (
    <section id="funding" className={`${styles.chapter} ${styles.funding}`}>
      <SectionLabel number="01" title="Finance your club" />
      <div className={styles.chapterContent}>
        <p className={styles.lead}>
          Registered Student Organizations request funding through Hopkins Groups.
        </p>
        <p>
          SGA votes on the funding request. After approval, submit a separate
          purchase request to release the money.
        </p>

        <a className={styles.guideLink} href={FUNDING_GUIDE_URL} target="_blank" rel="noreferrer">
          <span>Open the funding request guide</span>
          <span aria-hidden="true">↗</span>
        </a>

        <p className={styles.financeContact}>
          Questions: <a href={`mailto:${SLI_FINANCE_EMAIL}`}>{SLI_FINANCE_EMAIL}</a>
        </p>
      </div>
    </section>
  );
}

/** Office hours are hand-maintained and say so because they are not archived. */
function OfficeHours() {
  if (OFFICE_HOURS.length === 0) return null;

  const checked = OFFICE_HOURS_CHECKED ? new Date(OFFICE_HOURS_CHECKED) : null;

  return (
    <section className={styles.officeHours}>
      <h3>Office hours</h3>
      <p>
        Maintained by hand rather than read from the archive.
        {checked && ` Last checked ${formatDateShort(checked)}.`}
      </p>
      <ul>
        {OFFICE_HOURS.map((hour) => (
          <li key={`${hour.name}-${hour.when}`}>
            <strong>{hour.name}</strong>
            <span>{hour.position && `${hour.position} · `}{hour.when} · {hour.where}</span>
            {hour.href && <a href={hour.href}>Book a slot</a>}
            {hour.note && <small>{hour.note}</small>}
          </li>
        ))}
      </ul>
    </section>
  );
}
