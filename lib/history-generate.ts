import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";

import { historyTopic, type HistoryTopicDefinition } from "@/config/history";
import { generateJson, isAiQuotaExhausted } from "@/lib/ai";
import { findQuote } from "@/lib/anchor";
import { isBillVotingRecord, readBillVotingRecords, type BillVoteRecord } from "@/lib/bill-votes";
import { assignCitationOrdinals, citedIndexes, remapCitedContent } from "@/lib/cite";
import { formatDate } from "@/lib/dates";
import {
    academicYearKey,
    clampWeight,
    eventKind,
    eventSpan,
    legislationOutcome,
    parseFindingItem,
    resolveFindingDate,
    topicExcerpt,
    topicPatterns,
    type HistoryFindingItem,
    type TopicPatterns,
} from "@/lib/history";
import { documentKindLabel } from "@/lib/kinds";
import { prisma } from "@/lib/prisma";

/**
 * Computing a topic's timeline from the archive.
 *
 * Two passes, each cached so a re-run pays only for what changed:
 *
 *   1. Extraction. Each candidate document is read on its own and asked what
 *      it records about the topic. Every finding carries a quote that must be
 *      found verbatim in the document, or it is dropped. Cached per document
 *      against its contentHash in HistoryFinding.
 *   2. Merging. The findings of one academic year are grouped into events --
 *      an agenda, the minutes, the bill, and a News-Letter article about the
 *      same vote become one point. The model only groups and writes; quotes
 *      come from the verified findings, and whether legislation passed is
 *      decided in code from the voting register and Senate minutes.
 *
 * Nothing here runs on a page view. See scripts/history.ts.
 */

/** Bumped when either prompt changes, so cached findings and events are redone. */
const PROMPT_VERSION = "history-v2";

const EXTRACT_CONCURRENCY = 6;
/** Findings per merge call; a busier year is split in date order. */
const MERGE_CHUNK = 140;

type CandidateDocument = {
    id: string;
    title: string;
    displayTitle: string;
    kind: string;
    discoveredVia: string;
    driveFileId: string;
    content: string;
    contentHash: string;
    datedAt: Date | null;
    driveCreatedTime: Date | null;
    sessionNumber: number | null;
};

export type HistoryRunOptions = {
    /** Re-extract and re-merge even where the cache is current. */
    force?: boolean;
    /** Only extract this many uncached documents, for a trial run. */
    limit?: number;
    /** List candidates and excerpt sizes; no model calls, no writes. */
    dryRun?: boolean;
    /** Stop after extraction. */
    extractOnly?: boolean;
    log?: (line: string) => void;
};

export type HistoryRunResult = {
    slug: string;
    candidates: number;
    extracted: number;
    extractFailures: number;
    findings: number;
    batchesMerged: number;
    batchesKept: number;
    mergeFailures: number;
    events: number;
    excerptChars: number;
};

// ---------------------------------------------------------------------------
// Candidates
// ---------------------------------------------------------------------------

async function candidateDocuments(topic: HistoryTopicDefinition, patterns: TopicPatterns): Promise<CandidateDocument[]> {
    const rows = await prisma.$queryRawUnsafe<{ id: string }[]>(
        `select id from "Document"
          where content <> ''
            and not (kind = any($3::text[]))
            and (content ~* $1 or ($2::text is not null and content ~ $2::text))`,
        patterns.postgres.insensitive,
        patterns.postgres.sensitive,
        topic.excludeKinds,
    );
    if (rows.length === 0) return [];

    return prisma.document.findMany({
        where: { id: { in: rows.map((row) => row.id) } },
        select: {
            id: true,
            title: true,
            displayTitle: true,
            kind: true,
            discoveredVia: true,
            driveFileId: true,
            content: true,
            contentHash: true,
            datedAt: true,
            driveCreatedTime: true,
            sessionNumber: true,
        },
        orderBy: { id: "asc" },
    });
}

function topicFingerprint(topic: HistoryTopicDefinition): string {
    return createHash("sha256")
        .update(PROMPT_VERSION)
        .update(JSON.stringify(topic))
        .digest("hex");
}

function findingHash(topicHash: string, document: CandidateDocument): string {
    return createHash("sha256").update(topicHash).update(JSON.stringify(document)).digest("hex");
}

