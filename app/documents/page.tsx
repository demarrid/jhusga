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
import DocumentSearch from "@/app/(components)/DocumentSearch";
import { SESSION_NUMBER, sessionOrdinal } from "@/config/session";
import { contributorRoleLabel } from "@/lib/contributors";
import { formatDateShort, formatDateTime } from "@/lib/dates";
import { documentKindLabel } from "@/lib/kinds";

// document types: 
// minutes
//  - executive
//  - senate
//  - commitee
//  - judicial

// // bills
//  - senate rules
//  - funding
//  - bylaws amendments
//  - constitution amendments

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
    }>;
}) {
    const { q, kind, person, role, office, archive, lineage } = await searchParams;

    // The archive is opt-in, so the default listing is only current-session law.
    const session = archive === "1" ? "all" : SESSION_NUMBER;

    const [documents, kinds, people, roles, offices, lineageGroup] = await Promise.all([
        getDocuments({ query: q, kind, session, personId: person, role, officeId: office }),
        getDocumentKindsInUse(session),
        getPeopleInUse(session),
        getContributorRolesInUse(session),
        getOfficesInUse(session),
        lineage ? getLineage(lineage) : Promise.resolve(null),
    ]);

    return (
        <div className="max-w-4xl mx-auto p-6">
            <h1>Documents</h1>

            <p>This webpage contains links to access all SGA documentation.</p>

            {lineageGroup && lineageGroup.members.length > 1 && (
                <div className="bg-primary-100 rounded-md p-3 my-4">
                    <h2>Every session&apos;s copy of this document</h2>
                    <ul>
                        {lineageGroup.members.map((member) => (
                            <li key={member.id}>
                                <Link href={`/documents/${member.id}`}>
                                    {/*
                                      * A standardised title already ends "(113th
                                      * Session)", so the prefix is only for the
                                      * copies still shown under their filename.
                                      */}
                                    {member.sessionNumber === null ||
                                        member.title.includes(sessionOrdinal(member.sessionNumber))
                                        ? member.title
                                        : `${sessionOrdinal(member.sessionNumber)} session — ${member.title}`}
                                </Link>
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            {/* Reads the URL, so it renders once the request's params exist. */}
            <Suspense>
                <DocumentSearch
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

            <p className="text-foreground-400 my-4">
                {`${documents.length} document${documents.length === 1 ? "" : "s"}${session === "all"
                    ? " across all sessions"
                    : ` in the ${sessionOrdinal(SESSION_NUMBER)} session`
                    }`}
            </p>

            {documents.length === 0 ? (
                <p className="text-foreground-400 italic">
                    Nothing matches. Run <code>npm run sync</code> if the archive is empty.
                </p>
            ) : (
                <ul>
                    {documents.map((document) => (
                        <DocumentCard key={document.id} document={document} />
                    ))}
                </ul>
            )}
        </div>
    );
}

function DocumentCard({ document }: { document: DocumentListing }) {
    // One chip per person, listing every capacity they acted in on this
    // document, so someone present and excused reads as one name not two.
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

    // The site renames documents for consistency, so the name the author gave
    // the file is kept within reach: it is what someone searching Drive will
    // recognise, and hiding it entirely would look like we had lost it.
    const renamed = document.driveTitle !== document.title;

    return (
        <li className="my-4">
            <h2>
                <Link
                    href={`/documents/${document.id}`}
                    title={renamed ? `Filed in Drive as “${document.driveTitle}”` : undefined}
                >
                    {document.title}
                </Link>
            </h2>

            <p className="text-foreground-400">
                {[
                    documentKindLabel(document.kind),
                    // A linked document has no folder, having never been filed
                    // in one; where it came from goes in the folder's place.
                    document.discoveredVia === "link"
                        ? "linked from the archive"
                        : document.folderPath,
                    document.sessionNumber !== null &&
                    document.sessionNumber !== SESSION_NUMBER &&
                    `${sessionOrdinal(document.sessionNumber)} session`,
                ]
                    .filter(Boolean)
                    .join(" · ")}
            </p>

            <DocumentDates
                created={document.driveCreatedTime}
                modified={document.driveModifiedTime}
            />

            {document.description && <p>{document.description}</p>}

            {byPerson.size > 0 && (
                <p className="flex flex-row flex-wrap gap-2 my-2">
                    {[...byPerson].map(([id, entry]) => (
                        <Link
                            key={id}
                            href={`/documents?person=${id}`}
                            className="bg-primary-100 rounded-md px-2 py-1"
                            title={entry.roles.map(contributorRoleLabel).join(", ")}
                        >
                            {entry.name}
                        </Link>
                    ))}
                </p>
            )}
        </li>
    );
}

/**
 * When the document was written and when it was last touched. Both are Drive's
 * timestamps for the file, which is the closest thing the archive has to a
 * date -- the text itself frequently carries none.
 */
function DocumentDates({
    created,
    modified,
}: {
    created: Date | null;
    modified: Date | null;
}) {
    if (!created && !modified) return null;

    // Drive sets both on creation, so an untouched document would otherwise
    // read "Created 3 Sep · Updated 3 Sep".
    const sameDay =
        created && modified && formatDateShort(created) === formatDateShort(modified);

    return (
        <p className="text-foreground-400 text-sm">
            {created && (
                <time dateTime={created.toISOString()} title={formatDateTime(created) ?? undefined}>
                    {`Created ${formatDateShort(created)}`}
                </time>
            )}
            {created && modified && !sameDay && " · "}
            {modified && !sameDay && (
                <time
                    dateTime={modified.toISOString()}
                    title={formatDateTime(modified) ?? undefined}
                >
                    {`Updated ${formatDateShort(modified)}`}
                </time>
            )}
        </p>
    );
}
