import DocumentSearchHighlight from "@/app/(components)/DocumentSearchHighlight";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";

import type { DocumentDetail } from "@/server/documents";
import DocumentUpdateBanner from "@/app/(components)/DocumentUpdateBanner";
import DocumentOutline from "@/app/(components)/DocumentOutline";
import DocumentRestatement from "@/app/(components)/DocumentRestatement";
import DocumentVersionSelector from "@/app/(components)/DocumentVersionSelector";
import { getVersionedDocument, getDocumentVersionContent } from "@/server/document-versions";
import DocumentDiff from "@/app/(components)/DocumentDiff";
import { collapseUnchanged, diffLines } from "@/lib/diff";
import DocumentViewer from "@/app/(components)/DocumentViewer";
import DoubleStickyHolder from "@/app/(components)/DoubleStickyHolder";
import RelatedDocuments from "@/app/(components)/RelatedDocuments";
import { sessionOrdinal } from "@/config/session";
import { DocumentBackLink, DocumentVersionLink } from "@/app/(components)/DocumentReturnLinks";
import { largeRemoval } from "@/lib/integrity";
import { proseLine } from "@/lib/cite";
import { compareNamesBySurname, contributorRoleLabel, contributorRoleOrder } from "@/lib/contributors";
import { documentDateText, formatDate } from "@/lib/dates";
import { documentKindLabel, isComparableKind, isSecondaryKind, secondaryPublisher } from "@/lib/kinds";
import { documentSections } from "@/lib/outline";
import { meetingOutline } from "@/lib/meeting-outline";
import { relevantDocuments, uniqueUnresolvedLinks } from "@/lib/relevant-documents";
import { blockSectionIds } from "@/lib/render";
import { pageMetadata } from "@/lib/seo";

import styles from "../document-detail.module.css";

/**
 * The document page, shared by two routes.
 *
 * `page.tsx` renders the latest version and is cached (ISR), because crawlers
 * and readers mostly open a document by its plain URL. A `?version=` or
 * `?diff=` URL is rewritten by `proxy.ts` to `version/page.tsx`, which renders
 * on request. The search-return link reads `?returnTo=` in the browser, so it
 * never makes a page dynamic.
 */

/** What either route knows about the request. */
export type DocumentRequest = {
    documentId: string;
    version?: string;
    comparing?: boolean;
};

/** Reads a single query value; repeated or missing values are ignored. */
export function queryValue(value: string | string[] | undefined): string | undefined {
    return typeof value === "string" ? value : undefined;
}

// One read per request, shared between the metadata and the page.
const loadVersionedDocument = cache(getVersionedDocument);

/**
 * A shared link to a document shows the document's name and its summary.
 *
 * The summary is the restatement written beside the document, flattened to a
 * line with its citation markers dropped, exactly as the listing shows it.
 * Where none has been written yet the Drive description stands in, and
 * failing that a sentence saying what kind of record this is and when.
 */
export async function documentMetadata({ documentId, version }: DocumentRequest): Promise<Metadata> {
    const view = await loadVersionedDocument(documentId, version);
    if (!view) notFound();
    const { document } = view;

    return pageMetadata({
        title: document.title,
        description: describeDocument(document),
        path: `/documents/${document.id}`,
        type: "article",
    });
}

function describeDocument(document: DocumentDetail): string {
    const summary = document.restatement?.content
        ? proseLine(document.restatement.content, 300)
        : "";
    if (summary) return summary;

    if (document.description.trim()) return document.description;

    const stated = documentDateText(document);
    const parts = [
        isSecondaryKind(document.kind)
            ? `${documentKindLabel(document.kind, document.meetingRole)} about the SGA at Johns Hopkins`
            : `${documentKindLabel(document.kind, document.meetingRole)} of the SGA at Johns Hopkins`,
        document.sessionNumber !== null &&
            `${sessionOrdinal(document.sessionNumber)} session`,
        stated?.text ?? (document.driveCreatedTime && formatDate(document.driveCreatedTime)),
    ].filter(Boolean);

    return `${parts.join(" · ")}.`;
}

