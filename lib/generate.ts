import { createHash } from "node:crypto";

import { SESSION_NUMBER } from "@/config/sga";
import { generateJson } from "@/lib/ai";
import { findQuote } from "@/lib/anchor";
import { prisma } from "@/lib/prisma";
import { sectionDefinition, type SectionStatus } from "@/lib/sections";

/**
 * Turning source documents into cached, cited prose.
 *
 * The invariant this module exists to enforce: nothing reaches the site unless
 * every supporting quote was found verbatim in a stored document. A model that
 * paraphrases a quote, cites the wrong document, or invents a passage produces
 * a rejected citation, and a section with no surviving citations is never
 * published.
 */

/** Per-document and overall prompt budget, in characters. */
const MAX_CHARS_PER_DOCUMENT = 60_000;
const MAX_TOTAL_CHARS = 240_000;

/**
 * Bumped when the system prompt or citation format changes, so cached
 * sections regenerate instead of serving the old prose.
 */
const PROMPT_VERSION = "inline-cite-bullets-v1";

const SYSTEM_PROMPT = `You write the public description of the Johns Hopkins University Student Government Association from its governing documents.

Voice:
- Matter of fact. State what the documents say as fact. Do not hedge, do not write "the documents say", "according to", "it appears", or "the SGA may".
- Extremely easy to read. Almost entirely bullet points. At most one short lead sentence; never more than one short paragraph besides the list.
- No markdown headings. No preamble. No closing summary.

Citations:
- Every bullet that states a fact must end with one or more footnote markers like [1] or [1][2].
- The number is the 1-based index of that supporting quote in the "citations" array.
- Every citation must be used at least once. Do not invent markers that have no citation.
- Each citation's "quote" is copied EXACTLY, character for character, from the named document. Do not paraphrase, tidy, shorten with ellipses, or fix typos inside a quote.
- Quote a full sentence or clause, not a few words.

Grounding:
- Use only the supplied documents. Never use outside knowledge.
- If the documents conflict, prefer the constitution over bylaws and state the conflict as a fact.
- If they do not answer the question, set "insufficientEvidence" to true and leave "content" empty.

Reply with a single JSON object and nothing else:
{"content": string, "insufficientEvidence": boolean, "citations": [{"documentId": string, "quote": string}]}`;

type ModelResponse = {
    content?: string;
    insufficientEvidence?: boolean;
    citations?: { documentId?: string; quote?: string }[];
};

export type GenerateSectionResult = {
    key: string;
    status: SectionStatus;
    skipped: boolean;
    citationsVerified: number;
    citationsRejected: number;
    error?: string;
};

type SourceDocument = {
    id: string;
    title: string;
    kind: string;
    content: string;
    contentHash: string;
};

/**
 * Fingerprint of everything that affects the output, so an unchanged section
 * is not regenerated (and re-billed) on every run.
 */
function promptFingerprint(question: string, documents: SourceDocument[]): string {
    const hash = createHash("sha256").update(PROMPT_VERSION).update(question);
    for (const document of documents) {
        hash.update(`\u0000${document.id}:${document.contentHash}`);
    }
    return hash.digest("hex");
}

function buildUserPrompt(question: string, documents: SourceDocument[]): string {
    // Share the budget evenly, but let short documents hand their unused
    // allowance to long ones rather than truncating the constitution to fit.
    let remaining = MAX_TOTAL_CHARS;
    const blocks: string[] = [];

    const ordered = [...documents].sort(
        (a, b) => a.content.length - b.content.length,
    );

    ordered.forEach((document, index) => {
        const share = Math.max(
            Math.floor(remaining / (ordered.length - index)),
            0,
        );
        const limit = Math.min(share, MAX_CHARS_PER_DOCUMENT);
        const body = document.content.slice(0, limit);
        remaining -= body.length;

        blocks.push(
            [
                `<document id="${document.id}" kind="${document.kind}" title="${document.title.replace(/"/g, "'")}">`,
                body,
                body.length < document.content.length ? "\n[document truncated]" : "",
                "</document>",
            ].join("\n"),
        );
    });

    return `${blocks.join("\n\n")}\n\nQuestion: ${question}`;
}

/**
 * Generate one section, verify its citations, and cache the result.
 *
 * Passing `force` regenerates even when the fingerprint is unchanged.
 */
/**
 * The documents eligible to source a section.
 *
 * Restricted to the current session: the archive exists to be compared
 * against, never to be summarised as though it were in force. A clause
 * repealed in the 112th must not end up described as current law.
 */
export async function sourceDocumentsFor(
    sourceKinds: readonly string[],
): Promise<SourceDocument[]> {
    return prisma.document.findMany({
        where: {
            kind: { in: [...sourceKinds] },
            NOT: { content: "" },
            sessionNumber: SESSION_NUMBER,
        },
        select: {
            id: true,
            title: true,
            kind: true,
            content: true,
            contentHash: true,
        },
        orderBy: { title: "asc" },
    });
}

