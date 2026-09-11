import Link from "next/link";
import { notFound } from "next/navigation";

import { compareDocuments, getComparisonOptions } from "@/api/archive";
import DocumentDiff from "@/app/(components)/DocumentDiff";
import { sessionOrdinal } from "@/config/session";

import styles from "../../document-detail.module.css";

export const dynamic = "force-dynamic";

export default async function ComparePage({
    params,
    searchParams,
}: {
    params: Promise<{ documentId: string }>;
    searchParams: Promise<{ against?: string }>;
}) {
    const { documentId } = await params;
    const { against } = await searchParams;

    const options = await getComparisonOptions(documentId);
    if (!options) notFound();

    const { document, comparable, otherSessions } = options;
    const other = otherSessions.find((member) => member.id === against);

    // Read the diff chronologically: the older session is the "before" side,
    // whichever document the reader happened to start from.
    const olderFirst =
        other &&
        (other.sessionNumber ?? 0) <= (document.sessionNumber ?? 0)
            ? { before: other.id, after: document.id }
            : other && { before: document.id, after: other.id };

    const comparison = olderFirst
        ? await compareDocuments(olderFirst.before, olderFirst.after)
        : null;

    return (
        <main className={styles.page}>
          <header className={styles.masthead}>
            <Link className={styles.backLink} href={`/documents/${document.id}`}>← Back to document</Link>
            <h1>Compare across sessions</h1>
            <p className={styles.metadata}>
                {document.title}
                {document.sessionNumber !== null && (
                    <span>
                        {` · ${sessionOrdinal(document.sessionNumber)} session`}
                    </span>
                )}
            </p>
          </header>

          <div className={styles.compareContent}>

            {!comparable ? (
                <p className={styles.compareIntro}>
                    Only the guiding documents are compared across sessions. Each
                    session adopts its own constitution and bylaws, so the difference
                    between two sessions&apos; copies is the record of what was
                    amended; this document has no counterpart in another session.
                </p>
            ) : otherSessions.length === 0 ? (
                <p className={styles.compareIntro}>
                    No other session has a copy of this document, so there is nothing
                    to compare against yet.
                </p>
            ) : (
                <nav className={styles.compareOptions} aria-label="Sessions to compare">
                    {otherSessions.map((member) => (
                        <Link
                            key={member.id}
                            href={`/documents/${document.id}/compare?against=${member.id}`}
                            className={`${styles.compareOption} ${member.id === against ? styles.compareOptionActive : ""}`}
                        >
                            {member.sessionNumber === null
                                ? member.title
                                : `vs. ${sessionOrdinal(member.sessionNumber)} session`}
                        </Link>
                    ))}
                </nav>
            )}

            {comparison && (
                <>
                    <p className={styles.diffSummary}>
                        {`${comparison.added} line${comparison.added === 1 ? "" : "s"} added, ${comparison.removed} removed`}
                    </p>

                    {comparison.coarse && (
                        <p className={styles.notice}>
                            These versions differ too extensively to align line by line, so
                            the whole changed region is shown as a replacement.
                        </p>
                    )}

                    {comparison.added === 0 && comparison.removed === 0 ? (
                        <p className={styles.compareIntro}>
                            These two versions are identical.
                        </p>
                    ) : (
                        <DocumentDiff ops={comparison.ops} />
                    )}
                </>
            )}
          </div>
        </main>
    );
}
