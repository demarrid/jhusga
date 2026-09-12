'use server'

import { SESSION_NUMBER } from "@/config/sga";
import { sheetDelimiter } from "@/lib/csv";
import { byNewestFirst } from "@/lib/dates";
import { heldNotice } from "@/lib/integrity";
import { DOCUMENT_KINDS, type DocumentKind, isDocumentKind } from "@/lib/kinds";
import { extractDocumentLinks } from "@/lib/links";
import { isMeetingRole, type MeetingRole } from "@/lib/meetings";
import { prisma } from "@/lib/prisma";
import { renderDocument, type Block } from "@/lib/render";
import type { SectionStatus } from "@/lib/sections";
import { demoModeEnabled } from "@/lib/data-mode";
import {
    demoDocument,
    demoDocuments,
    demoKinds,
    demoOffices,
    demoPeople,
    demoRoles,
} from "@/lib/demo-data";

/** One row in the document listing. */
export type DocumentListing = {
    id: string;
    /** The standardised name shown to readers. */
    title: string;
    /** The Drive filename, for the hover and for "what the author called it". */
    driveTitle: string;
    description: string;
    /**
     * The stored plain-language reading of the document, when there is one.
     *
     * Shown in place of the Drive description, which is usually empty and
     * otherwise says whatever the officer who uploaded the file typed. See
     * lib/summarize.ts for how it is written and checked.
     */
    summary: string;
    kind: DocumentKind;
    folderPath: string;
    /**
     * "walk" for a file filed in the master folder, "link" for one the archive
     * reached by following a link out of an agenda or a report. A linked
     * document has no folder path to show in its place.
     */
    discoveredVia: string;
    source: string;
    sessionNumber: number | null;
    driveCreatedTime: Date | null;
    driveModifiedTime: Date | null;
    /** The date the document itself states, in its body or in its title. */
    datedAt: Date | null;
    /** People this document names, for the listing. */
    contributors: { id: string; name: string; role: string }[];
};

/**
 * A specific session, or "all" to include the archive of prior sessions.
 * Defaults to the current session everywhere, so the archive is always opt-in
 * and a reader never mistakes a superseded document for one in force.
 */
export type SessionFilter = number | "all";

function sessionWhere(session: SessionFilter = SESSION_NUMBER) {
    return session === "all" ? {} : { sessionNumber: session };
}

