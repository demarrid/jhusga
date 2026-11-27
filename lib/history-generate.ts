import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";

import { historyTopic, REVIEWED_FINDINGS, type HistoryTopicDefinition } from "@/config/history";
import { HISTORY_DOCUMENT_DATES, reviewedFindingDate } from "@/config/history-dates";
import { generateJson, isAiQuotaExhausted } from "@/lib/ai";
import { findQuote } from "@/lib/anchor";
import { isBillVotingRecord, readBillVotingRecords, type BillVoteRecord } from "@/lib/bill-votes";
import { assignCitationOrdinals, citedIndexes, remapCitedContent } from "@/lib/cite";
import { nameKey } from "@/lib/contributors";
import { formatDate } from "@/lib/dates";
import { diffLines } from "@/lib/diff";
import { extractDocumentLinks } from "@/lib/links";
import { buildSessionDirectory, isEmptySeat, type DirectoryMember } from "@/lib/directory";
import {
    academicYearKey,
    clampWeight,
    eventKind,
    eventSpan,
    historyLabel,
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
    /**
     * For an edition of the SGA's constitution or bylaws, what changed from the
     * edition before it, so extraction records the changes rather than the
     * contents. Absent otherwise, which keeps other documents' cache keys.
     */
    priorEdition?: PriorEdition;
    /**
     * For a bill with a current/proposed-language table, the changes it
     * proposes, row by row, so extraction lists them instead of restating the
     * bill's boilerplate purposes. Absent otherwise.
     */
    amendments?: string;
};

type PriorEdition = { id: string; title: string; datedAt: string; changes: string };

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

    const documents: CandidateDocument[] = await prisma.document.findMany({
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
    const priors = await priorEditions(documents);
    const amended = await billAmendments(documents);
    return documents.map((document) => {
        let result = document;
        if (priors.has(document.id)) result = { ...result, priorEdition: priors.get(document.id)! };
        if (amended.has(document.id)) result = { ...result, amendments: amended.get(document.id)! };
        return result;
    });
}

/** A row of a markdown table, split into trimmed cells; null for other lines. */
function tableCells(line: string): string[] | null {
    const trimmed = line.trim();
    if (!trimmed.startsWith("|")) return null;
    return trimmed.replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim());
}

const CURRENT_PROPOSED = /^current(?: language)?$/i;
const PROPOSED = /^proposed(?: language)?$/i;

export type AmendmentRow = { section: string; current: string; proposed: string };

/**
 * The rows of a bill's "Current Language | Proposed Language" tables, with
 * the section each table is headed by ("Constitution", "Bylaws").
 */
export function amendmentRows(content: string): AmendmentRow[] {
    const rows: AmendmentRow[] = [];
    let section = "";
    let inTable = false;
    for (const line of content.split("\n")) {
        const cells = tableCells(line);
        if (!cells) {
            inTable = false;
            continue;
        }
        if (cells.every((cell) => /^:?-{3,}:?$/.test(cell) || !cell)) continue;
        if (cells.length >= 2 && CURRENT_PROPOSED.test(cells[0]!.replace(/\*/g, "")) && PROPOSED.test(cells[1]!.replace(/\*/g, ""))) {
            inTable = true;
            continue;
        }
        if (!inTable) {
            // A heading row such as "| Constitution |  |" names the next table.
            if (cells[0] && cells.slice(1).every((cell) => !cell)) section = cells[0].replace(/\*/g, "").trim();
            continue;
        }
        if (cells.length >= 2 && (cells[0] || cells[1])) rows.push({ section, current: cells[0]!, proposed: cells[1]! });
    }
    return rows;
}

/** A cell's text as one sentence or numbered clause per line, for a diff. */
function cellSentences(cell: string): string {
    return cell
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/\s+(?=\d+(?:\.\d+){1,}\s)/g, "\n")
        .split("\n")
        .flatMap((part) => part.split(/(?<=[.;:])\s+(?=[A-Z*])/))
        .map((part) => part.replace(/\s+/g, " ").trim())
        .filter(Boolean)
        .join("\n");
}

const LINK_ONLY = /^\[?https?:\/\/\S+\]?(?:\(https?:\/\/\S+\))?$/;

/**
 * The Drive file a link-only cell points to. A markdown link repeats the URL
 * as its text with escaped underscores ("1e\_1ri8"), which cuts that copy's
 * ID short, so the longest ID found is the real one.
 */
function cellFileId(cell: string): string {
    return extractDocumentLinks(cell).map((link) => link.fileId).sort((left, right) => right.length - left.length)[0] ?? "";
}

/**
 * What each bill's amendment table changes, as -/+ lines for the extraction
 * prompt. A row whose cells only link to current- and proposed-language
 * documents is compared through those documents when the archive holds them,
 * and otherwise said to be unknown, so extraction does not guess.
 */