export async function DocumentPageBody({ documentId, version, comparing = false }: DocumentRequest) {
    const view = await loadVersionedDocument(documentId, version);
    if (!view) notFound();
    const { document } = view;
    const previousOption = view.options[view.options.findIndex(option => option.id === view.selected.id) - 1];
    const previous = previousOption
        ? await getDocumentVersionContent(document, previousOption.id) : null;
    const comparison = previous !== null ? diffLines(previous, document.content) : null;
    // When the text shown was last changed, not when Drive last touched the
    // file: a comment or formatting save is folded into the version before it.
    const updatedAt = view.selected.modifiedAt ? new Date(view.selected.modifiedAt)
        : view.selected.id === view.latest.id ? document.driveModifiedTime : null;
    const removal = previous !== null && comparison
        ? largeRemoval({ kind: document.kind, before: previous, after: document.content, diff: comparison }) : null;

    const authoredSections = documentSections(document.content, {
        titles: [document.title, document.driveTitle],
        anchored: blockSectionIds(document.blocks),
        kind: document.kind,
    });
    const agendas = document.counterpart?.role === "agenda" ? document.counterpart.documents : [];
    const meetingSections = document.kind.startsWith("minutes.");
    const sections = meetingSections ? meetingOutline(authoredSections, document.agendaMatches ?? [],
        relevantDocuments(document.agendaReferences ?? [], document.references, agendas.map(row => row.id)).documents,
        uniqueUnresolvedLinks([...(document.agendaUnresolvedLinks ?? []), ...document.unresolvedLinks]), document.agendaOutline) : authoredSections;
    // A citation chip scrolls to a passage in the article. The article is not
    // on the page, so the chip would have nowhere to land.
    const secondary = isSecondaryKind(document.kind);
    const restatement = secondary && document.restatement
        ? { ...document.restatement, citations: [] }
        : document.restatement;

    return (
        <main className={styles.page}>
          <DocumentUpdateBanner key={documentId + view.latest.id} documentId={documentId} latestVersionId={view.latest.id} />
          <header className={styles.masthead}>
            <DocumentBackLink className={styles.backLink} />
            <h1>{document.title}</h1>

            <p className={styles.metadata}>
                {[
                    documentKindLabel(document.kind, document.meetingRole),
                    document.sessionNumber !== null &&
                    `${sessionOrdinal(document.sessionNumber)} session`,
                    document.datedAt
                        ? `dated ${documentDateText(document)?.text ?? formatDate(document.datedAt)}`
                        : document.driveCreatedTime &&
                        `created ${formatDate(document.driveCreatedTime)}`,
                    updatedAt && `updated ${formatDate(updatedAt)}`,
                ]
                    .filter(Boolean)
                    .join(" · ")}
            </p>

            {/*
              * The site's own name for the document is at the top of the page,
              * so the author's is stated plainly rather than left to a hover:
              * on a page this long, a reader checking they have the right file
              * should not have to hunt for it.
              */}
            {document.driveTitle !== document.title && (
                <p className={styles.fileNote}>
                    {`Filed in Drive as “${document.driveTitle}”`}
                </p>
            )}

            {/*
              * Most of what the Senate actually votes on lives outside the
              * master folder, so saying where this came from is not pedantry:
              * it is the difference between a document the SGA filed and one
              * the archive went and fetched because an agenda pointed at it.
              */}
            {document.discoveredVia === "link" && (
                <p className={styles.fileNote}>
                    Not filed in the master folder. The archive holds it because
                    the documents under “Mentioned by” link to it.
                </p>
            )}

            {/*
              * The most important sentence on the page for these documents.
              * Everything around it -- the session, the date, the reading pane,
              * the search box that found it -- is the furniture the archive uses
              * for the SGA's own records, and a reader who arrived from a search
              * result has no other way to know that this one is a newspaper
              * writing about the SGA rather than the SGA writing about itself.
              */}
            {isSecondaryKind(document.kind) && (
                <p className={styles.fileNote}>
                    {`Reporting about the SGA, not a record of it: ${secondaryPublisher(document.kind)?.name ?? "a newspaper"}
                    published this and the SGA did not write it, file it,
                    or approve it. The archive holds it because the article itself
                    uses the ${phraseList(document.matchedPhrases)}.`}
                </p>
            )}

            {document.legislationEdition && (
                <p className={styles.fileNote}>
                    {document.legislationEdition.role === "draft" ? <>
                        Earlier draft. This resolution was adopted on {formatDate(new Date(`${document.legislationEdition.passedOn}T12:00:00Z`))}.{" "}
                        <Link href={`/documents/${document.legislationEdition.counterpartId}`}>Read the final adopted copy and recorded vote.</Link>
                        {" "}The summary below describes this draft.
                    </> : <>
                        Final adopted copy. Passed on {formatDate(new Date(`${document.legislationEdition.passedOn}T12:00:00Z`))};
                        {" "}the Drive upload date is when this copy was added to the archive.{" "}
                        <Link href={`/documents/${document.legislationEdition.counterpartId}`}>Earlier draft</Link>
                    </>}
                </p>
            )}

            <div className={styles.actions}>
                {/*
                  * The Drive original of a document whose text needed personal
                  * data removed still holds that data, so it is never linked:
                  * readers get the blacked-out copy once someone has approved
                  * it, and a plain statement until then.
                  */}
                {document.sourceAccess.mode === "original" && (
                    <a href={document.source} target="_blank" rel="noreferrer">
                        {originalLabel(document.source)}{isSecondaryKind(document.kind) ? "" : " (latest source)"} ↗
                    </a>
                )}
                {document.sourceAccess.mode === "redacted" && (
                    <a href={document.source} target="_blank" rel="noreferrer">
                        Open source (personal details blacked out) ↗
                    </a>
                )}
                {document.sourceAccess.mode === "withheld" && (
                    <span className={styles.fileNote}>
                        Original withheld: it contains personal details removed from this text.
                    </span>
                )}
                {document.lineageKey && isComparableKind(document.kind) && (
                    <Link href={`/documents/${document.id}/compare`}>
                        Compare editions
                    </Link>
                )}
            </div>
          </header>

          <div className={styles.noticeStack}>
            {/*
              * Not shown for an article. "It may have been amended or replaced
              * since" is true of legislation and false of journalism: a piece
              * from the 96th session is not a superseded draft of a later one,
              * it is what the paper reported that week and still says.
              */}
            {!document.isCurrentSession && !isSecondaryKind(document.kind) && (
                <p className={styles.notice}>
                    This document is from a previous session and is kept for the
                    record. It may have been amended or replaced since.
                </p>
            )}

            {/*
              * A guiding-document edit is not published until an adopted
              * amendment accounts for it, and a reader is told which text they
              * are looking at rather than being quietly served the older one.
              * See lib/integrity.ts.
              */}
            {document.heldNotice && (
                <p className={styles.notice}>
                    {document.heldNotice}
                </p>
            )}

            {/*
              * Any other change publishes, however large. One that might be
              * vandalism points the reader at the text it replaced.
              */}
            {removal && previousOption && (
                <p className={styles.notice}>
                    {`This version of the source file removed much of the one before it — ${removal} `}
                    <DocumentVersionLink documentId={documentId} versionId={previousOption.id}>Read the version before this change.</DocumentVersionLink>
                </p>
            )}

            {document.anyoneCanEdit && (
                <p className={styles.notice}>
                    Anyone with the link can edit the source file.
                </p>
            )}

          </div>

            {/*
              * The reading pane and the aids to reading it. On a narrow screen
              * the summary comes first, because a reader who cannot see both
              * at once is better served by the short version.
              *
              * An article is not reprinted. The document column says where
              * the text lives, and the summary stays in the sidebar where it
              * sits beside a record. The section list is one of those aids
              * only when it can point at headings on the page.
              */}
            <div className={secondary ? `${styles.readerLayout} ${styles.noBody}` : styles.readerLayout}>
                {secondary ? (
                <article className={styles.documentPane}>
                    <p className={styles.withheld}>This content is available only on {secondaryPublisher(document.kind)?.short ?? "the publisher's site"}.</p>
                </article>
                ) : (
                <article className={styles.documentPane}>
                    {document.discoveredVia !== "archive" && <DocumentVersionSelector key={`versions-${view.selected.id}`} options={view.options} selectedId={view.selected.id} initiallyComparing={comparing} hasPrevious={comparison !== null}>
                    <section id="document-version-history" className={styles.versionHistory} aria-label="Version history">
                        <h2>Version history</h2>
                        <p>Choose a version above to compare it with the version immediately before it.</p>
                        {comparison && previousOption ? <>
                            <p>{previousOption.label} → {view.selected.label}</p>
                            <p>{comparison.added} lines added, {comparison.removed} removed.</p>
                            {comparison.coarse && <p>These versions differ too extensively to align line by line; changed text is shown as a replacement.</p>}
                            {comparison.added === 0 && comparison.removed === 0
                                ? <p>These versions are identical.</p>
                                : <DocumentDiff ops={collapseUnchanged(comparison)} />}
                        </> : <p>This is the earliest saved version; there is no previous version to compare.</p>}
                    </section>
                    </DocumentVersionSelector>}
                    <DocumentSearchHighlight key={`search-${view.selected.id}`}><DocumentViewer key={`viewer-${view.selected.id}`} blocks={document.blocks} /></DocumentSearchHighlight>
                </article>
                )}

                <aside className={styles.sidebar}>
                    <DoubleStickyHolder>
                        <section className={styles.sidebarSection} aria-labelledby="article-summary">
                            <details className={styles.sidebarDetails} open>
                                <summary>
                                    <h2 id="article-summary">{document.legislationEdition?.role === "draft" ? "Draft summary" : "Summary"}</h2>
                                </summary>
                                {!secondary && view.historical ? <p className={styles.asideMeta}>
                                    This version has no saved summary.{" "}
                                    {view.selected.id !== view.latest.id && <>
                                        <DocumentVersionLink documentId={documentId} versionId={view.latest.id} scroll={false}>View the latest version</DocumentVersionLink>.
                                    </>}
                                </p> : <DocumentRestatement restatement={restatement} />}
                            </details>
                        </section>

                        {!secondary && (sections.length > 0 || agendas.length > 0) && (
                            <nav className={styles.sidebarSection} aria-labelledby="document-sections">
                                <details className={styles.sidebarDetails} open>
                                    <summary>
                                        <h2 id="document-sections">Sections{agendas.map((agenda, index) => (
                                            <Link key={agenda.id} className={styles.sectionAgendaLink} href={`/documents/${agenda.id}`} target="_blank" rel="noopener noreferrer">
                                                {` (Agenda${agendas.length > 1 ? ` ${index + 1}` : ""} ↗)`}
                                            </Link>
                                        ))}</h2>
                                    </summary>
                                    <DocumentOutline key={view.selected.id} sections={sections} />
                                </details>
                            </nav>
                        )}

                        <RelatedDocuments
                            counterpart={agendas.length ? null : document.counterpart}
                            references={meetingSections ? [] : document.references}
                            referencedBy={document.referencedBy}
                            unresolvedLinks={meetingSections ? [] : document.unresolvedLinks}
                        />

                        {document.contributors.length > 0 && (
                            <section className={styles.sidebarSection}>
                                <details className={styles.sidebarDetails} open>
                                    <summary>
                                        <h3>People named</h3>
                                    </summary>
                                    <ul>
                                        {byPerson(document.contributors).map((person) => (
                                            <li key={person.id}>
                                                <Link
                                                    className={person.mentionOnly ? styles.mentionedName : undefined}
                                                    href={`/documents?mode=find&person=${person.id}`}
                                                    title={person.tooltip}
                                                >
                                                    {person.name}
                                                </Link>
                                                <span className={styles.asideMeta}>
                                                    {` — ${person.roles}`}
                                                </span>
                                            </li>
                                        ))}
                                    </ul>
                                </details>
                            </section>
                        )}

                        {!secondary && (document.driveOwnerName || document.driveLastEditorName) && (
                            <p className={styles.asideMeta}>
                                {[
                                    document.driveOwnerName &&
                                    `Drive file created by ${document.driveOwnerName}`,
                                    document.driveLastEditorName &&
                                    `last edited by ${document.driveLastEditorName}`,
                                ]
                                    .filter(Boolean)
                                    .join(" · ")}
                            </p>
                        )}
                    </DoubleStickyHolder>
                </aside>
            </div>
        </main>
    );
}