// ---------------------------------------------------------------------------
// Pass 1: extraction
// ---------------------------------------------------------------------------

const KIND_GUIDE = `- legislation: an SGA bill or resolution being introduced, read, debated, or voted on.
- funding: money the SGA allocated, requested, or budgeted.
- programming: an event, campaign, training, or workshop the SGA ran or co-sponsored.
- statement: a letter, statement, or public position of the SGA or its officers.
- discussion: the topic raised at an SGA meeting -- a presentation, an officer's report, a guest, a debate.
- policy: a change to a university or SGA policy, office, or process.
- report: a survey, report, or release of data.`;

function extractionSystemPrompt(topic: HistoryTopicDefinition): string {
    const threads = topic.threads.map((thread) => `- ${thread.id}: ${thread.description}`).join("\n");
    return `You read one document from the archive of the Johns Hopkins University Student Government Association (SGA) and list what it records about one topic, for a public timeline.

Topic: ${topic.title}
Scope: ${topic.scope}

Threads (choose the best fit):
${threads}

Kinds:
${KIND_GUIDE}

Rules:
- One finding per distinct thing that happened. Several mentions of the same thing in this document are one finding.
- Only what this document records. No outside knowledge, and nothing about motives or effects the text does not state.
- A development outside the SGA belongs only when this document ties it to the SGA; mark its involvement "context". Otherwise "sga".
- Skip mentions where nothing happened: a committee name in a list, a template, a hotline number in a footer, a résumé line.
- Never name or identify a survivor, complainant, or accused person, or describe the details of an individual case. Name SGA bodies and offices rather than individual students. If no quote for a finding can avoid identifying such a person, leave the finding out.

Fields:
- "summary": one neutral sentence in the past tense, under 30 words, saying who did what.
- "quote": copied EXACTLY, character for character, from the document: a full sentence or clause showing the finding. Never join separate passages or fix typos.
- "date": when this happened, if the text states it, as YYYY-MM-DD, YYYY-MM, or YYYY. null when the text gives no date for it.
- "thread": a thread id from the list.
- "kind": a kind from the list.
- "involvement": "sga" or "context".
- "outcome": for legislation only, "passed" or "not_passed" when this document records the full Senate's vote result; otherwise "". A committee recommendation, a reading, or a scheduled vote is "".
- "weight": 3 for a landmark (legislation adopted; a new office, program, or policy; a major report), 2 for a concrete action, 1 for a discussion or brief mention.

Reply with a single JSON object and nothing else:
{"findings": [{"summary": string, "quote": string, "date": string | null, "thread": string, "kind": string, "involvement": string, "outcome": string, "weight": number}]}
An empty list when the document records nothing on the topic.`;
}

