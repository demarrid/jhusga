'use server'

import { SESSION_NUMBER } from "@/config/sga";
import { collapseUnchanged, diffLines } from "@/lib/diff";
import { listedDate } from "@/lib/dates";
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
    datedAt: Date | null;
    driveModifiedTime: Date | null;
};

export type Lineage = {
    lineageKey: string;
    /** Newest edition first. */
    members: LineageMember[];
};

function toMember(document: {
    id: string;
    title: string;
    displayTitle: string;
    kind: string;
    sessionNumber: number | null;
    datedAt?: Date | null;
    driveCreatedTime?: Date | null;
    driveModifiedTime: Date | null;
}): LineageMember {
    return {
        id: document.id,
        title: document.displayTitle || document.title,
        kind: isDocumentKind(document.kind) ? document.kind : "unknown",
        sessionNumber: document.sessionNumber,
        datedAt: listedDate({
            datedAt: document.datedAt ?? null,
            driveCreatedTime: document.driveCreatedTime ?? null,
            driveModifiedTime: document.driveModifiedTime,
        }),
        driveModifiedTime: document.driveModifiedTime,
    };
}

const lineageSelect = {
    id: true,
    title: true,
    displayTitle: true,
    kind: true,
    sessionNumber: true,
    datedAt: true,
    driveCreatedTime: true,
    driveModifiedTime: true,
} as const;

/** Every session's copy of one guiding document, newest first. */
export async function getLineage(lineageKey: string): Promise<Lineage> {
    if (demoModeEnabled()) return demoLineage(lineageKey);
    const documents = await prisma.document.findMany({
        where: { lineageKey, kind: { in: COMPARABLE_KINDS } },
        select: lineageSelect,
        orderBy: [{ sessionNumber: "desc" }, { datedAt: "desc" }],
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
        select: { ...lineageSelect, lineageKey: true },
        orderBy: [{ sessionNumber: "desc" }, { datedAt: "desc" }],
    });

    const byLineage = new Map<string, LineageMember[]>();
    for (const document of documents) {
        const members = byLineage.get(document.lineageKey) ?? [];
        members.push(toMember(document));
        byLineage.set(document.lineageKey, members);
    }

    return [...byLineage.entries()]
        .map(([lineageKey, members]) => ({ lineageKey, members }))
        // One file is not a comparison; two editions of the same instrument
        // are, even when they were adopted in the same session.
        .filter((lineage) => lineage.members.length > 1)
        .sort((a, b) => b.members.length - a.members.length);
}

export type ComparisonOptions = {
    document: {
        id: string;
        title: string;
        kind: DocumentKind;
        sessionNumber: number | null;
        datedAt: Date | null;
        lineageKey: string;
    };
    /** Whether this is the sort of document worth comparing at all. */
    comparable: boolean;
    /** The other editions of this document, including dated copies from the same session. */
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
            datedAt: true,
            driveCreatedTime: true,
            driveModifiedTime: true,
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

    // Every other edition, including dated snapshots from the same session.
    // "Constitution April 2026" and "Constitution Fall 2025" are two files
    // the SGA kept on purpose; collapsing them as Drive duplicates would
    // hide the comparison the archive exists to make. Identical text is
    // still shown — the page says so — rather than dropped.
    const siblings = comparable
        ? await prisma.document.findMany({
            where: {
                lineageKey: document.lineageKey,
                kind: { in: COMPARABLE_KINDS },
                id: { not: documentId },
            },
            select: lineageSelect,
            orderBy: [{ sessionNumber: "desc" }, { datedAt: "desc" }],
        })
        : [];

    return {
        document: {
            id: document.id,
            title: document.displayTitle || document.title,
            kind: isDocumentKind(document.kind) ? document.kind : "unknown",
            sessionNumber: document.sessionNumber,
            datedAt: listedDate(document),
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

export type AmendmentLink = {
    id: string;
    title: string;
    kind: DocumentKind;
    sessionNumber: number | null;
    datedAt: Date | null;
};

/**
 * Bills that amended this instrument between two editions.
 *
 * The line-by-line diff is the net change; these are the acts that produced
 * it, which a reader comparing April 2026 to Fall 2025 also wants to see.
 */
export async function getAmendmentsBetween(
    beforeId: string,
    afterId: string,
): Promise<AmendmentLink[]> {
    if (demoModeEnabled()) return [];

    const select = {
        id: true,
        title: true,
        displayTitle: true,
        kind: true,
        lineageKey: true,
        sessionNumber: true,
        datedAt: true,
        driveCreatedTime: true,
        driveModifiedTime: true,
    } as const;

    const [left, right] = await Promise.all([
        prisma.document.findUnique({ where: { id: beforeId }, select }),
        prisma.document.findUnique({ where: { id: afterId }, select }),
    ]);
    if (!left || !right) return [];

    const amendmentKind =
        left.kind === "guiding.constitution" || right.kind === "guiding.constitution"
            ? "bill.constitution_amendment"
            : left.kind === "guiding.bylaws" || right.kind === "guiding.bylaws"
                ? "bill.bylaws_amendment"
                : null;
    if (!amendmentKind) return [];

    const leftDate = listedDate(left)?.getTime() ?? 0;
    const rightDate = listedDate(right)?.getTime() ?? 0;
    const start = Math.min(leftDate, rightDate);
    const end = Math.max(leftDate, rightDate);

    const lineageKey = left.lineageKey || right.lineageKey;
    const bills = await prisma.document.findMany({
        where: {
            kind: amendmentKind,
            ...(lineageKey ? { lineageKey } : {}),
        },
        select: {
            id: true,
            title: true,
            displayTitle: true,
            kind: true,
            sessionNumber: true,
            datedAt: true,
            driveCreatedTime: true,
            driveModifiedTime: true,
        },
    });

    return bills
        .map((bill) => ({
            id: bill.id,
            title: bill.displayTitle || bill.title,
            kind: isDocumentKind(bill.kind) ? bill.kind : "unknown",
            sessionNumber: bill.sessionNumber,
            datedAt: listedDate(bill),
        }))
        .filter((bill) => {
            const time = bill.datedAt?.getTime();
            if (time === undefined) {
                const session = bill.sessionNumber;
                if (session === null) return true;
                const olderSession = Math.min(left.sessionNumber ?? session, right.sessionNumber ?? session);
                const newerSession = Math.max(left.sessionNumber ?? session, right.sessionNumber ?? session);
                return session >= olderSession && session <= newerSession;
            }
            if (start === 0 && end === 0) return true;
            return time >= start && time <= end;
        })
        .sort((a, b) => (a.datedAt?.getTime() ?? 0) - (b.datedAt?.getTime() ?? 0));
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
