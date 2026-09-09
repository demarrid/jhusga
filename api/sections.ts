'use server'

import { prisma } from "@/lib/prisma";
import { type SectionStatus } from "@/lib/sections";

/**
 * Read access to cached, cited prose.
 *
 * Pages only ever read from here. Generation happens on the cron path, so a
 * page render never waits on (or pays for) a model call.
 */

export type SectionCitation = {
    id: string;
    annotationId: string;
    documentId: string;
    documentTitle: string;
    /** The verbatim supporting passage. */
    quote: string;
    /** Deep link that scrolls to and highlights the passage. */
    href: string;
    /** True when the quoted passage has since been amended away. */
    orphaned: boolean;
};

export type Section = {
    key: string;
    content: string;
    status: SectionStatus;
    generatedAt: Date | null;
    citations: SectionCitation[];
};

function normaliseStatus(status: string): SectionStatus {
    return status === "fresh" || status === "stale" || status === "failed"
        ? status
        : "empty";
}

export async function getSection(key: string): Promise<Section | null> {
    const section = await prisma.generatedSection.findUnique({
        where: { key },
        include: {
            citations: {
                orderBy: { ordinal: "asc" },
                include: {
                    annotation: {
                        include: {
                            document: { select: { id: true, title: true } },
                        },
                    },
                },
            },
        },
    });

    if (!section) return null;

    return {
        key: section.key,
        content: section.content,
        status: normaliseStatus(section.status),
        generatedAt: section.generatedAt,
        citations: section.citations.map((citation) => ({
            id: citation.id,
            annotationId: citation.annotationId,
            documentId: citation.annotation.document.id,
            documentTitle: citation.annotation.document.title,
            quote: citation.annotation.content,
            href: `/documents/${citation.annotation.document.id}#annotation-${citation.annotationId}`,
            orphaned: citation.annotation.orphanedAt !== null,
        })),
    };
}

/** Batch variant, so a page with several slots issues one query. */
export async function getSections(
    keys: string[],
): Promise<Record<string, Section>> {
    const sections = await Promise.all(keys.map((key) => getSection(key)));

    return sections.reduce<Record<string, Section>>((accumulator, section) => {
        if (section) accumulator[section.key] = section;
        return accumulator;
    }, {});
}

/** Most recent sync attempt, for a "last updated" or health indicator. */
export async function getLatestSyncRun() {
    return prisma.syncRun.findFirst({ orderBy: { startedAt: "desc" } });
}
