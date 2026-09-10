'use server'

import { SESSION_NUMBER } from "@/config/sga";
import { collapseUnchanged, diffLines } from "@/lib/diff";
import {
    COMPARABLE_KINDS,
    isComparableKind,
    type DocumentKind,
    isDocumentKind,
} from "@/lib/kinds";
import { prisma } from "@/lib/prisma";
import { demoModeEnabled } from "@/lib/data-mode";
import {
    demoComparableLineages,
    demoComparison,
    demoComparisonOptions,
    demoLineage,
    demoSessions,
} from "@/lib/demo-data";

/**
 * The historical record: prior sessions' documents, and the comparisons that
 * make an amendment legible.
 *
 * Nothing here feeds a generated summary. Archived sessions are chronicle, and
 * generation is restricted to the current session in lib/generate.ts.
 */

export type SessionSummary = {
    sessionNumber: number;
    documentCount: number;
    isCurrent: boolean;
};

export async function getSessions(): Promise<SessionSummary[]> {
    if (demoModeEnabled()) return demoSessions();
    const grouped = await prisma.document.groupBy({
        by: ["sessionNumber"],
        _count: { sessionNumber: true },
    });

    return grouped
        .filter(
            (group): group is typeof group & { sessionNumber: number } =>
                group.sessionNumber !== null,
        )
        .map((group) => ({
            sessionNumber: group.sessionNumber,
            documentCount: group._count.sessionNumber,
            isCurrent: group.sessionNumber === SESSION_NUMBER,
        }))
        .sort((a, b) => b.sessionNumber - a.sessionNumber);
}

export type LineageMember = {
    id: string;
    title: string;
    kind: DocumentKind;
    sessionNumber: number | null;
    driveModifiedTime: Date | null;
};

export type Lineage = {
    lineageKey: string;
    /** Newest session first. */
    members: LineageMember[];
};

function toMember(document: {
    id: string;
    title: string;
    displayTitle: string;
    kind: string;
    sessionNumber: number | null;
    driveModifiedTime: Date | null;
}): LineageMember {
    return {
        id: document.id,
        title: document.displayTitle || document.title,
        kind: isDocumentKind(document.kind) ? document.kind : "unknown",
        sessionNumber: document.sessionNumber,
        driveModifiedTime: document.driveModifiedTime,
    };
}

/** Every session's copy of one guiding document, newest first. */
export async function getLineage(lineageKey: string): Promise<Lineage> {
    if (demoModeEnabled()) return demoLineage(lineageKey);
    const documents = await prisma.document.findMany({
        where: { lineageKey, kind: { in: COMPARABLE_KINDS } },
        select: {
            id: true,
            title: true,
            displayTitle: true,
            kind: true,
            sessionNumber: true,
            driveModifiedTime: true,
        },
        orderBy: { sessionNumber: "desc" },
    });

    return { lineageKey, members: documents.map(toMember) };
}

/**
 * Guiding documents held by more than one session, i.e. the documents there is
 * actually something to compare.
 */
export async function getComparableLineages(): Promise<Lineage[]> {
    if (demoModeEnabled()) return demoComparableLineages();
    const grouped = await prisma.document.groupBy({
        by: ["lineageKey"],
        where: { NOT: { lineageKey: "" }, kind: { in: COMPARABLE_KINDS } },
        _count: { lineageKey: true },
        having: { lineageKey: { _count: { gt: 1 } } },
    });

    const keys = grouped.map((group) => group.lineageKey);
    if (keys.length === 0) return [];

    // One query for all of them rather than one per lineage.
    const documents = await prisma.document.findMany({
        where: { lineageKey: { in: keys }, kind: { in: COMPARABLE_KINDS } },
        select: {
            id: true,
            title: true,
            displayTitle: true,
            kind: true,
            lineageKey: true,
            sessionNumber: true,
            driveModifiedTime: true,
        },
        orderBy: { sessionNumber: "desc" },
    });

    const byLineage = new Map<string, LineageMember[]>();
    for (const document of documents) {
        const members = byLineage.get(document.lineageKey) ?? [];
        members.push(toMember(document));
        byLineage.set(document.lineageKey, members);
    }

    return [...byLineage.entries()]
        .map(([lineageKey, members]) => ({ lineageKey, members }))
        // Two copies the same session kept of one document are a Drive
        // duplicate, not an amendment; the comparison is a cross-session one.
        .filter(
            (lineage) =>
                new Set(lineage.members.map((member) => member.sessionNumber)).size > 1,
        )
        // Documents spanning the most sessions first.
        .sort((a, b) => b.members.length - a.members.length);
}

