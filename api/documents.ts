'use server'

import { SESSION_NUMBER } from "@/config/sga";
import { DOCUMENT_KINDS, type DocumentKind, isDocumentKind } from "@/lib/kinds";
import { isMeetingRole, type MeetingRole } from "@/lib/meetings";
import { prisma } from "@/lib/prisma";
import { renderDocument, type Block } from "@/lib/render";
import type { SectionStatus } from "@/lib/sections";

/** One row in the document listing. */
export type DocumentListing = {
    id: string;
    /** The standardised name shown to readers. */
    title: string;
    /** The Drive filename, for the hover and for "what the author called it". */
    driveTitle: string;
    description: string;
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
            contributors: {
                select: {
                    role: true,
                    hopkinsAffiliate: { select: { id: true, name: true } },
                },
                orderBy: { hopkinsAffiliate: { name: "asc" } },
            },
        },
        orderBy: [
            { sessionNumber: "desc" },
            { driveModifiedTime: "desc" },
            { title: "asc" },
        ],
    });

    return documents.map((document) => ({
        ...document,
        title: document.displayTitle || document.title,
        driveTitle: document.title,
        kind: isDocumentKind(document.kind) ? document.kind : "unknown",
        contributors: document.contributors.map((entry) => ({
            id: entry.hopkinsAffiliate.id,
            name: entry.hopkinsAffiliate.name,
            role: entry.role,
        })),
    }));
}

/** People named anywhere in the archive, for the person filter. */
export async function getPeopleInUse(
    session: SessionFilter = SESSION_NUMBER,
): Promise<{ id: string; name: string; count: number }[]> {
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
    lastSyncedAt: Date | null;
    revisionCount: number;
    /** Set when this document is one half of an agenda/minutes pair. */
    meetingRole: MeetingRole | null;
    counterpart: MeetingCounterpart | null;
    /** Documents this one links to, in the order they appear in the text. */
    references: RelatedDocument[];
    /** Documents that link here -- usually the meetings that took this up. */
    referencedBy: RelatedDocument[];
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
        lastSyncedAt: document.lastSyncedAt,
        revisionCount: document._count.revisions,
        blocks: renderDocument(document.content, document.documentAnnotations),
        contributors: document.contributors.map((entry) => ({
            id: entry.hopkinsAffiliate.id,
            name: entry.hopkinsAffiliate.name,
            role: entry.role,
            note: entry.note,
            evidence: entry.evidence,
        })),
        driveOwnerName: document.driveOwnerName,
        driveLastEditorName: document.driveLastEditorName,
    };
}

/** Distinct kinds actually present, for building filters without empty options. */
export async function getDocumentKindsInUse(
    session: SessionFilter = SESSION_NUMBER,
): Promise<{ kind: DocumentKind; count: number }[]> {
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