/**
 * One line per person, rather than one per thing they did.
 *
 * A single set of minutes can name the same senator four times over -- Jackson
 * Morris reports, takes the floor, cosponsors a bill and is nominated for
 * Senator of the Month in the same evening -- and four consecutive entries
 * under one heading read as four people to anyone skimming. The roles are
 * kept, listed in the order lib/contributors.ts declares them.
 */
function byPerson(
    contributors: { id: string; name: string; role: string; note: string | null }[],
): { id: string; name: string; roles: string; mentionOnly: boolean; tooltip?: string }[] {
    const people = new Map<
        string,
        { id: string; name: string; held: { role: string; note: string | null }[] }
    >();

    for (const contributor of contributors) {
        const person =
            people.get(contributor.id) ??
            { id: contributor.id, name: contributor.name, held: [] };
        person.held.push({ role: contributor.role, note: contributor.note });
        people.set(contributor.id, person);
    }

    return [...people.values()]
        .sort((a, b) => compareNamesBySurname(a.name, b.name))
        .map((person) => ({
            id: person.id,
            name: person.name,
            tooltip: [...new Set(person.held
                .map((entry) => entry.note?.trim())
                .filter((note): note is string => Boolean(note)))]
                .join("\n") || undefined,
            roles: person.held
                .sort((a, b) => contributorRoleOrder(a.role) - contributorRoleOrder(b.role))
                .map((entry) => contributorRoleLabel(entry.role))
                .join(", "),
            // Another role on the same document is the thing worth coloring.
            // A name that only comes up in passing stays quiet.
            mentionOnly: person.held.every((entry) => entry.role === "mentioned"),
        }));
}

