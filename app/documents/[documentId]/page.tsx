import Link from "next/link";
import { notFound } from "next/navigation";

import { getDocument } from "@/api/documents";
import DocumentRestatement from "@/app/(components)/DocumentRestatement";
import DocumentViewer from "@/app/(components)/DocumentViewer";
import DoubleStickyHolder from "@/app/(components)/DoubleStickyHolder";
import RelatedDocuments from "@/app/(components)/RelatedDocuments";
import { sessionOrdinal } from "@/config/session";
import { contributorRoleLabel } from "@/lib/contributors";
import { formatDate } from "@/lib/dates";
import { documentKindLabel, isComparableKind } from "@/lib/kinds";

import styles from "../document-detail.module.css";

export const dynamic = "force-dynamic";

export default async function DocumentPage({
    params,
}: {
    // Next 16 passes route params as a promise.
    params: Promise<{ documentId: string }>;
}) {
    const { documentId } = await params;
    const document = await getDocument(documentId);

    if (!document) notFound();

    return (
        <main className={styles.page}>
          <header className={styles.masthead}>
            <Link className={styles.backLink} href="/documents">← All documents</Link>
            <h1>{document.title}</h1>

            <p className={styles.metadata}>
                {[
                    documentKindLabel(document.kind),
                    document.meetingRole === "agenda" && "agenda",
                    document.meetingRole === "minutes" && "minutes",
                    document.sessionNumber !== null &&
                    `${sessionOrdinal(document.sessionNumber)} session`,
                    document.datedAt
                        ? `dated ${formatDate(document.datedAt)}`
                        : document.driveCreatedTime &&
                        `created ${formatDate(document.driveCreatedTime)}`,
                    document.driveModifiedTime &&
                    `updated ${formatDate(document.driveModifiedTime)}`,
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

            <div className={styles.actions}>
                <a href={document.source} target="_blank" rel="noreferrer">
                    {originalLabel(document.source)} ↗
                </a>
                {document.lineageKey && isComparableKind(document.kind) && (
                    <Link href={`/documents/${document.id}/compare`}>
                        Compare across sessions
                    </Link>
                )}
            </div>
          </header>

          <div className={styles.noticeStack}>
            {!document.isCurrentSession && (
                <p className={styles.notice}>
                    This document is from a previous session and is kept for the
                    record. It may have been amended or replaced since.
                </p>
            )}

            {/*
              * A change large enough to want a human is not published until it
              * gets one, and a reader is told which text they are looking at
              * rather than being quietly served the older one. See
              * lib/integrity.ts.
              */}
            {document.heldNotice && (
                <p className={styles.notice}>
                    {document.heldNotice}
                </p>
            )}

            {/*
              * Worth saying even when nothing has happened: it tells a reader
              * how much weight the text below can carry, and it is the reason
              * this document is watched more closely than the others.
              */}
            {document.anyoneCanEdit && (
                <p className={styles.notice}>
                    The source file is shared so that anyone with the link can edit
                    it, so any change to it is held for review before it appears here.
                </p>
            )}

          </div>

            {/*
              * The reading pane and the aids to reading it. On a narrow screen
              * the summary comes first, because a reader who cannot see both
              * at once is better served by the short version.
              */}
            <div className={styles.readerLayout}>
                <article className={styles.documentPane}>
                    <DocumentViewer blocks={document.blocks} />
                </article>

                <aside className={styles.sidebar}>
                    <DoubleStickyHolder>
                        <section className={styles.sidebarSection}>
                            <h2>Summary</h2>
                            <DocumentRestatement restatement={document.restatement} />
                        </section>

                        <RelatedDocuments
                            counterpart={document.counterpart}
                            references={document.references}
                            referencedBy={document.referencedBy}
                            unresolvedLinks={document.unresolvedLinks}
                        />

                        {document.contributors.length > 0 && (
                            <section className={styles.sidebarSection}>
                                <h3>People named</h3>
                                <ul>
                                    {document.contributors.map((contributor) => (
                                        <li key={`${contributor.id}-${contributor.role}`}>
                                            <Link href={`/documents?mode=find&person=${contributor.id}`}>
                                                {contributor.name}
                                            </Link>
                                            <span className={styles.asideMeta}>
                                                {` — ${contributorRoleLabel(contributor.role)}`}
                                                {contributor.note && ` (${contributor.note})`}
                                            </span>
                                        </li>
                                    ))}
                                </ul>
                            </section>
                        )}

                        {(document.driveOwnerName || document.driveLastEditorName) && (
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

function originalLabel(source: string): string {
    if (/sharepoint\.com/i.test(source)) return "Open the original in SharePoint";
    if (/(?:docs|drive)\.google\.com/i.test(source)) return "Open the original in Google Docs";
    return "Open the original";
}