async function billAmendments(documents: CandidateDocument[]): Promise<Map<string, string>> {
    const result = new Map<string, string>();
    const bills = documents
        .filter((document) => document.kind.startsWith("bill."))
        .map((document) => ({ document, rows: amendmentRows(document.content) }))
        .filter(({ rows }) => rows.length);
    if (!bills.length) return result;
    const linkedIds = bills.flatMap(({ rows }) => rows.flatMap((row) =>
        LINK_ONLY.test(row.current) && LINK_ONLY.test(row.proposed)
            ? [...extractDocumentLinks(row.current), ...extractDocumentLinks(row.proposed)].map((link) => link.fileId)
            : []));
    const linked = new Map((linkedIds.length
        ? await prisma.document.findMany({ where: { driveFileId: { in: [...new Set(linkedIds)] } }, select: { driveFileId: true, content: true } })
        : []).map((row) => [row.driveFileId, row.content]));

    for (const { document, rows } of bills) {
        const blocks: string[] = [];
        let length = 0;
        for (const row of rows) {
            let block: string;
            if (LINK_ONLY.test(row.current) && LINK_ONLY.test(row.proposed)) {
                const before = linked.get(cellFileId(row.current));
                const after = linked.get(cellFileId(row.proposed));
                const changes = before && after ? editionChanges(before, after, true) : "";
                block = before && after
                    ? changes || (before.replace(/\s+/g, " ").trim() === after.replace(/\s+/g, " ").trim()
                        ? "[the linked current and proposed texts do not differ]"
                        : "[the linked current and proposed texts are too far apart to compare line by line, so what it changes is not known]")
                    :"[this row only links to separate current- and proposed-language documents that the archive does not hold, so what it changes is not known]";
            } else {
                const diff = diffLines(cellSentences(row.current), cellSentences(row.proposed));
                block = diff.ops
                    .filter((op) => op.type !== "equal")
                    .map((op) => op.lines.map((line) => `${op.type === "added" ? "+" : "-"} ${line}`).join("\n"))
                    .join("\n");
                if (!block) continue;
            }
            const labelled = `${row.section ? `[${row.section}]\n` : ""}${block}`;
            if (length + labelled.length > CHANGES_CHARS) {
                blocks.push("[further changes not shown]");
                break;
            }
            blocks.push(labelled);
            length += labelled.length;
        }
        if (blocks.length) result.set(document.id, blocks.join("\n\n"));
    }
    return result;
}

/** Kinds whose editions are compared with the edition before them. */
const EDITION_KINDS = ["guiding.constitution", "guiding.bylaws"];
/** The SGA's own constitution and bylaws, not a commission's, StuCo's, or another school's. */
const SGA_EDITION = /\bSGA (?:Constitution|Bylaws)\b/i;
/** Working copies and proposals are not editions anything was adopted in. */
const NOT_AN_EDITION = /\b(?:proposed|draft|tentative|revisions?|annotated)\b/i;
/** Past this share of changed lines, two documents are not editions of one text. */
const MAX_CHANGED_SHARE = 0.6;
const CHANGES_CHARS = 8_000;

export function isSgaEdition(document: { kind: string; title: string; displayTitle?: string }): boolean {
    const title = document.displayTitle || document.title;
    return EDITION_KINDS.includes(document.kind) && SGA_EDITION.test(title) && !NOT_AN_EDITION.test(title);
}

/**
 * What changed in each SGA constitution or bylaws edition among `documents`
 * from the latest edition of the same kind dated before it. A document read
 * alone only says what it contains, so an amended edition otherwise becomes
 * "Constitution amended" with no word of what the amendment did.
 */
async function priorEditions(documents: CandidateDocument[]): Promise<Map<string, PriorEdition>> {
    const result = new Map<string, PriorEdition>();
    const editions = documents.filter((document) => isSgaEdition(document) && document.datedAt);
    if (!editions.length) return result;
    const all = (await prisma.document.findMany({
        where: { kind: { in: EDITION_KINDS }, datedAt: { not: null }, content: { not: "" } },
        select: { id: true, title: true, displayTitle: true, kind: true, datedAt: true, content: true },
    })).filter((document) => isSgaEdition(document));
    for (const document of editions) {
        const prior = all
            .filter((other) => other.kind === document.kind && other.datedAt! < document.datedAt!)
            .sort((left, right) => right.datedAt!.getTime() - left.datedAt!.getTime() || left.id.localeCompare(right.id))[0];
        if (!prior) continue;
        const changes = editionChanges(prior.content, document.content);
        if (!changes) continue;
        result.set(document.id, {
            id: prior.id,
            title: prior.displayTitle || prior.title,
            datedAt: prior.datedAt!.toISOString().slice(0, 10),
            changes,
        });
    }
    return result;
}

/**
 * The lines removed and added between two editions, as text for the
 * extraction prompt; "" when they are the same or, unless `known` says they
 * are versions of one text (a bill's own current and proposed language), too
 * different to be editions of one document.
 */