function extractionUserPrompt(document: CandidateDocument, excerpt: string): string {
    const title = (document.displayTitle || document.title).replace(/"/g, "'");
    const source =
        document.discoveredVia === "newsletter"
            ? "Article in The Johns Hopkins News-Letter (secondary reporting)"
            : "SGA record";
    const dated = formatDate(document.datedAt) ?? "undated";
    const partial = excerpt.length < document.content.length ? ' excerpted="true"' : "";
    return `<document title="${title}" kind="${documentKindLabel(document.kind)}" source="${source}" date="${dated}"${partial}>
${excerpt}
</document>`;
}

async function extractDocument(
    topic: HistoryTopicDefinition,
    patterns: TopicPatterns,
    document: CandidateDocument,
): Promise<{ status: "found" | "none" | "failed"; findings: HistoryFindingItem[]; model: string; error?: string; rejected: number }> {
    const excerpt = topicExcerpt(document.content, patterns);
    let raw: { findings?: unknown[] };
    let model = "";
    try {
        const generated = await generateJson<{ findings?: unknown[] }>({
            system: extractionSystemPrompt(topic),
            user: extractionUserPrompt(document, excerpt),
            maxTokens: 6_000,
        });
        raw = generated.value;
        model = generated.model;
        if (!raw || !Array.isArray(raw.findings)) throw new Error("Extraction response must contain a findings array");
    } catch (cause) {
        return { status: "failed", findings: [], model, error: cause instanceof Error ? cause.message : String(cause), rejected: 0 };
    }

    const threadIds = topic.threads.map((thread) => thread.id);
    const findings: HistoryFindingItem[] = [];
    let rejected = 0;
    for (const item of Array.isArray(raw.findings) ? raw.findings : []) {
        const parsed = parseFindingItem(item, threadIds);
        if (!parsed || !findQuote(document.content, parsed.quote)) {
            rejected += 1;
            continue;
        }
        findings.push(parsed);
    }
    if (rejected) return { status: "failed", findings: [], model, rejected, error: `${rejected} invalid or unanchored finding(s)` };
    return { status: findings.length > 0 ? "found" : "none", findings, model, rejected };
}

async function pool<T>(items: T[], size: number, work: (item: T) => Promise<boolean>): Promise<void> {
    let next = 0;
    let stop = false;
    await Promise.all(
        Array.from({ length: Math.min(size, items.length) }, async () => {
            while (!stop && next < items.length) {
                const item = items[next++]!;
                if (!(await work(item))) stop = true;
            }
        }),
    );
}

// ---------------------------------------------------------------------------
// Pass 2: merging
// ---------------------------------------------------------------------------

type PlacedFinding = HistoryFindingItem & {
    /** Stable within a run: "<documentId>:<index>". */
    key: string;
    document: CandidateDocument;
    date: Date | null;
    precision: ReturnType<typeof resolveFindingDate>["precision"];
};

type MergedEvent = {
    findings: PlacedFinding[];
    title: string;
    content: string;
    thread: string;
    kind: HistoryFindingItem["kind"];
    involvement: "sga" | "context";
    weight: 1 | 2 | 3;
};

function mergeSystemPrompt(topic: HistoryTopicDefinition): string {
    const threads = topic.threads.map((thread) => `- ${thread.id}: ${thread.label}`).join("\n");
    return `You assemble a public timeline of the Johns Hopkins University SGA's efforts on one topic: ${topic.title}.

You are given findings, each read from one document, with an id, a date, the document, a thread, a kind, and a one-sentence summary. Several findings often describe the same event from different documents -- the agenda, the minutes, the bill itself, a News-Letter article. Group them into events.

Rules:
- An event is one thing that happened: one piece of legislation from introduction to vote, one program, one statement, one presentation. Do not bundle unrelated things because they share a month.
- Every finding belongs to exactly one event. Leave a finding out only if it is plainly off-topic.
- "title": under 12 words, sentence case, no final period, naming what happened. Never say whether legislation passed or failed; that is shown separately from the record.
- "content": one to three short, neutral sentences using only what the summaries say. End each sentence with markers like [1] or [1][2] giving the 1-based position of supporting findings in this event's "findings" list. Never state whether legislation passed or failed. Never name or identify a survivor, complainant, or accused person.
- "thread": one of
${threads}
- "kind": one of legislation, funding, programming, statement, discussion, policy, report.
- "involvement": "sga" if the SGA acted, "context" otherwise.
- "weight": 3 for a landmark, 2 for a concrete action, 1 for a discussion or brief mention.

Reply with a single JSON object and nothing else:
{"events": [{"findings": [string], "title": string, "content": string, "thread": string, "kind": string, "involvement": string, "weight": number}]}`;
}

function mergeUserPrompt(findings: PlacedFinding[]): string {
    return findings
        .map((finding, index) =>
            JSON.stringify({
                id: `f${index + 1}`,
                date: finding.date ? finding.date.toISOString().slice(0, 10) : null,
                datePrecision: finding.precision,
                document: `${finding.document.displayTitle || finding.document.title} (${documentKindLabel(finding.document.kind)})`,
                thread: finding.thread,
                kind: finding.kind,
                involvement: finding.involvement,
                summary: finding.summary,
            }),
        )
        .join("\n");
}

async function mergeChunk(
    topic: HistoryTopicDefinition,
    findings: PlacedFinding[],
): Promise<{ events: MergedEvent[]; model: string }> {
    let feedback = "";
    for (let attempt = 0; attempt < 3; attempt += 1) {
        const generated = await generateJson<{ events?: unknown[] }>({
            system: mergeSystemPrompt(topic),
            user: mergeUserPrompt(findings) + feedback,
            maxTokens: 16_000,
        });
        try {
            return { events: validateMergedEvents(topic, findings, generated.value), model: generated.model };
        } catch (error) {
            if (attempt === 2) throw error;
            feedback = `\n\nYour previous response failed validation: ${error instanceof Error ? error.message : String(error)}. ` +
                "Return a corrected complete response. Copy only the supplied f-number IDs; each ID may appear once across all events. " +
                "Every event needs a title and prose with [n] citations numbered from 1 within that event's findings list. " +
                "Do not use the global f-number as the citation number.\nPrevious response:\n" + JSON.stringify(generated.value);
        }
    }
    throw new Error("Merge attempts exhausted");
}

function validateMergedEvents(topic: HistoryTopicDefinition, findings: PlacedFinding[], response: { events?: unknown[] }): MergedEvent[] {
    const byKey = new Map(findings.map((finding, index) => [`f${index + 1}`, finding]));
    const used = new Set<string>();
    const threadIds = topic.threads.map((thread) => thread.id);
    const events: MergedEvent[] = [];
    if (!response || !Array.isArray(response.events)) {
        throw new Error("Merge response must contain an events array");
    }

    for (const raw of response.events) {
        if (!raw || typeof raw !== "object") throw new Error("Invalid merged event");
        const value = raw as Record<string, unknown>;
        const keys = value.findings;
        if (!Array.isArray(keys) || !keys.length || new Set(keys).size !== keys.length ||
            keys.some((key) => typeof key !== "string" || !byKey.has(key) || used.has(key))) {
            throw new Error("Merged event contains missing, unknown, or repeated finding IDs");
        }
        const members = keys.map((key: string) => byKey.get(key)!);
        const title = typeof value.title === "string" ? value.title.trim().replace(/\.$/, "") : "";
        const content = typeof value.content === "string" ? value.content.trim() : "";
        const citations = citedIndexes(content);
        if (!title || !content || !citations.length || citations.some((index) => index < 1 || index > members.length)) {
            throw new Error("Merged event needs a title, prose, and valid citation markers");
        }
        for (const key of keys) used.add(key);

        const thread = typeof value.thread === "string" && threadIds.includes(value.thread) ? value.thread : members[0]!.thread;
        events.push({
            findings: members,
            title,
            content,
            thread,
            kind: eventKind(value.kind, members[0]!.kind),
            involvement: value.involvement === "context" ? "context" : "sga",
            weight: clampWeight(value.weight),
        });
    }

    return events;
}

function chunkKey(year: string, index: number, count: number): string {
    return count === 1 ? year : `${year}#${index + 1}`;
}

function batchHash(topicHash: string, findings: PlacedFinding[], records: BillVoteRecord[]): string {
    return createHash("sha256").update("merge-v2").update(topicHash).update(JSON.stringify([findings, records])).digest("hex");
}

async function votingRecords(): Promise<BillVoteRecord[]> {
    const documents = await prisma.document.findMany({
        where: { title: { contains: "voting record", mode: "insensitive" } },
        select: { title: true, content: true },
    });
    return documents.filter((document) => isBillVotingRecord(document.title)).flatMap((document) => readBillVotingRecords(document.content));
}

async function writeBatch(
    tx: Prisma.TransactionClient,
    topicId: string,
    key: string,
    hash: string,
    events: MergedEvent[],
    records: BillVoteRecord[],
): Promise<number> {
    let written = 0;
    await tx.historyEvent.deleteMany({ where: { topicId, batchKey: key } });

    for (const event of events) {
        const { kept, remap } = assignCitationOrdinals(event.findings, (finding) =>
            findQuote(finding.document.content, finding.quote) ? `${finding.document.id}\0${finding.quote}` : null,
        );
        if (kept.length === 0) continue;

        const span = eventSpan(event.findings);
        const outcome = legislationOutcome(
            event.kind,
            event.findings.map((finding) => ({
                kind: finding.document.kind,
                driveFileId: finding.document.driveFileId,
                title: finding.document.title,
                displayTitle: finding.document.displayTitle,
                outcomeClaim: finding.outcomeClaim,
            })),
            records,
        );

        const row = await tx.historyEvent.create({
            data: {
                topicId,
                batchKey: key,
                batchHash: hash,
                occurredAt: span.occurredAt,
                endedAt: span.endedAt,
                datePrecision: span.precision,
                title: event.title,
                content: remapCitedContent(event.content, remap),
                thread: event.thread,
                kind: event.kind,
                involvement: event.involvement,
                outcome,
                weight: event.weight,
            },
        });

        for (const [ordinal, finding] of kept.entries()) {
            const anchor = findQuote(finding.document.content, finding.quote);
            const annotation =
                (await tx.documentAnnotation.findFirst({
                    where: { documentId: finding.document.id, content: finding.quote },
                })) ??
                (await tx.documentAnnotation.create({
                    data: {
                        documentId: finding.document.id,
                        content: finding.quote,
                        startOffset: anchor?.startOffset ?? null,
                        endOffset: anchor?.endOffset ?? null,
                    },
                }));
            await tx.historyEventCitation.create({ data: { eventId: row.id, annotationId: annotation.id, ordinal } });
        }
        written += 1;
    }
    return written;
}

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

export async function generateHistoryTopic(slug: string, options: HistoryRunOptions = {}): Promise<HistoryRunResult> {
    const topic = historyTopic(slug);
    if (!topic) throw new Error(`Unknown history topic "${slug}"`);
    const log = options.log ?? (() => {});
    const patterns = topicPatterns(topic);
    const documents = await candidateDocuments(topic, patterns);
    const topicHash = topicFingerprint(topic);

    const result: HistoryRunResult = {
        slug,
        candidates: documents.length,
        extracted: 0,
        extractFailures: 0,
        findings: 0,
        batchesMerged: 0,
        batchesKept: 0,
        mergeFailures: 0,
        events: 0,
        excerptChars: 0,
    };

    if (options.dryRun) {
        for (const document of documents) {
            const excerpt = topicExcerpt(document.content, patterns);
            result.excerptChars += excerpt.length;
            log(`${document.kind.padEnd(24)} ${String(excerpt.length).padStart(6)}  ${document.displayTitle || document.title}`);
        }
        return result;
    }

    const topicRow = await prisma.historyTopic.upsert({ where: { slug }, create: { slug }, update: {} });
    result.events = await prisma.historyEvent.count({ where: { topicId: topicRow.id } });
    const cached = new Map(
        (await prisma.historyFinding.findMany({ where: { topicId: topicRow.id } })).map((row) => [row.documentId, row]),
    );

    // Pass 1.
    const pending = documents.filter((document) => {
        const row = cached.get(document.id);
        return options.force || !row || row.status === "failed" || row.promptHash !== findingHash(topicHash, document);
    });
    const toExtract = options.limit === undefined ? pending : pending.slice(0, options.limit);
    log(`${documents.length} candidate documents, ${pending.length} need extraction, extracting ${toExtract.length}`);

    let lastModel = "";
    let quotaError = "";
    await pool(toExtract, EXTRACT_CONCURRENCY, async (document) => {
        const outcome = await extractDocument(topic, patterns, document);
        if (outcome.model) lastModel = outcome.model;
        const row = await prisma.historyFinding.upsert({
            where: { topicId_documentId: { topicId: topicRow.id, documentId: document.id } },
            create: {
                topicId: topicRow.id,
                documentId: document.id,
                promptHash: findingHash(topicHash, document),
                status: outcome.status,
                findings: outcome.findings,
                model: outcome.model,
                error: outcome.error ?? null,
            },
            update: {
                promptHash: findingHash(topicHash, document),
                status: outcome.status,
                findings: outcome.findings,
                model: outcome.model,
                error: outcome.error ?? null,
                checkedAt: new Date(),
            },
        });
        cached.set(document.id, row);
        result.extracted += 1;
        if (outcome.status === "failed") result.extractFailures += 1;
        log(
            `[${result.extracted}/${toExtract.length}] ${outcome.status.padEnd(6)} ${outcome.findings.length} kept, ${outcome.rejected} rejected  ${document.displayTitle || document.title}${outcome.error ? `  (${outcome.error.slice(0, 160)})` : ""}`,
        );
        if (isAiQuotaExhausted(outcome.error)) {
            quotaError = outcome.error!;
            return false;
        }
        return true;
    });

    const incomplete = pending.length > result.extracted;
    const extractionError = [
        quotaError,
        ...(result.extractFailures ? [`${result.extractFailures} document(s) failed extraction`] : []),
        ...(incomplete ? [`${pending.length - result.extracted} document(s) not yet extracted`] : []),
    ].filter(Boolean).join("\n");
    // A sample can establish an initial timeline, but must never replace a
    // published timeline with an incomplete subset. Failed extraction never
    // publishes, even on the first run. Successful caches remain resumable.
    if (extractionError || options.extractOnly) {
        await prisma.historyTopic.update({
            where: { id: topicRow.id },
            data: { status: result.events ? "stale" : extractionError ? "failed" : "empty", error: extractionError || null },
        });
    }
    if (quotaError || result.extractFailures || (incomplete && result.events > 0)) {
        log("Kept the published timeline; rerun without --limit to finish extraction.");
        return result;
    }
    if (options.extractOnly) return result;

    // Only findings that are current for their document's text are merged;
    // a document whose extraction is still pending is left out, not guessed at.
    const placed: PlacedFinding[] = [];
    for (const document of documents) {
        const row = cached.get(document.id);
        if (!row || row.status !== "found" || row.promptHash !== findingHash(topicHash, document)) continue;
        (row.findings as HistoryFindingItem[]).forEach((finding, index) => {
            const { date, precision } = resolveFindingDate(finding.statedDate, document);
            placed.push({ ...finding, key: `${document.id}:${index}`, document, date, precision });
        });
    }
    result.findings = placed.length;

    // Pass 2, per academic year.
    const byYear = new Map<string, PlacedFinding[]>();
    for (const finding of placed) {
        const key = academicYearKey(finding.date);
        byYear.set(key, [...(byYear.get(key) ?? []), finding]);
    }

    const existing = await prisma.historyEvent.findMany({
        where: { topicId: topicRow.id },
        select: { batchKey: true, batchHash: true },
        distinct: ["batchKey"],
    });
    const existingHash = new Map(existing.map((row) => [row.batchKey, row.batchHash]));
    const liveKeys = new Set<string>();
    const records = await votingRecords();
    const failures: string[] = [];
    const staged: { key: string; hash: string; events: MergedEvent[] }[] = [];

    mergeYears:
    for (const [year, findings] of [...byYear.entries()].sort(([a], [b]) => a.localeCompare(b))) {
        findings.sort((a, b) => (a.date?.getTime() ?? 0) - (b.date?.getTime() ?? 0) || a.key.localeCompare(b.key));
        const count = Math.ceil(findings.length / MERGE_CHUNK);
        for (let index = 0; index < count; index += 1) {
            const chunk = findings.slice(index * MERGE_CHUNK, (index + 1) * MERGE_CHUNK);
            const key = chunkKey(year, index, count);
            const hash = batchHash(topicHash, chunk, records);
            liveKeys.add(key);

            if (!options.force && existingHash.get(key) === hash) {
                result.batchesKept += 1;
                continue;
            }
            try {
                const { events, model } = await mergeChunk(topic, chunk);
                lastModel = model;
                staged.push({ key, hash, events });
                log(`prepared ${key}: ${chunk.length} findings into ${events.length} events`);
            } catch (cause) {
                const message = cause instanceof Error ? cause.message : String(cause);
                result.mergeFailures += 1;
                failures.push(`${key}: ${message}`);
                log(`merge failed ${key}: ${message.slice(0, 200)}`);
                if (isAiQuotaExhausted(message)) break mergeYears;
            }
        }
    }

    if (failures.length) {
        await prisma.historyTopic.update({
            where: { id: topicRow.id },
            data: { status: result.events ? "stale" : "failed", error: failures.join("\n") },
        });
        return result;
    }

    // No model calls in the transaction. Publish replacements, removals, and
    // status together, so a failed merge or citation write cannot erase history.
    result.events = await prisma.$transaction(async (tx) => {
        for (const batch of staged) {
            await writeBatch(tx, topicRow.id, batch.key, batch.hash, batch.events, records);
        }
        await tx.historyEvent.deleteMany({ where: { topicId: topicRow.id, batchKey: { notIn: [...liveKeys] } } });
        const count = await tx.historyEvent.count({ where: { topicId: topicRow.id } });
        await tx.historyTopic.update({
            where: { id: topicRow.id },
            data: {
                status: extractionError ? "stale" : count === 0 ? "empty" : "fresh",
                model: lastModel || topicRow.model,
                error: extractionError || null,
                generatedAt: new Date(),
            },
        });
        return count;
    }, { timeout: 120_000 });
    result.batchesMerged = staged.length;
    return result;
}
