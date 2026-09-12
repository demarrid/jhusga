import { createHash } from "node:crypto";

import { generateJson } from "@/lib/ai";
import { findQuote } from "@/lib/anchor";
import { documentKindLabel } from "@/lib/kinds";
import { prisma } from "@/lib/prisma";
import type { SectionStatus } from "@/lib/sections";
import { summaryPromptVersion, summarySystemPrompt } from "@/lib/summary-prompt";

/**
 * A plain-language reading of one document.
 *
 * SGA documents are written by whoever held the office that year. Some minutes
 * are terse to the point of being cryptic, some bury the decision under twenty
 * lines of attendance, and a bill's actual effect is usually one clause inside
 * a page of preamble. A reader should not have to reverse-engineer what
 * happened from the minute-taker's prose style.
 *
 * So every document gets a short, uniform restatement in the same register,
 * and every claim in it carries a marker linking to the passage it came from.
 * The neutrality is the point: the summary tells you what the document does,
 * and the citation lets you check that against what the author actually wrote.
 *
 * A News-Letter article gets one too, in the one register that has to differ.
 * It is reporting about the SGA rather than a record by it, so its summary is
 * written as the paper's account and not as the archive's own; the two sets of
 * instructions are in lib/summary-prompt.ts.
 *
 * The verification gate from lib/generate.ts applies unchanged -- a quote that
 * is not in the document is dropped, and a summary with no surviving quotes is
 * never published. Two things are tighter here:
 *
 * 1. The model sees exactly one document, so it cannot attribute a claim to
 *    the wrong source.
 * 2. Citations are restricted to that same document, so every marker resolves
 *    to a highlight on the page the reader is already on.
 */

/** Prompt budget for one document, in characters. */
const MAX_DOCUMENT_CHARS = 90_000;

/**
 * How many documents one pipeline run will restate.
 *
 * A summary is one model call, and a run of the pipeline has minutes rather
 * than hours (the cron route's maxDuration), so a backlog is worked through
 * over several runs. Newest session first, so the documents a reader is most
 * likely to open are the ones that get done. `npm run summarize` is the way to
 * clear the rest in one sitting.
 */
export const SUMMARY_RUN_BUDGET = 25;

type ModelResponse = {
    content?: string;
    insufficientContent?: boolean;
    citations?: { quote?: string }[];
};

export type SummarizeResult = {
    documentId: string;
    title: string;
    status: SectionStatus;
    /** True when the cached summary was already current and no call was made. */
    skipped: boolean;
    citationsVerified: number;
    citationsRejected: number;
    error?: string;
};

/**
 * Fingerprint of everything that affects the output. Keyed on the document's
 * content hash, so re-running over the whole archive costs nothing for the
 * documents that have not changed, and on the version of the prompt the kind is
 * actually read under, so a revision to one prompt leaves the other's cache
 * alone.
 */
function promptFingerprint(contentHash: string, kind: string): string {
    return createHash("sha256")
        .update(summaryPromptVersion(kind))
        .update(`\u0000${kind}\u0000${contentHash}`)
        .digest("hex");
}

function buildUserPrompt(document: {
    title: string;
    kind: string;
    content: string;
}): string {
    const body = document.content.slice(0, MAX_DOCUMENT_CHARS);

    return [
        `<document kind="${documentKindLabel(document.kind)}" title="${document.title.replace(/"/g, "'")}">`,
        body,
        body.length < document.content.length ? "\n[document truncated]" : "",
        "</document>",
    ]
        .filter(Boolean)
        .join("\n");
}

async function record(
    documentId: string,
    data: {
        status: SectionStatus;
        content?: string;
        model?: string;
        promptHash?: string;
        error?: string | null;
        generatedAt?: Date | null;
    },
): Promise<void> {
    const fields = {
        status: data.status,
        content: data.content ?? "",
        model: data.model ?? "",
        promptHash: data.promptHash ?? "",
        error: data.error ?? null,
        generatedAt: data.generatedAt ?? null,
    };

    await prisma.documentSummary.upsert({
        where: { documentId },
        create: { documentId, ...fields },
        update: fields,
    });
}

/**
 * Documents worth spending a model call on.
 *
 * Empty documents and templates have nothing to restate, and a template's
 * placeholder text ("SENATOR \#1") is exactly the kind of thing that reads as
 * fact once it has been summarised.
 */
export function isSummarisable(document: {
    title: string;
    content: string;
}): boolean {
    if (document.content.trim().length < 400) return false;
    if (/\btemplate\b/i.test(document.title)) return false;
    return true;
}

