import Link from "next/link";
import { Suspense } from "react";

import { getLineage } from "@/api/archive";
import {
  getContributorRolesInUse,
  getDocumentKindsInUse,
  getDocuments,
  getOfficesInUse,
  getPeopleInUse,
  type DocumentListing,
} from "@/api/documents";
import ArchiveSearch from "@/app/(components)/ArchiveSearch";
import { SESSION_NUMBER, sessionOrdinal } from "@/config/session";
import { contributorRoleLabel } from "@/lib/contributors";
import { formatDateShort, formatDateTime } from "@/lib/dates";
import { documentKindLabel } from "@/lib/kinds";

import styles from "./documents.module.css";

export const dynamic = "force-dynamic";

export default async function Documents({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    kind?: string;
    person?: string;
    role?: string;
    office?: string;
    archive?: string;
    lineage?: string;
    mode?: string;
  }>;
}) {
  const { q, kind, person, role, office, archive, lineage, mode } = await searchParams;

  // The archive is opt-in, so the default listing is current-session law.
  const session = archive === "1" ? "all" : SESSION_NUMBER;

  const [documents, kinds, people, roles, offices, lineageGroup] = await Promise.all([
    getDocuments({ query: q, kind, session, personId: person, role, officeId: office }),
    getDocumentKindsInUse(session),
    getPeopleInUse(session),
    getContributorRolesInUse(session),
    getOfficesInUse(session),
    lineage ? getLineage(lineage) : Promise.resolve(null),
  ]);

  const resultLabel = `${documents.length} document${documents.length === 1 ? "" : "s"}${
    session === "all"
      ? " across all sessions"
      : ` in the ${sessionOrdinal(SESSION_NUMBER)} session`
  }`;

  // Filtered and lineage links are document-finding actions; an explicit mode
  // wins so a visitor can still switch tabs without losing active filters.
  const hasDocumentIntent = Boolean(q || kind || person || role || office || archive || lineage);
  const initialSearchMode =
    mode === "find" || mode === "ask" ? mode : hasDocumentIntent ? "find" : "ask";

  return (
    <main className={styles.page}>
      <header className={styles.pageHeader}>
        <p>The {sessionOrdinal(SESSION_NUMBER)} session</p>
        <div>
          <h1>Documents</h1>
          <p>Search meetings, legislation, governing documents, and the public record of the SGA.</p>
        </div>
      </header>

      <div className={styles.archive}>
        {lineageGroup && lineageGroup.members.length > 1 && (
          <section className={styles.lineage}>
            <h2>Every session&apos;s copy of this document</h2>
            <ul>
              {lineageGroup.members.map((member) => (
                <li key={member.id}>
                  <Link href={`/documents/${member.id}`}>
                    {/* Standardized titles already include their session number. */}
                    {member.sessionNumber === null ||
                    member.title.includes(sessionOrdinal(member.sessionNumber))
                      ? member.title
                      : `${sessionOrdinal(member.sessionNumber)} session — ${member.title}`}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}

        <Suspense>
          <ArchiveSearch
            initialMode={initialSearchMode}
            query={q}
            kind={kind}
            person={person}
            role={role}
            office={office}
            archive={archive === "1"}
            kinds={kinds}
            people={people}
            roles={roles}
            offices={offices}
          />
        </Suspense>

        <section className={styles.catalogue} aria-labelledby="document-list-heading">
          <div className={styles.catalogueHeading}>
            <div>
              <span>Browse the record</span>
              <h2 id="document-list-heading">All documents</h2>
            </div>
            <p>{resultLabel}</p>
          </div>

          {documents.length === 0 ? (
            <p className={styles.emptyState}>
              Nothing matches. Run <code>npm run sync</code> if the archive is empty.
            </p>
          ) : (
            <ul className={styles.documentList}>
              {documents.map((document, index) => (
                <DocumentCard key={document.id} document={document} index={index + 1} />
              ))}
            </ul>
          )}
        </section>
      </div>
    </main>
  );
}

function DocumentCard({ document, index }: { document: DocumentListing; index: number }) {
  // One person chip lists every capacity in which that person appears.
  const byPerson = new Map<string, { name: string; roles: string[] }>();
  for (const contributor of document.contributors) {
    const entry = byPerson.get(contributor.id);
    if (entry) {
      entry.roles.push(contributor.role);
    } else {
      byPerson.set(contributor.id, {
        name: contributor.name,
        roles: [contributor.role],
      });
    }
  }

  // Preserve the original Drive name as hover context after normalization.
  const renamed = document.driveTitle !== document.title;
  const metadata = [
    documentKindLabel(document.kind),
    document.discoveredVia === "link" ? "Linked from the archive" : document.folderPath,
    document.sessionNumber !== null &&
      document.sessionNumber !== SESSION_NUMBER &&
      `${sessionOrdinal(document.sessionNumber)} session`,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <li className={styles.documentCard}>
      <div className={styles.documentIndex}>{String(index).padStart(2, "0")}</div>
      <article>
        <p className={styles.documentMetadata}>{metadata}</p>
        <h3>
          <Link
            href={`/documents/${document.id}`}
            title={renamed ? `Filed in Drive as “${document.driveTitle}”` : undefined}
          >
            {document.title}
          </Link>
        </h3>

        <DocumentDates
          created={document.datedAt ?? document.driveCreatedTime}
          modified={document.driveModifiedTime}
          dated={Boolean(document.datedAt)}
        />

        {document.description && <p className={styles.documentDescription}>{document.description}</p>}

        {byPerson.size > 0 && (
          <div className={styles.contributors} aria-label="People named in this document">
            {[...byPerson].map(([id, entry]) => (
              <Link
                key={id}
                href={`/documents?mode=find&person=${id}`}
                title={entry.roles.map(contributorRoleLabel).join(", ")}
              >
                {entry.name}
              </Link>
            ))}
          </div>
        )}
      </article>
      <Link className={styles.documentArrow} href={`/documents/${document.id}`} aria-label={`Open ${document.title}`}>
        ↗
      </Link>
    </li>
  );
}

/** Display Drive dates without repeating identical created and updated days. */
function DocumentDates({
  created,
  modified,
  dated,
}: {
  created: Date | null;
  modified: Date | null;
  dated?: boolean;
}) {
  if (!created && !modified) return null;

  const sameDay =
    created && modified && formatDateShort(created) === formatDateShort(modified);

  return (
    <p className={styles.documentDates}>
      {created && (
        <time dateTime={created.toISOString()} title={formatDateTime(created) ?? undefined}>
          {`${dated ? "Dated" : "Created"} ${formatDateShort(created)}`}
        </time>
      )}
      {created && modified && !sameDay && " · "}
      {modified && !sameDay && (
        <time dateTime={modified.toISOString()} title={formatDateTime(modified) ?? undefined}>
          {`Updated ${formatDateShort(modified)}`}
        </time>
      )}
    </p>
  );
}
