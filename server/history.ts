import {
    HISTORY_TOPICS,
    historyTopic,
    type HistoryDatePrecision,
    type HistoryEventKind,
    type HistoryOutcome,
    type HistoryTopicDefinition,
} from "@/config/history";
import { demoModeEnabled } from "@/lib/data-mode";
import { demoHistoryTimeline, demoHistoryTopics } from "@/lib/demo-data";
import { prisma } from "@/lib/prisma";
import type { SectionStatus } from "@/lib/sections";

/**
 * Read access to computed timelines. Pages only read; lib/history-generate.ts
 * writes, offline.
 */

export type HistoryTopicSummary = {
    topic: HistoryTopicDefinition;
    status: SectionStatus;
    generatedAt: Date | null;
    eventCount: number;
    firstAt: Date | null;
    lastAt: Date | null;
    /** Events per calendar year from firstAt to lastAt, for a sparkline. */
    perYear: { year: number; count: number }[];
};

export type HistoryCitation = {
    id: string;
    documentId: string;
    documentTitle: string;
    quote: string;
    href: string;
    orphaned: boolean;
};

export type HistoryEventRecord = {
    id: string;
    occurredAt: Date | null;
    endedAt: Date | null;
    datePrecision: HistoryDatePrecision;
    title: string;
    content: string;
    thread: string;
    kind: HistoryEventKind;
    involvement: "sga" | "context";
    outcome: HistoryOutcome;
    weight: 1 | 2 | 3;
    citations: HistoryCitation[];
};

export type HistoryTimeline = {
    topic: HistoryTopicDefinition;
    status: SectionStatus;
    generatedAt: Date | null;
    events: HistoryEventRecord[];
    documentCount: number;
};

function normaliseStatus(status: string | undefined): SectionStatus {
    return status === "fresh" || status === "stale" || status === "failed" ? status : "empty";
}

export async function getHistoryTopics(): Promise<HistoryTopicSummary[]> {
    if (demoModeEnabled()) return demoHistoryTopics();

    const rows = await prisma.historyTopic.findMany({
        where: { slug: { in: HISTORY_TOPICS.map((topic) => topic.slug) } },
        select: { id: true, slug: true, status: true, generatedAt: true },
    });
    const bySlug = new Map(rows.map((row) => [row.slug, row]));

    const years = rows.length === 0
        ? []
        : await prisma.$queryRaw<{ topicId: string; year: number; count: number }[]>`
            select "topicId", extract(year from "occurredAt")::int as year, count(*)::int as count
              from "HistoryEvent"
             where "topicId" = any(${rows.map((row) => row.id)}) and "occurredAt" is not null
             group by 1, 2`;

    return HISTORY_TOPICS.map((topic) => {
        const row = bySlug.get(topic.slug);
        const counts = years.filter((entry) => entry.topicId === row?.id);
        const first = counts.length ? Math.min(...counts.map((entry) => entry.year)) : null;
        const last = counts.length ? Math.max(...counts.map((entry) => entry.year)) : null;
        const perYear =
            first === null || last === null
                ? []
                : Array.from({ length: last - first + 1 }, (_, index) => ({
                    year: first + index,
                    count: counts.find((entry) => entry.year === first + index)?.count ?? 0,
                }));
        return {
            topic,
            status: normaliseStatus(row?.status),
            generatedAt: row?.generatedAt ?? null,
            eventCount: counts.reduce((sum, entry) => sum + entry.count, 0),
            firstAt: first === null ? null : new Date(Date.UTC(first, 0, 1)),
            lastAt: last === null ? null : new Date(Date.UTC(last, 11, 31)),
            perYear,
        };
    });
}

export async function getHistoryTimeline(slug: string): Promise<HistoryTimeline | null> {
    const topic = historyTopic(slug);
    if (!topic) return null;
    if (demoModeEnabled()) return demoHistoryTimeline(topic);

    const row = await prisma.historyTopic.findUnique({
        where: { slug },
        select: {
            status: true,
            generatedAt: true,
            events: {
                orderBy: [{ occurredAt: { sort: "asc", nulls: "last" } }, { title: "asc" }],
                select: {
                    id: true,
                    occurredAt: true,
                    endedAt: true,
                    datePrecision: true,
                    title: true,
                    content: true,
                    thread: true,
                    kind: true,
                    involvement: true,
                    outcome: true,
                    weight: true,
                    citations: {
                        orderBy: { ordinal: "asc" },
                        select: {
                            id: true,
                            annotationId: true,
                            annotation: {
                                select: {
                                    content: true,
                                    orphanedAt: true,
                                    document: { select: { id: true, title: true, displayTitle: true } },
                                },
                            },
                        },
                    },
                },
            },
        },
    });
    if (!row) return { topic, status: "empty", generatedAt: null, events: [], documentCount: 0 };

    const threadIds = new Set(topic.threads.map((thread) => thread.id));
    const documents = new Set<string>();
    const events = row.events.map((event): HistoryEventRecord => ({
        id: event.id,
        occurredAt: event.occurredAt,
        endedAt: event.endedAt,
        datePrecision: event.datePrecision as HistoryDatePrecision,
        title: event.title,
        content: event.content,
        thread: threadIds.has(event.thread) ? event.thread : topic.threads[topic.threads.length - 1]!.id,
        kind: event.kind as HistoryEventKind,
        involvement: event.involvement === "context" ? "context" : "sga",
        outcome: event.outcome as HistoryOutcome,
        weight: (event.weight >= 3 ? 3 : event.weight === 2 ? 2 : 1),
        citations: event.citations.map((citation) => {
            const document = citation.annotation.document;
            documents.add(document.id);
            return {
                id: citation.id,
                documentId: document.id,
                documentTitle: document.displayTitle || document.title,
                quote: citation.annotation.content,
                href: `/documents/${document.id}?version=latest#annotation-${citation.annotationId}`,
                orphaned: citation.annotation.orphanedAt !== null,
            };
        }),
    }));

    return {
        topic,
        status: normaliseStatus(row.status),
        generatedAt: row.generatedAt,
        events,
        documentCount: documents.size,
    };
}