export function editionChanges(before: string, after: string, known = false): string {
    const flat = (text: string) => text.split("\n").map((line) => line.replace(/\s+/g, " ").trim()).filter(Boolean).join("\n");
    const diff = diffLines(flat(before), flat(after));
    if (diff.coarse || (!diff.added && !diff.removed)) return "";
    const lines = Math.max(flat(before).split("\n").length, flat(after).split("\n").length);
    if (!known && (diff.added + diff.removed) / 2 > lines * MAX_CHANGED_SHARE) return "";
    const blocks: string[] = [];
    let length = 0;
    for (let index = 0; index < diff.ops.length; index += 1) {
        const op = diff.ops[index]!;
        if (op.type === "equal") continue;
        const block = op.lines.map((line) => `${op.type === "added" ? "+" : "-"} ${line}`).join("\n");
        if (length + block.length > CHANGES_CHARS) {
            blocks.push("[further changes not shown]");
            break;
        }
        blocks.push(block);
        length += block.length;
    }
    return blocks.join("\n");
}

function topicFingerprint(topic: HistoryTopicDefinition): string {
    return createHash("sha256")
        .update(PROMPT_VERSION)
        .update(JSON.stringify(topic))
        .digest("hex");
}

/**
 * The part of a topic extraction reads: all of it but what only the merge and
 * its finishing use (mergeRules, styleFixes), so changing those re-merges
 * without paying to re-extract every document. A topic without either
 * fingerprints exactly as topicFingerprint does. A new topic field that
 * extraction never reads belongs in this list too, or editing it re-reads
 * every document.
 */
function extractionFingerprint(topic: HistoryTopicDefinition): string {
    const read = { ...topic };
    delete read.mergeRules;
    delete read.styleFixes;
    return topicFingerprint(read);
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

/** Who a finding may name, unless the topic says otherwise. */
const DEFAULT_PEOPLE_RULE = "Never name or identify a survivor, complainant, or accused person, or describe the details of an individual case. Name SGA bodies and offices rather than individual students. If no quote for a finding can avoid identifying such a person, leave the finding out.";

/** A topic's own rules, after the shared ones. Nothing at all when it has none,
 * so a topic without them keeps its prompt, and its caches, unchanged. */
function topicRules(rules: string[] | undefined): string {
    return rules?.length ? rules.map((rule) => `
- ${rule}`).join("") : "";
}

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
- ${topic.peopleRule ?? DEFAULT_PEOPLE_RULE}${topicRules(topic.extractionRules)}

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
            : document.discoveredVia === "gazette"
                ? "Article in The Johns Hopkins Gazette, the university's newspaper (secondary reporting)"
                : "SGA record";
    const dated = formatDate(document.datedAt) ?? "undated";
    const partial = excerpt.length < document.content.length ? ' excerpted="true"' : "";
    const prior = document.priorEdition;
    const changes = prior
        ? `

<changes from="${prior.title.replace(/"/g, "'")}" from-date="${prior.datedAt}">
${prior.changes}
</changes>
This document is an edition of a governing document, and <changes> shows how it differs from the edition before it: "-" lines were removed, "+" lines were added. Record what this edition changed -- one finding per change, saying what was added, removed, or rewritten and to what effect -- and not what the document contains. Quote each finding from the document, such as a "+" line; never quote a "-" line, since removed text is not in the document. For a change that only removed text, quote the new text that took its place or the nearest heading. Changes to dates, numbering, spacing, or formatting alone are not findings; when nothing else changed, return no findings.`
        : "";
    const amendments = document.amendments
        ? `

<amendments>
${document.amendments}
</amendments>
This bill amends a governing document, and <amendments> shows what its current-and-proposed-language table changes: "-" lines are current language it removes or rewrites, "+" lines are language it adds. Record one finding per change, saying concretely what is added, removed, or rewritten -- "made the Chair of Programming responsible for overseeing Class Council activities", never "expanded the Chair of Programming's oversight" -- and do not describe the bill by its title or its findings-and-purposes boilerplate, which bills often copy from one another. Quote each finding from the document, such as a "+" line; never quote a "-" line on its own. Where <amendments> says a change is not known, record the bill without describing what it changed, and say that its changes were set out in separate documents.`
        : "";
    return `<document title="${title}" kind="${documentKindLabel(document.kind)}" source="${source}" date="${dated}"${partial}>
${excerpt}
</document>${changes}${amendments}`;
}