export async function getDocuments(filters: {
    kind?: string;
    query?: string;
    session?: SessionFilter;
    /** Only documents naming this person (affiliate id). */
    personId?: string;
    /** Only documents where someone acted in this capacity. */
    role?: string;
    /** Only documents naming someone who holds this office (HopkinsCategory id). */
    officeId?: string;
} = {}): Promise<DocumentListing[]> {
    if (demoModeEnabled()) return demoDocuments(filters);
    const kind =
        filters.kind && isDocumentKind(filters.kind) ? filters.kind : undefined;
    const query = filters.query?.trim();
    const personId = filters.personId?.trim() || undefined;
    const role = filters.role?.trim() || undefined;
    const officeId = filters.officeId?.trim() || undefined;

    // Person, document-role, and office compose: given more than one, a single
    // contributor row must satisfy all of them.
    const contributorWhere =
        personId || role || officeId
            ? {
                contributors: {
                    some: {
                        ...(personId ? { hopkinsAffiliateId: personId } : {}),
                        ...(role ? { role } : {}),
                        ...(officeId
                            ? {
                                hopkinsAffiliate: {
                                    hopkinsRelationships: {
                                        some: {
                                            hopkinsCategoryId: officeId,
                                            endedAt: null,
                                        },
                                    },
                                },
                            }
                            : {}),
                    },
                },
            }
            : {};

    const documents = await prisma.document.findMany({
        where: {
            ...sessionWhere(filters.session),
            ...(kind ? { kind } : {}),
            ...contributorWhere,
            // Postgres LIKE is case-sensitive, so the mode is required here --
            // without it, searching "constitution" would miss "Constitution".
            ...(query
                ? {
                    OR: [
                        { title: { contains: query, mode: "insensitive" } },
                        { displayTitle: { contains: query, mode: "insensitive" } },
                        { description: { contains: query, mode: "insensitive" } },
                        { content: { contains: query, mode: "insensitive" } },
                        // A name typed into the search box should find the
                        // documents that name that person.
                        {
                            contributors: {
                                some: {
                                    hopkinsAffiliate: {
                                        name: { contains: query, mode: "insensitive" },
                                    },
                                },
                            },
                        },
                    ],
                }
                : {}),
        },
        select: {
            id: true,
            title: true,
            displayTitle: true,
            description: true,
            kind: true,
            folderPath: true,
            discoveredVia: true,
            source: true,
            sessionNumber: true,
            driveCreatedTime: true,
            driveModifiedTime: true,
            datedAt: true,
            summary: { select: { content: true, status: true } },
            contributors: {
                select: {
                    role: true,
                    hopkinsAffiliate: { select: { id: true, name: true } },
                },
                orderBy: { hopkinsAffiliate: { name: "asc" } },
            },
        },
        // A tiebreak only. The order readers see is by date, and the date a
        // document is filed under is read out of the document rather than
        // stored, so it cannot be an ORDER BY -- see byNewestFirst below.
        orderBy: [{ sessionNumber: "desc" }, { title: "asc" }],
    });

    return documents
        .map((document) => ({
            ...document,
            title: document.displayTitle || document.title,
            driveTitle: document.title,
            kind: isDocumentKind(document.kind) ? document.kind : "unknown",
            // A failed or empty summary is no summary. A stale one is the last
            // reading of a document that has since changed, which is worth
            // more in a list of results than nothing at all.
            summary:
                document.summary &&
                    (document.summary.status === "fresh" || document.summary.status === "stale")
                    ? document.summary.content
                    : "",
            contributors: document.contributors.map((entry) => ({
                id: entry.hopkinsAffiliate.id,
                name: entry.hopkinsAffiliate.name,
                role: entry.role,
            })),
        }))
        .sort(byNewestFirst);
}

/** People named anywhere in the archive, for the person filter. */
export async function getPeopleInUse(
    session: SessionFilter = SESSION_NUMBER,
): Promise<{ id: string; name: string; count: number }[]> {
    if (demoModeEnabled()) return demoPeople(session);
    const people = await prisma.hopkinsAffiliate.findMany({
        where: {
            contributions: { some: { document: sessionWhere(session) } },
        },
        select: {
            id: true,
            name: true,
            _count: {
                select: { contributions: { where: { document: sessionWhere(session) } } },
            },
        },
        orderBy: { name: "asc" },
    });

    return people.map((person) => ({
        id: person.id,
        name: person.name,
        count: person._count.contributions,
    }));
}

/**
 * One person for the filter dropdown, including when they name no documents.
 *
 * Directory links can arrive with a person id that `getPeopleInUse` omits
 * because its count is zero. Without this the URL still filters while the
 * control reads "Anyone".
 */
export async function getPersonFilterOption(
    personId: string,
    session: SessionFilter = SESSION_NUMBER,
): Promise<{ id: string; name: string; count: number } | null> {
    const id = personId.trim();
    if (!id) return null;

    if (demoModeEnabled()) {
        return demoPeople(session).find((person) => person.id === id) ?? null;
    }

    const person = await prisma.hopkinsAffiliate.findUnique({
        where: { id },
        select: {
            id: true,
            name: true,
            _count: {
                select: {
                    contributions: { where: { document: sessionWhere(session) } },
                },
            },
        },
    });

    if (!person) return null;

    return {
        id: person.id,
        name: person.name,
        count: person._count.contributions,
    };
}

