import Link from "next/link";
import { notFound } from "next/navigation";

import { compareDocuments, getComparisonOptions } from "@/api/archive";
import DocumentDiff from "@/app/(components)/DocumentDiff";
import { sessionOrdinal } from "@/config/session";

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
        <div className="max-w-4xl mx-auto p-6">
            <h1>Compare</h1>

            <p>
                <Link href={`/documents/${document.id}`}>{document.title}</Link>
                {document.sessionNumber !== null && (
                    <span className="text-foreground-400">
                        {` · ${sessionOrdinal(document.sessionNumber)} session`}
                    </span>
                )}
            </p>

            {!comparable ? (
                <p className="text-foreground-400 italic my-4">
                    Only the guiding documents are compared across sessions. Each
                    session adopts its own constitution and bylaws, so the difference
                    between two sessions&apos; copies is the record of what was
                    amended; this document has no counterpart in another session.
                </p>
            ) : otherSessions.length === 0 ? (
                <p className="text-foreground-400 italic my-4">
                    No other session has a copy of this document, so there is nothing
                    to compare against yet.
                </p>
            ) : (
                <p className="my-4 flex flex-row flex-wrap gap-4">
                    {otherSessions.map((member) => (
                        <Link
                            key={member.id}
                            href={`/documents/${document.id}/compare?against=${member.id}`}
                            className={
                                member.id === against ? "font-bold underline" : undefined
                            }
                        >
                            {member.sessionNumber === null
                                ? member.title
                                : `vs. ${sessionOrdinal(member.sessionNumber)} session`}
                        </Link>
                    ))}
                </p>
            )}

            {comparison && (
                <>
                    <hr className="my-4" />

                    <p className="text-foreground-400">
                        {`${comparison.added} line${comparison.added === 1 ? "" : "s"} added, ${comparison.removed} removed`}
                    </p>

                    {comparison.coarse && (
                        <p className="bg-primary-100 rounded-md p-3 my-4">
                            These versions differ too extensively to align line by line, so
                            the whole changed region is shown as a replacement.
                        </p>
                    )}

                    {comparison.added === 0 && comparison.removed === 0 ? (
                        <p className="text-foreground-400 italic my-4">
                            These two versions are identical.
                        </p>
                    ) : (
                        <DocumentDiff ops={comparison.ops} />
                    )}
                </>
            )}
        </div>
    );
}