function originalLabel(source: string): string {
    if (/sharepoint\.com/i.test(source)) return "Open the original in SharePoint";
    if (/docs\.google\.com/i.test(source)) return "Open the original in Google Docs";
    if (/drive\.google\.com/i.test(source)) return "Open the original in Google Drive";
    // "Read" rather than "open", and named: the publisher is the point.
    if (/jhunewsletter\.com/i.test(source)) return "Read this article in The News-Letter";
    if (/(?:pages\.jh\.edu\/gazette|gazette\.jhu\.edu|hub\.jhu\.edu\/gazette)\//i.test(source)) {
        return "Read this article in The Gazette";
    }
    return "Open the original";
}

/**
 * "sga, student government" -> "phrases “sga” and “student government”".
 *
 * Written out rather than printed as a list, because the sentence it sits in is
 * the archive explaining itself to a reader and "matchedPhrases: sga" is not an
 * explanation.
 */
function phraseList(phrases: string): string {
    const quoted = phrases
        .split(",")
        .map((phrase) => phrase.trim())
        .filter(Boolean)
        .map((phrase) => `\u201c${phrase}\u201d`);

    if (quoted.length === 0) return "phrases the archive searches for";

    const noun = quoted.length === 1 ? "phrase" : "phrases";
    const joined =
        quoted.length === 1
            ? quoted[0]
            : `${quoted.slice(0, -1).join(", ")} and ${quoted.at(-1)}`;

    return `${noun} ${joined}`;
}
