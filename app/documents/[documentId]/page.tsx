import Link from "next/link";
import { notFound } from "next/navigation";

import { getDocument } from "@/api/documents";
import DocumentRestatement from "@/app/(components)/DocumentRestatement";
import DocumentViewer from "@/app/(components)/DocumentViewer";
import RelatedDocuments from "@/app/(components)/RelatedDocuments";
import { sessionOrdinal } from "@/config/session";
import { contributorRoleLabel } from "@/lib/contributors";
import { formatDate } from "@/lib/dates";
import { documentKindLabel, isComparableKind } from "@/lib/kinds";

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
        <div className="max-w-7xl mx-auto p-6">
            <h1>{document.title}</h1>

            <p className="text-foreground-400">
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
                <p className="text-foreground-400 text-sm">
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
                <p className="text-foreground-400 text-sm">
                    Not filed in the master folder. The archive holds it because
                    the documents under “Mentioned by” link to it.
                </p>
            )}

            {!document.isCurrentSession && (
                <p className="bg-primary-100 text-red-500 rounded-md p-3 my-4">
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
                <p className="bg-primary-100 text-red-500 rounded-md p-3 my-4">
                    {document.heldNotice}
                </p>
            )}

            {/*
              * Worth saying even when nothing has happened: it tells a reader
              * how much weight the text below can carry, and it is the reason
              * this document is watched more closely than the others.
              */}
            {document.anyoneCanEdit && (
                <p className="text-foreground-400 text-sm my-2">
                    The source file is shared so that anyone with the link can edit
                    it, so any change to it is held for review before it appears here.
                </p>
            )}

            <p className="my-4 flex flex-row flex-wrap gap-4">
                <a className="text-primary-500" href={document.source} target="_blank" rel="noreferrer">
                    {originalLabel(document.source)}
                </a>
                {/*
                  * Only the guiding documents. Every session adopts its own
                  * constitution and bylaws, so the diff between two copies is
                  * the amendment record; a meeting's minutes have no
                  * counterpart in another session to diff against.
                  */}
                {document.lineageKey && isComparableKind(document.kind) && (
                    <Link href={`/documents/${document.id}/compare`} className="text-green-400">
                        Compare across sessions
                    </Link>
                )}
            </p>

            <hr className="my-4" />

            {/*
              * The reading pane and the aids to reading it. On a narrow screen
              * the summary comes first, because a reader who cannot see both
              * at once is better served by the short version.
              */}
            <div className="flex flex-col-reverse lg:grid lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start gap-8">
                <article>
                    <DocumentViewer blocks={document.blocks} />
                </article>

                <aside className="lg:sticky lg:top-6 lg:max-h-[calc(100dvh-3rem)] lg:overflow-y-auto flex flex-col gap-6">
                    <section>
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
                        <section>
                            <h3>People named</h3>
                            <ul>
                                {document.contributors.map((contributor) => (
                                    <li key={`${contributor.id}-${contributor.role}`}>
                                        <Link className="text-secondary-600" href={`/documents?person=${contributor.id}`}>
                                            {contributor.name}
                                        </Link>
                                        <span className="text-foreground-400 text-sm">
                                            {` — ${contributorRoleLabel(contributor.role)}`}
                                            {contributor.note && ` (${contributor.note})`}
                                        </span>
                                    </li>
                                ))}
                            </ul>
                            <p className="text-foreground-400 text-sm">
                                Read from the document text; open the original to verify.
                            </p>
                        </section>
                    )}

                    {(document.driveOwnerName || document.driveLastEditorName) && (
                        <p className="text-foreground-400 text-sm">
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
                </aside>
            </div>
        </div>
    );
}

function originalLabel(source: string): string {
    if (/sharepoint\.com/i.test(source)) return "Open the original in SharePoint";
    if (/(?:docs|drive)\.google\.com/i.test(source)) return "Open the original in Google Docs";
    return "Open the original";
}