/**
 * Offices currently held by people the archive names, for the office filter.
 *
 * Restricted to seats (`position`) that are still held. A relationship the
 * directory has closed is a seat somebody used to hold, and an office category
 * outlives the last person in it -- which is how "WSE 1" and "WSE 4" went on
 * being offered in the filter long after the roster stopped being the thing
 * that named the school senators.
 */
export async function getOfficesInUse(
    session: SessionFilter = SESSION_NUMBER,
): Promise<{ id: string; name: string; count: number }[]> {
    if (demoModeEnabled()) return demoOffices();
    const held = {
        endedAt: null,
        hopkinsAffiliate: {
            contributions: { some: { document: sessionWhere(session) } },
        },
    };

    const offices = await prisma.hopkinsCategory.findMany({
        where: {
            type: "position",
            hopkinsRelationships: { some: held },
        },
        select: {
            id: true,
            name: true,
            _count: { select: { hopkinsRelationships: { where: held } } },
        },
        orderBy: { name: "asc" },
    });

    return offices.map((office) => ({
        id: office.id,
        name: office.name,
        count: office._count.hopkinsRelationships,
    }));
}

/** Distinct contribution roles actually present, for the role filter. */
export async function getContributorRolesInUse(
    session: SessionFilter = SESSION_NUMBER,
): Promise<{ role: string; count: number }[]> {
    if (demoModeEnabled()) return demoRoles(session);
    const grouped = await prisma.documentContributor.groupBy({
        by: ["role"],
        where: { document: sessionWhere(session) },
        _count: { role: true },
        orderBy: { _count: { role: "desc" } },
    });

    return grouped.map((group) => ({
        role: group.role,
        count: group._count.role,
    }));
}

/** A document mentioned from somewhere else on the page. */
export type RelatedDocument = {
    id: string;
    title: string;
    kind: DocumentKind;
    sessionNumber: number | null;
    /** The link text the author wrote, when there was one. */
    anchorText?: string;
};

/** A link the author typed whose target has not been ingested. */
export type UnresolvedLink = {
    url: string;
    text: string;
    source: "drive" | "sharepoint";
};

/**
 * The other half of a meeting: an agenda's minutes, or the minutes' agenda.
 * A list rather than one document because the archive occasionally holds two
 * copies of one side, and picking a winner silently would be a guess.
 */
export type MeetingCounterpart = {
    role: MeetingRole;
    documents: RelatedDocument[];
};

/** One claim's supporting passage, on the same page as the claim. */
export type SummaryCitation = {
    annotationId: string;
    quote: string;
    /** Anchor into this document's own text. */
    href: string;
    orphaned: boolean;
};

export type DocumentRestatement = {
    content: string;
    status: SectionStatus;
    generatedAt: Date | null;
    citations: SummaryCitation[];
};

export type DocumentDetail = {
    id: string;
    /** The standardised name shown to readers. */
    title: string;
    /** The Drive filename, kept so the page can show what the author called it. */
    driveTitle: string;
    description: string;
    kind: DocumentKind;
    folderPath: string;
    /** "walk" if filed in the master folder, "link" if reached from a link. */
    discoveredVia: string;
    source: string;
    content: string;
    sessionNumber: number | null;
    /** False for documents belonging to a prior session. */
    isCurrentSession: boolean;
    lineageKey: string;
    driveCreatedTime: Date | null;
    driveModifiedTime: Date | null;
    /** The date the document itself states, in its body or in its title. */
    datedAt: Date | null;
    lastSyncedAt: Date | null;
    revisionCount: number;
    /** Set when this document is one half of an agenda/minutes pair. */
    meetingRole: MeetingRole | null;
    counterpart: MeetingCounterpart | null;
    /** Documents this one links to, in the order they appear in the text. */
    references: RelatedDocument[];
    /** Documents that link here -- usually the meetings that took this up. */
    referencedBy: RelatedDocument[];
    /**
     * Links the author typed whose targets we do not hold: a private Drive
     * bill, a SharePoint report that needs a JHU login. Shown so the URL is
     * not only buried in the body.
     */
    unresolvedLinks: UnresolvedLink[];
    /** The neutral restatement shown beside the document. */
    restatement: DocumentRestatement | null;
    /**
     * `content` parsed into markdown blocks with the citations already
     * highlighted. Rendering is a plain walk over this; no offset arithmetic
     * belongs in a component.
     */
    blocks: Block[];
    /** People the document names, with the line each was read from. */
    contributors: {
        id: string;
        name: string;
        role: string;
        note: string | null;
        evidence: string;
    }[];
    /** Drive account provenance. Not authorship -- see the schema comment. */
    driveOwnerName: string | null;
    driveLastEditorName: string | null;
    /**
     * Set when the source file has changed by more than the site will publish
     * unread, and the text below is the last version that was checked. The
     * string is the reader-facing explanation; see lib/integrity.ts.
     */
    heldNotice: string | null;
    /** Whether anyone holding the link can edit the source file. */
    anyoneCanEdit: boolean | null;
};