async function extractDocument(
    topic: HistoryTopicDefinition,
    patterns: TopicPatterns,
    document: CandidateDocument,
): Promise<{ status: "found" | "none" | "failed"; findings: HistoryFindingItem[]; model: string; error?: string; rejected: number }> {
    const excerpt = topicExcerpt(document.content, patterns);
    const threadIds = topic.threads.map((thread) => thread.id);
    let model = "";
    let feedback = "";
    let rejected = 0;
    let firstProblem = "";
    // One correction attempt: a quote that repeats in the document (an agenda
    // line asked of two members) cannot be anchored until it is lengthened.
    for (let attempt = 0; attempt < 2; attempt += 1) {
        let raw: { findings?: unknown[] };
        try {
            const generated = await generateJson<{ findings?: unknown[] }>({
                system: extractionSystemPrompt(topic),
                user: extractionUserPrompt(document, excerpt) + feedback,
                maxTokens: 6_000,
            });
            raw = generated.value;
            model = generated.model;
            if (!raw || !Array.isArray(raw.findings)) throw new Error("Extraction response must contain a findings array");
        } catch (cause) {
            return { status: "failed", findings: [], model, error: cause instanceof Error ? cause.message : String(cause), rejected: 0 };
        }

        const findings: HistoryFindingItem[] = [];
        const problems: string[] = [];
        for (const item of raw.findings!) {
            const parsed = parseFindingItem(item, threadIds);
            if (!parsed) {
                problems.push(`${JSON.stringify(item)}: missing or invalid fields`);
            } else if (!findQuote(document.content, parsed.quote)) {
                problems.push(document.content.includes(parsed.quote)
                    ? `${JSON.stringify(parsed.quote)}: appears more than once; extend it with adjacent text so it occurs exactly once`
                    : `${JSON.stringify(parsed.quote)}: not found verbatim in the document`);
            } else {
                findings.push(parsed);
            }
        }
        rejected = problems.length;
        firstProblem = problems[0] ?? "";
        if (!rejected) return { status: findings.length > 0 ? "found" : "none", findings, model, rejected };
        feedback = "\n\nYour previous response had findings that failed validation:\n- " + problems.join("\n- ") +
            "\nReturn a corrected complete response. Every quote must be copied exactly from the document and occur in it exactly once.";
    }
    return { status: "failed", findings: [], model, rejected, error: `${rejected} invalid or unanchored finding(s); first: ${firstProblem}` };
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
    label: string;
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
- Every finding belongs to exactly one event. Leave a finding out only if it is plainly off-topic.${topicRules(topic.mergeRules)}
- "title": under 12 words, sentence case, no final period, naming what happened. Never say whether legislation passed or failed; that is shown separately from the record.
- "label": at most four words, for a crowded timeline: what kind of thing it was, in the SGA's own short names, e.g. "New SBP", "CSE constitution update", "Petition", "Survivor fund bill". The title's rules apply.
- "content": one to three short, neutral sentences using only what the summaries say. End each sentence with markers like [1] or [1][2] giving the 1-based position of supporting findings in this event's "findings" list. Never state whether legislation passed or failed. ${topic.peopleRule ? `Who may be named, in titles and prose alike: ${topic.peopleRule}` : "Never name or identify a survivor, complainant, or accused person."}
- "thread": one of
${threads}
- "kind": one of legislation, funding, programming, statement, discussion, policy, report.
- "involvement": "sga" if the SGA acted, "context" otherwise.
- "weight": 3 for a landmark, 2 for a concrete action, 1 for a discussion or brief mention.

Reply with a single JSON object and nothing else:
{"events": [{"findings": [string], "title": string, "label": string, "content": string, "thread": string, "kind": string, "involvement": string, "weight": number}]}`;
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

/** Contributor roles whose line is about the file, not the person's office. */
const NON_OFFICE_ROLES = new Set(["drive_owner", "drive_editor", "absent"]);
/** Roles whose line most often states an office, tried first. */
const OFFICE_ROLE_ORDER = ["introducer", "author", "sponsor", "confirmed", "nominee", "reporting", "involved", "guest", "interlocutor", "mentioned", "present"];
/** A line that names an office is worth more than one that only names the person. */
const OFFICE_WORDS = /\b(President|Treasurer|Secretary|Chair|Senator|Parliamentarian|Justice|Director|Coordinator|Representative|Liaison)\b/i;
/** Officer titles a constitution defines; a bare "Treasurer" in minutes is shorthand for one. */
const CONSTITUTION_TITLES = /\b(?:Student Body (?:President|Vice President|Secretary|Treasurer)|Executive (?:President|Vice President|Secretary|Treasurer)|Chair of Programming|President of the Senate|Vice President of the Senate|Parliamentarian|Chief Justice)\b/g;
const LINES_PER_PERSON = 4;
const LINE_CHARS = 200;

/**
 * What a batch's own records say about the people its findings name, so a
 * title can say "Finance Chair Peter Tarpley" where a finding says only
 * "Peter". Only for topics that name people (`peopleRule`).
 *
 * People are those credited in the batch's documents whose first or last name
 * appears in a finding; each gets their full name and up to four dated lines
 * the parser read about them there, such as "Introduced by: Chair for the
 * Committee on Finance Peter Tarpley", lines naming an office first. Those
 * lines were written at the time; a batch spans a year in which offices
 * change, so the dates matter. The people directory's position dates are not
 * used: many start at a session's opening rather than when the office was
 * taken. The officer titles of the latest SGA constitution by the batch's
 * dates come too, so a "Treasurer" in minutes can be given its full title.
 */
async function officeContext(findings: PlacedFinding[]): Promise<string> {
    const text = findings.map((finding) => `${finding.summary}\n${finding.quote}`).join("\n");
    // A finding can name someone by a nickname ("appointing Jo as DoC"); the
    // line credited to them is then the finding's own quote.
    const flat = (value: string) => value.replace(/\s+/g, " ").trim();
    const quotes = findings.map((finding) => flat(finding.quote)).filter((quote) => quote.length >= 15);
    const contributors = await prisma.documentContributor.findMany({
        where: { documentId: { in: [...new Set(findings.map((finding) => finding.document.id))] } },
        select: { role: true, evidence: true, document: { select: { datedAt: true } }, hopkinsAffiliate: { select: { id: true, name: true } } },
    });

    const people = new Map<string, { name: string; lines: Map<string, { rank: number; dated: string }> }>();
    for (const { role, evidence, document, hopkinsAffiliate: person } of contributors) {
        if (NON_OFFICE_ROLES.has(role) || !evidence.trim()) continue;
        const credited = flat(evidence);
        const named = person.name.split(/\s+/).filter((part) => part.length >= 3).some((part) =>
            new RegExp(`\\b${part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(text)) ||
            quotes.some((quote) => credited.includes(quote) || (credited.length >= 15 && quote.includes(credited)));
        if (!named) continue;
        const entry = people.get(person.id) ?? { name: person.name, lines: new Map() };
        const line = evidence.replace(/\s+/g, " ").trim().slice(0, LINE_CHARS);
        const roleRank = OFFICE_ROLE_ORDER.indexOf(role);
        const rank = (OFFICE_WORDS.test(line) ? 0 : 100) + (roleRank < 0 ? OFFICE_ROLE_ORDER.length : roleRank);
        const known = entry.lines.get(line);
        if (!known || rank < known.rank) {
            entry.lines.set(line, { rank, dated: document.datedAt ? document.datedAt.toISOString().slice(0, 10) : "undated" });
        }
        people.set(person.id, entry);
    }

    const parts: string[] = [];
    const titles = await constitutionTitles(findings);
    if (titles) parts.push(titles);
    if (people.size) {
        const blocks = [...people.values()]
            .sort((left, right) => left.name.localeCompare(right.name))
            .map(({ name, lines }) => {
                const chosen = [...lines.entries()].sort((left, right) => left[1].rank - right[1].rank).slice(0, LINES_PER_PERSON);
                return `- ${name}: ${chosen.map(([line, { dated }]) => `${dated} ${JSON.stringify(line)}`).join("; ")}`;
            });
        parts.push(
            "How these findings' documents describe the people they name (full name, then dated lines from those " +
            "documents). Use them only to give a named person their full name and the office they held on the " +
            "event's date; an office a finding states comes first, and a line that states no office gives none.\n" +
            blocks.join("\n"),
        );
    }
    const roster = await rosterTitles(findings, text, [...people.values()].map((person) => person.name));
    if (roster) parts.push(roster);
    return parts.length ? `\n\n${parts.join("\n\n")}` : "";
}