export async function generateSection(
    key: string,
    options: { force?: boolean } = {},
): Promise<GenerateSectionResult> {
    const definition = sectionDefinition(key);
    if (!definition) {
        throw new Error(`Unknown section key "${key}"`);
    }

    const documents = await sourceDocumentsFor(definition.sourceKinds);

    if (documents.length === 0) {
        const message = `No current-session (${SESSION_NUMBER}th) source documents have been synced yet`;
        await prisma.generatedSection.upsert({
            where: { key },
            create: { key, status: "empty", error: message },
            update: { status: "empty", error: message },
        });
        return {
            key,
            status: "empty",
            skipped: false,
            citationsVerified: 0,
            citationsRejected: 0,
            error: message,
        };
    }

    const fingerprint = promptFingerprint(definition.question, documents);
    const existing = await prisma.generatedSection.findUnique({ where: { key } });

    if (
        !options.force &&
        existing?.status === "fresh" &&
        existing.promptHash === fingerprint
    ) {
        return {
            key,
            status: "fresh",
            skipped: true,
            citationsVerified: await prisma.citation.count({
                where: { sectionId: existing.id },
            }),
            citationsRejected: 0,
        };
    }

    let response: ModelResponse;
    let model: string;
    try {
        const generated = await generateJson<ModelResponse>({
            system: SYSTEM_PROMPT,
            user: buildUserPrompt(definition.question, documents),
        });
        response = generated.value;
        model = generated.model;
    } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause);
        // Leave any previously good content in place; only record the failure.
        await prisma.generatedSection.upsert({
            where: { key },
            create: { key, status: "failed", error: message },
            update: { status: "failed", error: message },
        });
        return {
            key,
            status: "failed",
            skipped: false,
            citationsVerified: 0,
            citationsRejected: 0,
            error: message,
        };
    }

    const documentsById = new Map(documents.map((doc) => [doc.id, doc]));

    // The verification gate.
    const verified: { documentId: string; quote: string }[] = [];
    let rejected = 0;

    for (const citation of response.citations ?? []) {
        const documentId = citation.documentId?.trim();
        const quote = citation.quote;
        if (!documentId || !quote) {
            rejected += 1;
            continue;
        }

        const document = documentsById.get(documentId);
        if (!document || !findQuote(document.content, quote)) {
            rejected += 1;
            continue;
        }

        // Collapse duplicate quotes onto one chip.
        if (verified.some((item) => item.documentId === documentId && item.quote === quote)) {
            continue;
        }
        verified.push({ documentId, quote });
    }

    const content = (response.content ?? "").trim();

    if (response.insufficientEvidence || !content) {
        await prisma.generatedSection.upsert({
            where: { key },
            create: {
                key,
                status: "empty",
                model,
                promptHash: fingerprint,
                error: "Source documents do not answer this question",
            },
            update: {
                status: "empty",
                model,
                promptHash: fingerprint,
                error: "Source documents do not answer this question",
            },
        });
        return {
            key,
            status: "empty",
            skipped: false,
            citationsVerified: 0,
            citationsRejected: rejected,
        };
    }

    if (verified.length === 0) {
        const message = `Model returned ${rejected} citation(s), none of which could be verified against the source documents`;
        await prisma.generatedSection.upsert({
            where: { key },
            create: { key, status: "failed", model, error: message },
            update: { status: "failed", model, error: message },
        });
        return {
            key,
            status: "failed",
            skipped: false,
            citationsVerified: 0,
            citationsRejected: rejected,
            error: message,
        };
    }

    await prisma.$transaction(async (tx) => {
        const section = await tx.generatedSection.upsert({
            where: { key },
            create: {
                key,
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

        // Citations are rebuilt wholesale; orphaned annotations are left in
        // place because another section may still cite the same passage.
        await tx.citation.deleteMany({ where: { sectionId: section.id } });

        for (const [ordinal, item] of verified.entries()) {
            const anchor = findQuote(
                documentsById.get(item.documentId)!.content,
                item.quote,
            );

            const annotation =
                (await tx.documentAnnotation.findFirst({
                    where: { documentId: item.documentId, content: item.quote },
                })) ??
                (await tx.documentAnnotation.create({
                    data: {
                        documentId: item.documentId,
                        content: item.quote,
                        startOffset: anchor?.startOffset ?? null,
                        endOffset: anchor?.endOffset ?? null,
                    },
                }));

            await tx.citation.create({
                data: {
                    sectionId: section.id,
                    annotationId: annotation.id,
                    ordinal,
                },
            });
        }
    });

    return {
        key,
        status: "fresh",
        skipped: false,
        citationsVerified: verified.length,
        citationsRejected: rejected,
    };
}

/** Regenerate every section that is stale, failed, or never generated. */
export async function generateStaleSections(
    options: { force?: boolean } = {},
): Promise<GenerateSectionResult[]> {
    const { SECTION_KEYS } = await import("@/lib/sections");
    const results: GenerateSectionResult[] = [];

    for (const key of SECTION_KEYS) {
        try {
            results.push(await generateSection(key, options));
        } catch (cause) {
            results.push({
                key,
                status: "failed",
                skipped: false,
                citationsVerified: 0,
                citationsRejected: 0,
                error: cause instanceof Error ? cause.message : String(cause),
            });
        }
    }

    return results;
}