/** Shape shared by both directions of the reference graph. */
const relatedSelect = {
    id: true,
    title: true,
    displayTitle: true,
    kind: true,
    sessionNumber: true,
} as const;

function toRelated(
    document: {
        id: string;
        title: string;
        displayTitle: string;
        kind: string;
        sessionNumber: number | null;
    },
    anchorText?: string,
): RelatedDocument {
    return {
        id: document.id,
        title: document.displayTitle || document.title,
        kind: isDocumentKind(document.kind) ? document.kind : "unknown",
        sessionNumber: document.sessionNumber,
        ...(anchorText ? { anchorText } : {}),
    };
}

function normaliseStatus(status: string): SectionStatus {
    return status === "fresh" || status === "stale" || status === "failed"
        ? status
        : "empty";
}

export async function getDocument(
    documentId: string,
): Promise<DocumentDetail | null> {
    if (demoModeEnabled()) return demoDocument(documentId);
    const document = await prisma.document.findUnique({
        where: { id: documentId },
        include: {
            documentAnnotations: {
                where: { orphanedAt: null },
                select: { id: true, startOffset: true, endOffset: true },
            },
            contributors: {
                select: {
                    role: true,
                    note: true,
                    evidence: true,
                    hopkinsAffiliate: { select: { id: true, name: true } },
                },
                orderBy: [{ role: "asc" }, { hopkinsAffiliate: { name: "asc" } }],
            },
            referencesOut: {
                select: { anchorText: true, toDocument: { select: relatedSelect } },
                orderBy: { ordinal: "asc" },
            },
            referencesIn: {
                select: { fromDocument: { select: relatedSelect } },
                orderBy: { fromDocument: { title: "asc" } },
            },
            summary: {
                include: {
                    citations: {
                        orderBy: { ordinal: "asc" },
                        include: {
                            annotation: {
                                select: { id: true, content: true, orphanedAt: true },
                            },
                        },
                    },
                },
            },
            _count: { select: { revisions: true } },
        },
    });

    if (!document) return null;

    const meetingRole = isMeetingRole(document.meetingRole)
        ? document.meetingRole
        : null;

    // The other side of the pair: same meeting, opposite role. Restricting to
    // the opposite role is what stops two sets of minutes for one meeting from
    // being presented as each other's agenda.
    const wantedRole: MeetingRole | null =
        meetingRole === "agenda" ? "minutes" : meetingRole === "minutes" ? "agenda" : null;

    const counterpartDocuments =
        document.meetingKey && wantedRole
            ? await prisma.document.findMany({
                where: {
                    meetingKey: document.meetingKey,
                    meetingRole: wantedRole,
                    NOT: { id: document.id },
                },
                select: relatedSelect,
                orderBy: { title: "asc" },
            })
            : [];

    const outgoing = extractDocumentLinks(document.content);
    const heldTargets =
        outgoing.length === 0
            ? new Set<string>()
            : new Set(
                (
                    await prisma.document.findMany({
                        where: { driveFileId: { in: outgoing.map((link) => link.fileId) } },
                        select: { driveFileId: true },
                    })
                ).map((row) => row.driveFileId),
            );
    const unresolvedLinks = outgoing.filter((link) => !heldTargets.has(link.fileId));

    return {
        meetingRole,
        counterpart:
            wantedRole && counterpartDocuments.length > 0
                ? { role: wantedRole, documents: counterpartDocuments.map((row) => toRelated(row)) }
                : null,
        references: document.referencesOut.map((edge) =>
            toRelated(edge.toDocument, edge.anchorText),
        ),
        referencedBy: document.referencesIn.map((edge) => toRelated(edge.fromDocument)),
        unresolvedLinks: unresolvedLinks.map((link) => ({
            url: link.url,
            text: link.text,
            source: link.source,
        })),
        restatement: document.summary
            ? {
                content: document.summary.content,
                status: normaliseStatus(document.summary.status),
                generatedAt: document.summary.generatedAt,
                citations: document.summary.citations.map((citation) => ({
                    annotationId: citation.annotationId,
                    quote: citation.annotation.content,
                    href: `#annotation-${citation.annotationId}`,
                    orphaned: citation.annotation.orphanedAt !== null,
                })),
            }
            : null,
        id: document.id,
        title: document.displayTitle || document.title,
        driveTitle: document.title,
        description: document.description,
        kind: isDocumentKind(document.kind) ? document.kind : "unknown",
        folderPath: document.folderPath,
        discoveredVia: document.discoveredVia,
        source: document.source,
        content: document.content,
        sessionNumber: document.sessionNumber,
        isCurrentSession: document.sessionNumber === SESSION_NUMBER,
        lineageKey: document.lineageKey,
        driveCreatedTime: document.driveCreatedTime,
        driveModifiedTime: document.driveModifiedTime,
        datedAt: document.datedAt,
        lastSyncedAt: document.lastSyncedAt,
        revisionCount: document._count.revisions,
        // A spreadsheet is rendered as a table rather than as the raw export.
        // The stored text is untouched -- citations still index into the CSV
        // exactly as it came out of Drive -- and only the parse differs.
        blocks: renderDocument(document.content, document.documentAnnotations, {
            sheetDelimiter: sheetDelimiter(document.mimeType),
        }),
        contributors: document.contributors.map((entry) => ({
            id: entry.hopkinsAffiliate.id,
            name: entry.hopkinsAffiliate.name,
            role: entry.role,
            note: entry.note,
            evidence: entry.evidence,
        })),
        driveOwnerName: document.driveOwnerName,
        driveLastEditorName: document.driveLastEditorName,
        heldNotice:
            document.reviewState === "held" ? heldNotice(document.heldReason) : null,
        anyoneCanEdit: document.anyoneCanEdit,
    };
}

/** Distinct kinds actually present, for building filters without empty options. */
export async function getDocumentKindsInUse(
    session: SessionFilter = SESSION_NUMBER,
): Promise<{ kind: DocumentKind; count: number }[]> {
    if (demoModeEnabled()) return demoKinds(session);
    const grouped = await prisma.document.groupBy({
        by: ["kind"],
        where: sessionWhere(session),
        _count: { kind: true },
    });

    return grouped
        .filter((group) => isDocumentKind(group.kind))
        .map((group) => ({
            kind: group.kind as DocumentKind,
            count: group._count.kind,
        }))
        .sort(
            (a, b) =>
                DOCUMENT_KINDS.indexOf(a.kind) - DOCUMENT_KINDS.indexOf(b.kind),
        );
}

/** Version history for a document, newest first. Content excluded. */
export async function getDocumentRevisions(documentId: string) {
    if (demoModeEnabled()) return [];
    return prisma.documentRevision.findMany({
        where: { documentId },
        select: {
            id: true,
            title: true,
            contentHash: true,
            driveModifiedTime: true,
            fetchedAt: true,
        },
        orderBy: { fetchedAt: "desc" },
    });
}
