import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { getLineage } from "@/api/archive";
import {
  getContributorRolesInUse,
  getDocumentKindsInUse,
  getDocumentPage,
  getOfficesInUse,
  getPeopleInUse,
  getPersonFilterOption,
} from "@/api/documents";
import ArchiveSearch from "@/app/(components)/ArchiveSearch";
import { DocumentQueryProvider } from "@/app/(components)/DocumentQuery";
import SyncButton from "@/app/(components)/SyncButton";
import { SESSION_NUMBER, sessionOrdinal } from "@/config/session";
import { manualSyncEnabled } from "@/config/sync";
import { compareNamesBySurname } from "@/lib/contributors";
import { defaultDocumentSort, parseDocumentSort } from "@/lib/document-sort";
import { documentKindLabel, isDocumentKind } from "@/lib/kinds";
import { SESSION_LABEL, pageMetadata } from "@/lib/seo";

import DocumentResults from "./DocumentResults";
import styles from "./documents.module.css";

export const dynamic = "force-dynamic";

const DOCUMENTS_DESCRIPTION =
  `Every public record of the SGA at Johns Hopkins, searchable in full: meeting ` +
  `agendas and minutes, legislation, the constitution and bylaws, and reports ` +
  `from the ${SESSION_LABEL} and the sessions before it.`;

/**
 * A search is worth sharing as a search. The query or kind goes in the title
 * so a pasted link reads as "Senate minutes" rather than as the archive's
 * front page; everything else is the same description, because the filters
 * do not change what the page is for.
 */
export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; kind?: string; archive?: string }>;
}): Promise<Metadata> {
  const { q, kind, archive } = await searchParams;
  const query = q?.trim();
  const kindLabel = kind && isDocumentKind(kind) ? documentKindLabel(kind) : null;
  const scope = archive === "1" ? "the archive" : `the ${SESSION_LABEL}`;

  if (query) {
    return pageMetadata({
      title: `“${query}” · Documents`,
      description: `Documents in ${scope} of the SGA at Johns Hopkins matching “${query}”. ${DOCUMENTS_DESCRIPTION}`,
      path: `/documents?q=${encodeURIComponent(query)}`,
      noIndex: true,
    });
  }

  if (kindLabel) {
    return pageMetadata({
      title: `${kindLabel} · Documents`,
      description: `${kindLabel} from ${scope} of the SGA at Johns Hopkins. ${DOCUMENTS_DESCRIPTION}`,
      path: `/documents?kind=${encodeURIComponent(kind!)}`,
    });
  }

  return pageMetadata({
    title: "Documents",
    description: DOCUMENTS_DESCRIPTION,
    path: "/documents",
  });
}

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
    sort?: string;
  }>;
}) {
  const { q, kind, person, role, office, archive, lineage, mode, sort: sortParam } =
    await searchParams;

  // The archive is opt-in, so the default listing is current-session law.
  const session = archive === "1" ? "all" : SESSION_NUMBER;
  const hasQuery = Boolean(q?.trim());
  const sort = parseDocumentSort(sortParam, hasQuery);

  const [firstPage, kinds, people, roles, offices, lineageGroup] = await Promise.all([
    getDocumentPage({ query: q, kind, session, personId: person, role, officeId: office, sort }),
    getDocumentKindsInUse(session),
    getPeopleInUse(session),
    getContributorRolesInUse(session),
    getOfficesInUse(session),
    lineage ? getLineage(lineage) : Promise.resolve(null),
  ]);

  let peopleForFilter = people;
  let activePerson = person ? people.find((entry) => entry.id === person) : undefined;

  if (person && !activePerson) {
    const linkedPerson = await getPersonFilterOption(person, session);
    if (linkedPerson) {
      peopleForFilter = [...people, linkedPerson].sort((left, right) =>
        compareNamesBySurname(left.name, right.name),
      );
      activePerson = linkedPerson;
    }
  }

  const filterCount = [q, kind, person, role, office, archive === "1" ? archive : undefined].filter(
    Boolean,
  ).length;

  const listHeading =
    filterCount === 0
      ? "All documents"
      : `${filterCount} filter${filterCount === 1 ? "" : "s"} applied`;

  const sessionScope =
    session === "all" ? "the archive" : `the ${sessionOrdinal(SESSION_NUMBER)} session`;

  const resultLabel = `${firstPage.total} document${firstPage.total === 1 ? "" : "s"} found in ${sessionScope}`;

  // What the list sends for each further page, and what it is keyed by: any
  // change here is a different list, which starts again from its first page.
  const listSearch = new URLSearchParams(
    Object.entries({
      q,
      kind,
      person,
      role,
      office,
      archive: archive === "1" ? "1" : undefined,
      sort: sort === defaultDocumentSort(hasQuery) ? undefined : sort,
    }).filter((entry): entry is [string, string] => Boolean(entry[1])),
  ).toString();

  const emptyMessage = activePerson
    ? `${activePerson.name} is not named in any documents${
        session === "all" ? " in the archive" : ` in the ${sessionOrdinal(SESSION_NUMBER)} session`
      }. Try including past sessions, or choose Anyone above.`
    : // Run `npm run sync` if the archive is empty.
      "No results.";

  // Finding documents is the page's own job, so it opens there; an explicit
  // mode wins so a visitor can still switch tabs without losing active filters.
  const initialSearchMode = mode === "ask" ? "ask" : "find";

  return (
    <main className={styles.page}>
      <header className={styles.pageHeader}>
        <p>The {sessionOrdinal(SESSION_NUMBER)} session</p>
        <div>
          <div className={styles.titleRow}>
            {manualSyncEnabled() && <SyncButton />}
            <h1>Documents</h1>
          </div>
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

        <DocumentQueryProvider>
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
              people={peopleForFilter}
              roles={roles}
              offices={offices}
            />
          </Suspense>

          <section className={styles.catalogue} aria-labelledby="document-list-heading">
            <div className={styles.catalogueHeading}>
              <div>
                <span>Browse the record</span>
                <h2 id="document-list-heading">{listHeading}</h2>
              </div>
              <p>{resultLabel}</p>
            </div>

            <DocumentResults
              key={listSearch}
              initial={firstPage}
              search={listSearch}
              sort={sort}
              hasQuery={hasQuery}
              emptyMessage={emptyMessage}
            />
          </section>
        </DocumentQueryProvider>
      </div>
    </main>
  );
}