/** Session directories (the contact page's roster), built once per session in a run. */
const sessionRosters = new Map<number, Promise<DirectoryMember[]>>();

function sessionRoster(session: number): Promise<DirectoryMember[]> {
    let roster = sessionRosters.get(session);
    if (!roster) {
        roster = prisma.document
            .findMany({
                where: { sessionNumber: session },
                select: { id: true, title: true, content: true, kind: true, folderPath: true, source: true, driveModifiedTime: true },
            })
            .then((documents) => buildSessionDirectory(documents).members.filter((member) => !isEmptySeat(member.name)));
        sessionRosters.set(session, roster);
    }
    return roster;
}

/**
 * A roster member's offices in the form a title uses: the roster's
 * "Registered Student Organization Senator" and "Declared RSO Category:
 * Religious and Spiritual Life" become "Religious and Spiritual Life RSO
 * Senator".
 */
export function rosterOffices(positions: string[]): string[] {
    const category = positions.map((position) => /^Declared RSO Category:\s*(.+)$/i.exec(position)?.[1]?.trim()).find(Boolean);
    return positions
        .filter((position) => !/^Declared RSO Category:/i.test(position))
        .map((position) => (category && /^Registered Student Organization Senator$/i.test(position) ? `${category} RSO Senator` : position));
}

/**
 * The official seat and office titles of the people a batch names, from the
 * roster of each session its documents belong to -- what the contact page
 * shows. A roster is the session as it stands at its latest edit, so it
 * gives a title's exact wording ("Transfer Students Caucus Senator", not
 * "Transfer Student Caucus representative"), never which office someone held
 * on an earlier date.
 */
