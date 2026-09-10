import { createHash } from "node:crypto";

import { generateJson } from "@/lib/ai";
import { findQuote } from "@/lib/anchor";
import { documentKindLabel } from "@/lib/kinds";
import { prisma } from "@/lib/prisma";
import type { SectionStatus } from "@/lib/sections";

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
 * Bumped when the prompt changes, so cached summaries regenerate instead of
 * serving prose written to older instructions.
 */
const PROMPT_VERSION = "document-summary-v2";

const SYSTEM_PROMPT = `You restate a single Johns Hopkins University Student Government Association document for a reader who has not read it.

Purpose:
- The reader wants to know what this document is and what it does, in under thirty seconds.
- Strip the author's voice. Two documents that do the same thing must read the same way here, however differently they were written.

Voice:
- Plain, concrete, matter of fact. Sixth-form reading level.
- State what the document says as fact. Never write "the document says", "according to", "this appears to", or "it seems".
- Never praise, criticise, or characterise anyone's conduct.
- No markdown headings, no preamble, no closing summary.

Shape:
- One short lead sentence saying what the document is.
- Then 3 to 6 bullets, one line each, starting with "- ".
- Minutes: what was decided, what was voted on and the outcome, what was deferred. Attendance is not a bullet.
- Agendas: when and where the meeting is, and the substantive items scheduled for it -- bills to be read, guests, expected votes, who is reporting on what.
- Bills and resolutions: what it would change, who introduced it, and any amount of money.
- Governing documents: what body it governs and the rules a reader is most likely to need.
- Leave out standing procedural items (calling to order, approving the agenda, adjourning).

Citations:
- Every bullet that states a fact ends with one or more markers like [1] or [1][2].
- The number is the 1-based index of the supporting quote in the "citations" array.
- Every citation must be used at least once, and every marker must have a citation.
- Each "quote" is copied EXACTLY, character for character, from the document. Do not paraphrase, tidy, shorten with ellipses, or fix typos.
- Quote a full sentence or clause, not a few words.

Grounding:
- Use only this document. Never use outside knowledge.
- Set "insufficientContent" to true, and leave "content" empty, only when the document is an unfilled template (placeholder text such as "XXX", "Senator #1", or a blank date) or a stub with no real content. A short but genuine document still gets a summary.

Reply with a single JSON object and nothing else:
{"content": string, "insufficientContent": boolean, "citations": [{"quote": string}]}`;

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
 * documents that have not changed.
 */
function promptFingerprint(contentHash: string, kind: string): string {
    return createHash("sha256")
        .update(PROMPT_VERSION)
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
            system: SYSTEM_PROMPT,
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
            NOT: { content: "" },
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