export type ComparisonOptions = {
    document: {
        id: string;
        title: string;
        kind: DocumentKind;
        sessionNumber: number | null;
        lineageKey: string;
    };
    /** Whether this is the sort of document worth comparing at all. */
    comparable: boolean;
    /** The same document as kept by other sessions. */
    otherSessions: LineageMember[];
    /** This document's own history, for amendments made within a session. */
    revisions: {
        id: string;
        contentHash: string;
        fetchedAt: Date;
        driveModifiedTime: Date | null;
    }[];
};

/** What a given document can usefully be compared against. */
export async function getComparisonOptions(
    documentId: string,
): Promise<ComparisonOptions | null> {
    if (demoModeEnabled()) return demoComparisonOptions(documentId);
    const document = await prisma.document.findUnique({
        where: { id: documentId },
        select: {
            id: true,
            title: true,
            displayTitle: true,
            kind: true,
            sessionNumber: true,
            lineageKey: true,
            revisions: {
                select: {
                    id: true,
                    contentHash: true,
                    fetchedAt: true,
                    driveModifiedTime: true,
                },
                orderBy: { fetchedAt: "desc" },
            },
        },
    });

    if (!document) return null;

    const comparable = isComparableKind(document.kind) && document.lineageKey !== "";

    // Only other sessions: a second copy of this session's bylaws sitting in
    // the same folder is a Drive duplicate, and diffing it against its twin
    // presents a copy-paste as an amendment.
    const siblings = comparable
        ? await prisma.document.findMany({
            where: {
                lineageKey: document.lineageKey,
                kind: { in: COMPARABLE_KINDS },
                id: { not: documentId },
                ...(document.sessionNumber !== null
                    ? { sessionNumber: { not: document.sessionNumber } }
                    : {}),
            },
            select: {
                id: true,
                title: true,
                displayTitle: true,
                kind: true,
                sessionNumber: true,
                driveModifiedTime: true,
            },
            orderBy: { sessionNumber: "desc" },
        })
        : [];

    return {
        document: {
            id: document.id,
            title: document.displayTitle || document.title,
            kind: isDocumentKind(document.kind) ? document.kind : "unknown",
            sessionNumber: document.sessionNumber,
            lineageKey: document.lineageKey,
        },
        comparable,
        otherSessions: siblings.map(toMember),
        revisions: document.revisions,
    };
}

export type Comparison = {
    before: { id: string; title: string; sessionNumber: number | null };
    after: { id: string; title: string; sessionNumber: number | null };
    added: number;
    removed: number;
    coarse: boolean;
    /** Unchanged stretches collapsed to a skip marker. */
    ops: (
        | { type: "equal" | "added" | "removed"; lines: string[] }
        | { type: "skipped"; count: number }
    )[];
};

/** Line-level diff between any two documents. */
export async function compareDocuments(
    beforeId: string,
    afterId: string,
): Promise<Comparison | null> {
    if (demoModeEnabled()) return demoComparison(beforeId, afterId);
    const select = {
        id: true,
        title: true,
        displayTitle: true,
        sessionNumber: true,
        content: true,
    } as const;

    const [before, after] = await Promise.all([
        prisma.document.findUnique({ where: { id: beforeId }, select }),
        prisma.document.findUnique({ where: { id: afterId }, select }),
    ]);

    if (!before || !after) return null;

    const diff = diffLines(before.content, after.content);

    return {
        before: {
            id: before.id,
            title: before.displayTitle || before.title,
            sessionNumber: before.sessionNumber,
        },
        after: {
            id: after.id,
            title: after.displayTitle || after.title,
            sessionNumber: after.sessionNumber,
        },
        added: diff.added,
        removed: diff.removed,
        coarse: diff.coarse,
        ops: collapseUnchanged(diff),
    };
}

/**
 * Compare one document's own history, for amendments made within a session.
 * Pass revision IDs from getDocumentRevisions.
 */
export async function compareRevisions(
    beforeRevisionId: string,
    afterRevisionId: string,
): Promise<{
    added: number;
    removed: number;
    coarse: boolean;
    ops: Comparison["ops"];
} | null> {
    const [before, after] = await Promise.all([
        prisma.documentRevision.findUnique({
            where: { id: beforeRevisionId },
            select: { content: true },
        }),
        prisma.documentRevision.findUnique({
            where: { id: afterRevisionId },
            select: { content: true },
        }),
    ]);

    if (!before || !after) return null;

    const diff = diffLines(before.content, after.content);
    return {
        added: diff.added,
        removed: diff.removed,
        coarse: diff.coarse,
        ops: collapseUnchanged(diff),
    };
}