async function rosterTitles(findings: PlacedFinding[], text: string, credited: string[]): Promise<string> {
    const sessions = [...new Set(findings.flatMap((finding) => (finding.document.sessionNumber ? [finding.document.sessionNumber] : [])))];
    if (!sessions.length) return "";
    const creditedKeys = new Set(credited.map(nameKey));
    const lastNames = new Set(credited.map((name) => name.trim().split(/\s+/).at(-1)!.toLowerCase()));
    const lines = new Map<string, string>();
    for (const session of sessions.sort((left, right) => left - right)) {
        for (const member of await sessionRoster(session)) {
            const parts = member.name.trim().split(/\s+/);
            if (parts.length < 2) continue;
            const last = parts.at(-1)!;
            const named = creditedKeys.has(nameKey(member.name)) || text.includes(member.name) ||
                (last.length >= 4 && lastNames.has(last.toLowerCase()) && new RegExp(`\\b${parts[0]!.slice(0, 3)}`, "i").test(text));
            const offices = rosterOffices(member.positions);
            if (named && offices.length) lines.set(`${session}:${nameKey(member.name)}`, `- ${member.name} (${session}th session): ${offices.join("; ")}`);
        }
    }
    if (!lines.size) return "";
    return "Official seat and office titles from each session's roster, as the contact page shows them. A roster " +
        "shows the session as it last stood, so it may list an office taken after an event's date: use it for the " +
        "exact wording of a seat or office the findings or the dated lines show someone holding then (\"Transfer " +
        "Students Caucus Senator\", never \"Transfer Student Caucus representative\"), and for a senator's seat, but " +
        "never to give someone an office before they took it. Spell names as the dated lines do where the roster " +
        "differs.\n" +
        [...lines.values()].join("\n");
}

/** The officer titles defined by the latest SGA constitution dated by the batch's last date. */
async function constitutionTitles(findings: PlacedFinding[]): Promise<string> {
    const times = findings.flatMap((finding) => (finding.date ? [finding.date.getTime()] : []));
    if (!times.length) return "";
    const constitution = await prisma.document.findFirst({
        where: {
            kind: "guiding.constitution",
            datedAt: { lte: new Date(Math.max(...times)) },
            title: { contains: "SGA Constitution", mode: "insensitive" },
        },
        orderBy: { datedAt: "desc" },
        select: { title: true, displayTitle: true, datedAt: true, content: true },
    });
    if (!constitution) return "";
    const titles = [...new Set(constitution.content.match(CONSTITUTION_TITLES) ?? [])];
    if (!titles.length) return "";
    const name = constitution.displayTitle || constitution.title;
    return `Officer titles in the SGA constitution in force by these dates (${name}, ${constitution.datedAt!.toISOString().slice(0, 10)}): ` +
        `${titles.join(", ")}. A shortened title in the records ("Treasurer", "SGA Treasurer", "VP") means the full one here.`;
}