/** Summarise one document, verify its quotes, and cache the result. */
export async function summarizeDocument(
    documentId: string,
    options: { force?: boolean } = {},
): Promise<SummarizeResult> {
    const document = await prisma.document.findUnique({
        where: { id: documentId },
        select: {
            id: true,
            title: true,
            kind: true,
            content: true,
            contentHash: true,
            summary: { select: { id: true, status: true, promptHash: true } },
        },
    });

    if (!document) throw new Error(`No document ${documentId}`);

    const base = { documentId, title: document.title };

    if (!isSummarisable(document)) {
        await record(documentId, {
            status: "empty",
            error: "Too short or too templated to restate",
        });
        return { ...base, status: "empty", skipped: false, citationsVerified: 0, citationsRejected: 0 };
    }

    const fingerprint = promptFingerprint(document.contentHash, document.kind);

    if (
        !options.force &&
        document.summary?.status === "fresh" &&
        document.summary.promptHash === fingerprint
    ) {
        return {
            ...base,
            status: "fresh",
            skipped: true,
            citationsVerified: await prisma.documentSummaryCitation.count({
                where: { summaryId: document.summary.id },
            }),
            citationsRejected: 0,
        };
    }

    let response: ModelResponse;
    let model: string;
    try {
        const generated = await generateJson<ModelResponse>({
            system: summarySystemPrompt(document.kind),
            user: buildUserPrompt(document),
        });
        response = generated.value;
        model = generated.model;
    } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause);
        // Leave any previously good summary in place; only record the failure.
        await prisma.documentSummary.upsert({
            where: { documentId },
            create: { documentId, status: "failed", error: message },
            update: { status: "failed", error: message },
        });
        return {
            ...base,
            status: "failed",
            skipped: false,
            citationsVerified: 0,
            citationsRejected: 0,
            error: message,
        };
    }

    // The verification gate: a quote that is not in this document is dropped.
    const verified: string[] = [];
    let rejected = 0;

    for (const citation of response.citations ?? []) {
        const quote = citation.quote;
        if (!quote || !findQuote(document.content, quote)) {
            rejected += 1;
            continue;
        }
        if (verified.includes(quote)) continue;
        verified.push(quote);
    }

    const content = (response.content ?? "").trim();

    if (response.insufficientContent || !content) {
        await record(documentId, {
            status: "empty",
            model,
            promptHash: fingerprint,
            error: "Nothing substantive to restate",
        });
        return { ...base, status: "empty", skipped: false, citationsVerified: 0, citationsRejected: rejected };
    }

    if (verified.length === 0) {
        const message = `Model returned ${rejected} quote(s), none of which appear in the document`;
        await prisma.documentSummary.upsert({
            where: { documentId },
            create: { documentId, status: "failed", model, error: message },
            update: { status: "failed", model, error: message },
        });
        return {
            ...base,
            status: "failed",
            skipped: false,
            citationsVerified: 0,
            citationsRejected: rejected,
            error: message,
        };
    }

    await prisma.$transaction(async (tx) => {
        const summary = await tx.documentSummary.upsert({
            where: { documentId },
            create: {
                documentId,
                content,
                status: "fresh",
                model,
                promptHash: fingerprint,
                error: null,
                generatedAt: new Date(),
            },
            update: {
                content,
                status: "fresh",
                model,
                promptHash: fingerprint,
                error: null,
                generatedAt: new Date(),
            },
        });

        await tx.documentSummaryCitation.deleteMany({ where: { summaryId: summary.id } });

        for (const [ordinal, quote] of verified.entries()) {
            const anchor = findQuote(document.content, quote);

            // Annotations are shared with the section citations in
            // lib/generate.ts, so a passage cited by both is one highlight.
            const annotation =
                (await tx.documentAnnotation.findFirst({
                    where: { documentId, content: quote },
                })) ??
                (await tx.documentAnnotation.create({
                    data: {
                        documentId,
                        content: quote,
                        startOffset: anchor?.startOffset ?? null,
                        endOffset: anchor?.endOffset ?? null,
                    },
                }));

            await tx.documentSummaryCitation.create({
                data: { summaryId: summary.id, annotationId: annotation.id, ordinal },
            });
        }
    });

    return {
        ...base,
        status: "fresh",
        skipped: false,
        citationsVerified: verified.length,
        citationsRejected: rejected,
    };
}

/**
 * Summarise documents that have no current summary.
 *
 * Ordered newest-session-first so a run that is interrupted (or budgeted) has
 * done the documents a reader is most likely to open.
 */
export async function summarizeStaleDocuments(
    options: {
        force?: boolean;
        /** Restrict to one session; omit for the whole archive. */
        session?: number;
        /** Stop after this many model calls. */
        limit?: number;
        onResult?: (result: SummarizeResult) => void;
    } = {},
): Promise<SummarizeResult[]> {
    const documents = await prisma.document.findMany({
        where: {
            // Every kind, secondary sources included. Documents that exported
            // to nothing are here too, though they cost no model call:
            // `isSummarisable` turns each away once and records why, which is
            // what lets the page say there is nothing to restate rather than
            // promising a summary that is never coming.
            //
            // An article is read under the prompt for a secondary source and
            // never the one for an SGA record, so what a reader gets beside a
            // piece of reporting is an account of what the paper reported and
            // not a second version of the minutes. That distinction lives in
            // `summarySystemPrompt`, which is where it belongs: excluding
            // articles here protected nothing it protects, and only left every
            // article's sidebar promising a summary nothing would ever write.
            ...(options.session === undefined ? {} : { sessionNumber: options.session }),
            ...(options.force
                ? {}
                : {
                    OR: [
                        { summary: { is: null } },
                        { summary: { status: { in: ["stale", "failed"] } } },
                    ],
                }),
        },
        select: { id: true, title: true },
        orderBy: [{ sessionNumber: "desc" }, { driveModifiedTime: "desc" }],
    });

    const results: SummarizeResult[] = [];
    let calls = 0;

    for (const document of documents) {
        if (options.limit !== undefined && calls >= options.limit) break;

        let result: SummarizeResult;
        try {
            result = await summarizeDocument(document.id, { force: options.force });
        } catch (cause) {
            result = {
                documentId: document.id,
                title: document.title,
                status: "failed",
                skipped: false,
                citationsVerified: 0,
                citationsRejected: 0,
                error: cause instanceof Error ? cause.message : String(cause),
            };
        }

        if (!result.skipped) calls += 1;
        results.push(result);
        options.onResult?.(result);
    }

    return results;
}
