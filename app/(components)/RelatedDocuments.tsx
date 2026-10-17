import Link from "next/link";

import type { MeetingCounterpart, RelatedDocument, UnresolvedLink } from "@/server/documents";
import { sessionOrdinal } from "@/config/session";
import { documentKindLabel } from "@/lib/kinds";
import { meetingRoleLabel } from "@/lib/meetings";
import { relevantDocuments, uniqueUnresolvedLinks } from "@/lib/relevant-documents";
import type { AgendaMatch } from "@/lib/agenda-mapping";
import styles from "@/app/documents/document-detail.module.css";

/**
 * How a document connects to the rest of the archive.
 *
 * Three different relationships, kept visually distinct because they mean
 * different things:
 *
 * - The meeting counterpart is the agenda a set of minutes came from, or the
 *   minutes that record what the agenda produced. Strongest link on the page.
 * - References are documents this one links to: on an agenda, that is the
 *   bills being read that night.
 * - Backlinks are the reverse, and they are what makes a bill legible -- the
 *   bill itself never mentions the meetings that took it up, but the meetings
 *   all link to the bill.
 */
export default function RelatedDocuments({
    counterpart,
    references,
    referencedBy,
    unresolvedLinks,
    agendaReferences = [],
    agendaUnresolvedLinks = [],
    agendaMatches = [],
}: {
    counterpart: MeetingCounterpart | null;
    references: RelatedDocument[];
    referencedBy: RelatedDocument[];
    unresolvedLinks?: UnresolvedLink[];
    agendaReferences?: RelatedDocument[];
    agendaUnresolvedLinks?: UnresolvedLink[];
    agendaMatches?: AgendaMatch[];
}) {
    const unresolved = unresolvedLinks ?? [];
    const hasAgenda = counterpart?.role === "agenda";
    const relevant = relevantDocuments(agendaReferences, references, counterpart?.documents.map(row => row.id));
    if (!counterpart && references.length === 0 && referencedBy.length === 0 && unresolved.length === 0) {
        return null;
    }

    return (
        <>
            {counterpart && (
                <section className={styles.sidebarSection}>
                    <h3 className={hasAgenda ? styles.relatedLabel : undefined}>
                        {counterpart.role === "minutes"
                            ? "Minutes of this meeting"
                            : "Agenda"}
                    </h3>
                    <ul>
                        {counterpart.documents.map((document) => (
                            <li key={document.id}>
                                <Link href={`/documents/${document.id}`}>
                                    {document.title.trim()}
                                </Link>
                                <span className={styles.asideMeta}>
                                    {` — ${meetingRoleLabel(counterpart.role)}`}
                                </span>
                            </li>
                        ))}
                    </ul>
                </section>
            )}

            <RelatedList
                heading={hasAgenda ? "Relevant Documents" : "Mentioned in this document"}
                compactHeading={hasAgenda}
                caption={hasAgenda ? "" : "Links the author put in the text."}
                matches={hasAgenda ? agendaMatches : []}
                documents={hasAgenda ? relevant.documents : references}
                sources={hasAgenda ? relevant.sources : undefined}
                unresolved={hasAgenda ? uniqueUnresolvedLinks([...agendaUnresolvedLinks, ...unresolved]) : unresolved}
            />

            <RelatedList
                heading="Mentioned by"
                caption="Documents that link here."
                documents={referencedBy}
            />
        </>
    );
}

function RelatedList({
    heading,
    caption,
    documents,
    unresolved = [],
    sources,
    compactHeading = false,
    matches = [],
}: {
    heading: string;
    caption: string;
    documents: RelatedDocument[];
    unresolved?: UnresolvedLink[];
    sources?: Record<string, string[]>;
    compactHeading?: boolean;
    matches?: AgendaMatch[];
}) {
    if (documents.length === 0 && unresolved.length === 0 && matches.length === 0) return null;
    const standaloneMatches = matches.filter(match => !documents.some(document => match.linkedDocumentIds?.includes(document.id)));

    return (
        <section className={styles.sidebarSection}>
            <h3 className={compactHeading ? styles.relatedLabel : undefined}>{heading}</h3>
            <ul>
                {documents.map((document) => (
                    <li key={document.id}>
                        <Link
                            href={`/documents/${document.id}`}
                            // The author's own link text is often more useful
                            // than the Drive filename, so it is the label and
                            // the filename moves to the tooltip.
                            title={document.anchorText ? document.title.trim() : undefined}
                        >
                            {(document.anchorText || document.title).trim()}
                        </Link>
                        <span className={styles.asideMeta}>
                            {` — ${documentKindLabel(document.kind)}`}
                            {document.sessionNumber !== null &&
                                `, ${sessionOrdinal(document.sessionNumber)} session`}
                        </span>
                        {sources?.[document.id] && <span className={styles.asideMeta}>{` · Linked in ${sources[document.id].join(" and ").toLowerCase()}`}</span>}
                        {matches.filter(match => match.linkedDocumentIds?.includes(document.id)).map(match => (
                            <MinutesMatch key={`${match.agendaId}:${match.sectionId}:${match.startOffset}`} match={match} />
                        ))}
                    </li>
                ))}
                {unresolved.map((link) => (
                    <li key={link.url}>
                        <a href={link.url} target="_blank" rel="noreferrer">
                            {unresolvedLabel(link)}
                        </a>
                        <span className={styles.asideMeta}>
                            {link.source === "sharepoint"
                                ? " — SharePoint (sign-in required to read)"
                                : " — Google Doc (not in the archive)"}
                        </span>
                    </li>
                ))}
                {standaloneMatches.map(match => (
                    <li key={`${match.agendaId}:${match.sectionId}:${match.startOffset}`}>
                        <Link href={`/documents/${match.agendaId}#${match.sectionId}`}>{match.title}</Link>
                        <MinutesMatch match={match} />
                    </li>
                ))}
            </ul>
            {caption && <p className={styles.asideMeta}>{caption}</p>}
        </section>
    );
}

function MinutesMatch({ match }: { match: AgendaMatch }) {
    return (
        <div>
            <a href={match.minutesHref}>In these minutes</a>
            <details><summary>Supporting passage</summary><p>{match.quote}</p></details>
        </div>
    );
}

function unresolvedLabel(link: UnresolvedLink): string {
    const text = link.text.trim();
    if (text && !/^https?:\/\//i.test(text)) return text;
    return link.source === "sharepoint" ? "SharePoint document" : "Google Doc";
}