async function mergeChunk(
    topic: HistoryTopicDefinition,
    findings: PlacedFinding[],
    context = "",
): Promise<{ events: MergedEvent[]; model: string }> {
    let feedback = "";
    for (let attempt = 0; attempt < 3; attempt += 1) {
        const generated = await generateJson<{ events?: unknown[] }>({
            system: mergeSystemPrompt(topic),
            user: mergeUserPrompt(findings) + context + feedback,
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
        const prose = typeof value.content === "string" ? value.content.trim() : "";
        // A large event's prose sometimes cites one past its findings list
        // ("[29]" of 28). Dropping such a marker attributes nothing wrongly;
        // an event left with no valid marker at all still fails below.
        const valid = (index: number) => index >= 1 && index <= members.length;
        const content = citedIndexes(prose).some(valid)
            ? prose.replace(/\[(\d+)\]/g, (marker, index: string) => (valid(Number(index)) ? marker : "")).replace(/ +([.,;])/g, "$1")
            : prose;
        const citations = citedIndexes(content);
        if (!title || !content || !citations.length || citations.some((index) => index < 1 || index > members.length)) {
            // Say which event and what is wrong: the model is sent this to correct itself.
            const problem = !title ? "has no title"
                : !content ? "has no prose"
                : !citations.length ? "has no [n] citation markers"
                : `cites [${citations.filter((index) => index < 1 || index > members.length).join("], [")}] but lists ${members.length} finding(s)`;
            throw new Error(
                `Merged event needs a title, prose, and valid citation markers: the event with findings ` +
                `${keys.join(", ")}${title ? ` ("${title}")` : ""} ${problem}`,
            );
        }
        for (const key of keys) used.add(key);

        const thread = typeof value.thread === "string" && threadIds.includes(value.thread) ? value.thread : members[0]!.thread;
        events.push({
            findings: members,
            title,
            // A missing or wordy label is not worth a correction round: the page shortens the title instead.
            label: typeof value.label === "string" ? historyLabel(value.label) : "",
            content,
            thread,
            kind: eventKind(value.kind, members[0]!.kind),
            involvement: value.involvement === "context" ? "context" : "sga",
            weight: clampWeight(value.weight),
        });
    }

    return events;
}

/**
 * Documents the archive could date only to a session, month, or year: their
 * accepted AI date is "2026/2027", "2018-06", or "2026", and datedAt is that
 * period's anchor (lib/document-date-value.ts normalizedDateSortAnchor), not a
 * day anything happened. Read at merge time, so the extraction cache is
 * unaffected.
 */
async function coarselyDatedDocuments(ids: string[]): Promise<Map<string, "session" | "month" | "year">> {
    if (!ids.length) return new Map();
    const rows = await prisma.$queryRawUnsafe<{ id: string; precision: "session" | "month" | "year" }[]>(
        `select id, case
                 when "aiDateValue" ~ '^[0-9]{4}/[0-9]{4}$' then 'session'
                 when "aiDateValue" ~ '^[0-9]{4}-[0-9]{2}$' then 'month'
                 else 'year' end as precision
           from "Document"
          where id = any($1::text[])
            and (("aiDateValue" ~ '^[0-9]{4}/[0-9]{4}$'
                    and to_char("datedAt", 'YYYY') = split_part("aiDateValue", '/', 1)
                    and to_char("datedAt", 'MM-DD') = '06-01')
              or ("aiDateValue" ~ '^[0-9]{4}-[0-9]{2}$'
                    and to_char("datedAt", 'YYYY-MM') = "aiDateValue"
                    and to_char("datedAt", 'DD') = '01')
              or ("aiDateValue" ~ '^[0-9]{4}$'
                    and to_char("datedAt", 'YYYY') = "aiDateValue"
                    and to_char("datedAt", 'MM-DD') = '01-01'))`,
        ids,
    );
    return new Map(rows.map((row) => [row.id, row.precision]));
}

/**
 * A document's findings with maintainer-reviewed corrections applied
 * (REVIEWED_FINDINGS): a matching finding takes the reviewed summary, and a
 * reviewed finding the extraction missed is added when its quote anchors.
 */
function withReviewedFindings(document: CandidateDocument, findings: HistoryFindingItem[]): HistoryFindingItem[] {
    let result = findings;
    for (const reviewed of REVIEWED_FINDINGS) {
        if (reviewed.documentId !== document.id) continue;
        const correction = { summary: reviewed.summary, thread: reviewed.thread, kind: reviewed.kind, weight: reviewed.weight };
        const index = result.findIndex((finding) => reviewed.quotePattern.test(finding.quote));
        if (index >= 0) {
            result = result.map((finding, at) => (at === index ? { ...finding, ...correction } : finding));
        } else if (findQuote(document.content, reviewed.quote)) {
            result = [...result, { ...correction, quote: reviewed.quote, statedDate: null, involvement: "sga", outcomeClaim: "" }];
        }
    }
    return result;
}

/** Office words that may follow a name ("Jo Director of Communications") without being its surname. */
const AFTER_NAME_OFFICE_WORDS = "Director|President|Vice|Chair|Co-Chair|Senator|Secretary|Treasurer|Chief|Justice|Representative|Coordinator|Parliamentarian|Liaison";

/**
 * Deterministic finishing of merged events, for what the merge keeps getting
 * wrong despite its rules: a topic's house-style fixes, and, where people may
 * be named, a first name or nickname standing alone ("Director of Research
 * Jason", "Jo") expanded to the full name of the one person credited on the
 * event's documents it can mean. A nickname counts only when the line
 * credited to that person uses it ("appointing Jo as DoC").
 */
async function finishEvents(topic: HistoryTopicDefinition, events: MergedEvent[]): Promise<MergedEvent[]> {
    const fixes = (topic.styleFixes ?? []).map(({ pattern, replacement }) => ({ pattern: new RegExp(pattern, "g"), replacement }));
    const style = (text: string) => fixes.reduce((value, fix) => value.replace(fix.pattern, fix.replacement), text);
    if (!topic.peopleRule) return events.map((event) => ({ ...event, title: style(event.title), label: style(event.label), content: style(event.content) }));

    const ids = [...new Set(events.flatMap((event) => event.findings.map((finding) => finding.document.id)))];
    const credits = ids.length
        ? await prisma.documentContributor.findMany({
            where: { documentId: { in: ids }, role: { notIn: [...NON_OFFICE_ROLES] } },
            select: { documentId: true, evidence: true, hopkinsAffiliate: { select: { id: true, name: true } } },
        })
        : [];

    return events.map((event) => {
        const documents = new Set(event.findings.map((finding) => finding.document.id));
        // Short form -> the people it could mean.
        const forms = new Map<string, Map<string, string>>();
        const add = (form: string, id: string, name: string) => {
            const people = forms.get(form) ?? new Map<string, string>();
            people.set(id, name);
            forms.set(form, people);
        };
        for (const credit of credits) {
            if (!documents.has(credit.documentId)) continue;
            const { id, name } = credit.hopkinsAffiliate;
            const parts = name.trim().split(/\s+/);
            if (parts.length < 2) continue;
            const first = parts[0]!;
            add(first, id, name);
            for (const word of credit.evidence.match(/\b[A-Z][a-z]+\b/g) ?? []) {
                if (word !== first && first.startsWith(word)) add(word, id, name);
            }
        }
        const expand = (text: string) => {
            let value = text;
            for (const [form, people] of forms) {
                if (people.size !== 1) continue;
                const name = [...people.values()][0]!;
                if (value.includes(name)) continue;
                const escaped = form.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
                const standalone = new RegExp(
                    `(?<![\\w'’-])${escaped}(?![\\w-])(?!\\s+(?!(?:${AFTER_NAME_OFFICE_WORDS})\\b)[A-Z][\\w'’-]*)`,
                    "g",
                );
                value = value.replace(standalone, name);
            }
            return value;
        };
        return { ...event, title: style(expand(event.title)), label: style(event.label), content: style(expand(event.content)) };
    });
}

function chunkKey(year: string, index: number, count: number): string {
    return count === 1 ? year : `${year}#${index + 1}`;
}

/** An empty office context leaves the hash as it was, so topics without one keep their batches. */
function batchHash(topicHash: string, findings: PlacedFinding[], records: BillVoteRecord[], context = ""): string {
    return createHash("sha256").update("merge-v2").update(topicHash)
        .update(JSON.stringify(context ? [findings, records, context] : [findings, records])).digest("hex");
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
        const dateNotes = [...new Set(event.findings.flatMap((finding) => {
            const reviewedFinding = reviewedFindingDate(finding.document.id, finding.quote);
            if (reviewedFinding) return [reviewedFinding.note];
            const reviewed = HISTORY_DOCUMENT_DATES[finding.document.id];
            return reviewed && !finding.statedDate && span.precision === "year" &&
                span.occurredAt?.getUTCFullYear() === reviewed.year ? [reviewed.note] : [];
        }))];
        const outcome = legislationOutcome(
            event.kind,
            event.findings.map((finding) => ({
                kind: finding.document.kind,
                driveFileId: finding.document.driveFileId,
                title: finding.document.title,
                displayTitle: finding.document.displayTitle,
                content: finding.document.content,
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
                label: event.label,
                content: [remapCitedContent(event.content, remap), ...dateNotes].join("\n\n"),
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
    const extractHash = extractionFingerprint(topic);
    const mergeHash = topicFingerprint(topic);

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
        // Which documents a real run would extract, read without writing anything.
        const stored = await prisma.historyTopic.findUnique({ where: { slug }, select: { id: true } });
        const hashes = new Map(stored
            ? (await prisma.historyFinding.findMany({ where: { topicId: stored.id }, select: { documentId: true, promptHash: true, status: true } }))
                .map((row) => [row.documentId, row])
            : []);
        let pending = 0;
        for (const document of documents) {
            const excerpt = topicExcerpt(document.content, patterns);
            result.excerptChars += excerpt.length;
            const row = hashes.get(document.id);
            const extract = options.force || !row || row.status === "failed" || row.promptHash !== findingHash(extractHash, document);
            if (extract) pending += 1;
            const reads = [document.priorEdition && "edition changes", document.amendments && "amendments"].filter(Boolean).join(", ");
            log(`${extract ? "*" : " "} ${document.kind.padEnd(24)} ${String(excerpt.length).padStart(6)}  ${document.displayTitle || document.title}${reads ? `  [${reads}]` : ""}`);
        }
        log(`${pending} of ${documents.length} candidates would be extracted (marked *).`);
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
        return options.force || !row || row.status === "failed" || row.promptHash !== findingHash(extractHash, document);
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
                promptHash: findingHash(extractHash, document),
                status: outcome.status,
                findings: outcome.findings,
                model: outcome.model,
                error: outcome.error ?? null,
            },
            update: {
                promptHash: findingHash(extractHash, document),
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
            `[${result.extracted}/${toExtract.length}] ${outcome.status.padEnd(6)} ${outcome.findings.length} kept, ${outcome.rejected} rejected  ${document.displayTitle || document.title}${outcome.error ? `  (${outcome.error.slice(0, 400)})` : ""}`,
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
    const coarse = await coarselyDatedDocuments(documents.map((document) => document.id));
    const placed: PlacedFinding[] = [];
    for (const document of documents) {
        const row = cached.get(document.id);
        if (!row || row.status !== "found" || row.promptHash !== findingHash(extractHash, document)) continue;
        const datable = { ...document, datedOnlyTo: coarse.get(document.id) };
        withReviewedFindings(document, row.findings as HistoryFindingItem[]).forEach((finding, index) => {
            const { date, precision } = resolveFindingDate(finding.statedDate, datable, finding.quote);
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
            const context = topic.peopleRule ? await officeContext(chunk) : "";
            const hash = batchHash(mergeHash, chunk, records, context);
            liveKeys.add(key);

            if (!options.force && existingHash.get(key) === hash) {
                result.batchesKept += 1;
                continue;
            }
            try {
                const merged = await mergeChunk(topic, chunk, context);
                const model = merged.model;
                const events = await finishEvents(topic, merged.events);
                lastModel = model;
                staged.push({ key, hash, events });
                log(`prepared ${key}: ${chunk.length} findings into ${events.length} events`);
            } catch (cause) {
                const message = cause instanceof Error ? cause.message : String(cause);
                result.mergeFailures += 1;
                failures.push(`${key}: ${message}`);
                log(`merge failed ${key}: ${message.slice(0, 700)}`);
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
