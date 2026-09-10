import Link from "next/link";

import type { MeetingCounterpart, RelatedDocument, UnresolvedLink } from "@/api/documents";
import { sessionOrdinal } from "@/config/session";
import { documentKindLabel } from "@/lib/kinds";
import { meetingRoleLabel } from "@/lib/meetings";
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
}: {
    counterpart: MeetingCounterpart | null;
    references: RelatedDocument[];
    referencedBy: RelatedDocument[];
    unresolvedLinks?: UnresolvedLink[];
}) {
    const unresolved = unresolvedLinks ?? [];
    if (!counterpart && references.length === 0 && referencedBy.length === 0 && unresolved.length === 0) {
        return null;
    }

    return (
        <>
            {counterpart && (
                <section className={styles.sidebarSection}>
                    <h3>
                        {counterpart.role === "minutes"
                            ? "Minutes of this meeting"
                            : "Agenda for this meeting"}
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
                heading="Mentioned in this document"
                caption="Links the author put in the text."
                documents={references}
                unresolved={unresolved}
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
}: {
    heading: string;
    caption: string;
    documents: RelatedDocument[];
    unresolved?: UnresolvedLink[];
}) {
    if (documents.length === 0 && unresolved.length === 0) return null;

    return (
        <section className={styles.sidebarSection}>
            <h3>{heading}</h3>
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
            </ul>
            <p className={styles.asideMeta}>{caption}</p>
        </section>
    );
}

function unresolvedLabel(link: UnresolvedLink): string {
    const text = link.text.trim();
    if (text && !/^https?:\/\//i.test(text)) return text;
    return link.source === "sharepoint" ? "SharePoint document" : "Google Doc";
}
