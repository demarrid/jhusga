import Link from "next/link";
import { notFound } from "next/navigation";

import {
    compareDocuments,
    getAmendmentsBetween,
    getComparisonOptions,
    type LineageMember,
} from "@/api/archive";
import DocumentDiff from "@/app/(components)/DocumentDiff";
import { sessionOrdinal } from "@/config/session";
import { formatMonthYear } from "@/lib/dates";
import { documentKindLabel } from "@/lib/kinds";
import { documentEdition } from "@/lib/titles";

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

    // Read the diff chronologically: the older edition is the "before" side,
    // whichever document the reader happened to start from.
    const olderFirst =
        other &&
        versionTime(other) <= versionTime({
            datedAt: document.datedAt,
            sessionNumber: document.sessionNumber,
            title: document.title,
        })
            ? { before: other.id, after: document.id }
            : other && { before: document.id, after: other.id };

    const comparison = olderFirst
        ? await compareDocuments(olderFirst.before, olderFirst.after)
        : null;

    const amendments = olderFirst
        ? await getAmendmentsBetween(olderFirst.before, olderFirst.after)
        : [];

    return (
        <main className={styles.page}>
          <header className={styles.masthead}>
            <Link className={styles.backLink} href={`/documents/${document.id}`}>← Back to document</Link>
            <h1>Compare editions</h1>
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
                    Only the governing documents are compared across editions.
                    Each constitution and set of bylaws the SGA adopted is kept
                    as its own snapshot, so the difference between two copies is
                    the record of what was amended; this document has no
                    counterpart to compare against.
                </p>
            ) : otherSessions.length === 0 ? (
                <p className={styles.compareIntro}>
                    No other edition of this document is in the archive yet, so
                    there is nothing to compare against.
                </p>
            ) : (
                <nav className={styles.compareOptions} aria-label="Editions to compare">
                    {otherSessions.map((member) => (
                        <Link
                            key={member.id}
                            href={`/documents/${document.id}/compare?against=${member.id}`}
                            className={`${styles.compareOption} ${member.id === against ? styles.compareOptionActive : ""}`}
                        >
                            {`vs. ${versionLabel(member)}`}
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

            {amendments.length > 0 && (
                <section className={styles.amendments}>
                    <h2>Amendments between these editions</h2>
                    <ul>
                        {amendments.map((amendment) => (
                            <li key={amendment.id}>
                                <Link href={`/documents/${amendment.id}`}>
                                    {amendment.title}
                                </Link>
                                <span>
                                    {` — ${[
                                        documentKindLabel(amendment.kind),
                                        formatMonthYear(amendment.datedAt),
                                        amendment.sessionNumber !== null &&
                                            `${sessionOrdinal(amendment.sessionNumber)} session`,
                                    ]
                                        .filter(Boolean)
                                        .join(" · ")}`}
                                </span>
                            </li>
                        ))}
                    </ul>
                </section>
            )}
          </div>
        </main>
    );
}

function versionLabel(member: Pick<LineageMember, "title" | "datedAt" | "sessionNumber">): string {
    const edition = documentEdition(member.title);
    const when = edition ?? formatMonthYear(member.datedAt);
    const session =
        member.sessionNumber !== null ? `${sessionOrdinal(member.sessionNumber)} session` : null;

    if (when && session && !edition) return `${when} · ${session}`;
    return when ?? session ?? member.title;
}

function versionTime(member: {
    datedAt: Date | null;
    sessionNumber: number | null;
    title: string;
}): number {
    if (member.datedAt) return member.datedAt.getTime();
    if (member.sessionNumber !== null) return member.sessionNumber * 1e12;
    return 0;
}
