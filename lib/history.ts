import {
    HISTORY_EVENT_KINDS,
    type HistoryDatePrecision,
    type HistoryEventKind,
    type HistoryOutcome,
    type HistoryTopicDefinition,
} from "@/config/history";
import { sessionStartDate } from "@/config/session";
import { HISTORY_DOCUMENT_DATES, reviewedFindingDate } from "@/config/history-dates";
import { CONFIRMED_HISTORY_PASSAGE } from "@/config/passage-evidence";
import { billVoteDecision, type BillVoteRecord } from "@/lib/bill-votes";
import { ARCHIVE_DATE_PRECISION, formatDate, formatDateShort, formatMonthYear } from "@/lib/dates";
import { splitIntoPassages } from "@/lib/passages";

/**
 * The pure half of a history timeline: which documents are candidates, what
 * part of each the model reads, how a finding is dated, and what a piece of
 * legislation's outcome is. No database and no model, so every rule here is
 * checked in scripts/history.check.ts. lib/history-generate.ts does the rest.
 */

/** What one document says happened, as stored in HistoryFinding.findings. */
export type HistoryFindingItem = {
    summary: string;
    /** Verbatim from the document; verified before it is stored. */
    quote: string;
    /** "YYYY-MM-DD", "YYYY-MM", "YYYY", or null when the text gives no date. */
    statedDate: string | null;
    thread: string;
    kind: HistoryEventKind;
    involvement: "sga" | "context";
    /** What this document says the full Senate decided. Not an outcome on its own. */
    outcomeClaim: "passed" | "not_passed" | "";
    weight: 1 | 2 | 3;
};

// ---------------------------------------------------------------------------
// Candidates
// ---------------------------------------------------------------------------

export type TopicPatterns = {
    /** For `content ~* $1` and `content ~ $2`. PostgreSQL spells a word boundary \y. */
    postgres: { insensitive: string; sensitive: string | null };
    js: { insensitive: RegExp; sensitive: RegExp | null };
};

export function topicPatterns(topic: Pick<HistoryTopicDefinition, "terms" | "acronyms">): TopicPatterns {
    const terms = topic.terms.join("|");
    const acronyms = topic.acronyms.join("|");
    return {
        postgres: {
            insensitive: `\\y(?:${terms})\\y`,
            sensitive: acronyms ? `\\y(?:${acronyms})\\y` : null,
        },
        js: {
            insensitive: new RegExp(`\\b(?:${terms})\\b`, "i"),
            sensitive: acronyms ? new RegExp(`\\b(?:${acronyms})\\b`) : null,
        },
    };
}

export function matchesTopic(text: string, patterns: TopicPatterns): boolean {
    return patterns.js.insensitive.test(text) || (patterns.js.sensitive?.test(text) ?? false);
}

/** Whole documents up to this size are read in full. */
const WHOLE_DOCUMENT_CHARS = 20_000;
/** Otherwise the matching passages and their neighbours, up to this much. */
const EXCERPT_CHARS = 14_000;
const GAP = "\n\n[…]\n\n";

/**
 * The part of a document the model reads.
 *
 * Every excerpt is a verbatim slice of `content`, so a quote copied out of it
 * is a quote from the document. A matching passage brings its neighbours
 * because a motion's result is often the paragraph after the one that names
 * the topic. Matching passages are kept before neighbours when the budget
 * runs out, and the slices are joined in reading order.
 */
export function topicExcerpt(content: string, patterns: TopicPatterns): string {
    if (content.length <= WHOLE_DOCUMENT_CHARS) return content;

    const passages = splitIntoPassages(content);
    const hits = passages.flatMap((passage, index) =>
        matchesTopic(passage.content, patterns) ? [index] : [],
    );
    if (hits.length === 0) return content.slice(0, EXCERPT_CHARS);

    const chosen = new Set<number>();
    let used = 0;
    const take = (index: number) => {
        const passage = passages[index];
        if (!passage || chosen.has(index)) return;
        const size = passage.endOffset - passage.startOffset;
        if (used + size > EXCERPT_CHARS && chosen.size > 0) return;
        chosen.add(index);
        used += size;
    };
    for (const index of hits) take(index);
    for (const index of hits) {
        take(index - 1);
        take(index + 1);
    }

    const ordered = [...chosen].sort((a, b) => a - b);
    const slices: string[] = [];
    let previous = -2;
    for (const index of ordered) {
        const passage = passages[index]!;
        const text = content.slice(passage.startOffset, passage.endOffset);
        if (index === previous + 1 && slices.length > 0) {
            const start = passages[previous]!.endOffset;
            slices[slices.length - 1] += content.slice(start, passage.endOffset);
        } else {
            slices.push(text);
        }
        previous = index;
    }
    return slices.join(GAP);
}

// ---------------------------------------------------------------------------
// Model output
// ---------------------------------------------------------------------------

const STATED_DATE = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/;

/**
 * One raw finding from the model, checked field by field. Returns null for
 * anything that cannot be stored; the quote is verified separately, against
 * the document.
 */
export function parseFindingItem(
    raw: unknown,
    threadIds: readonly string[],
): HistoryFindingItem | null {
    if (!raw || typeof raw !== "object") return null;
    const value = raw as Record<string, unknown>;

    const summary = typeof value.summary === "string" ? value.summary.trim() : "";
    const quote = typeof value.quote === "string" ? value.quote : "";
    if (!summary || !quote.trim()) return null;

    const date = typeof value.date === "string" ? value.date.trim() : "";
    const statedDate = STATED_DATE.test(date) ? date : null;

    const thread =
        typeof value.thread === "string" && threadIds.includes(value.thread)
            ? value.thread
            : threadIds[threadIds.length - 1]!;
    const kind = eventKind(value.kind, "discussion");
    const involvement = value.involvement === "context" ? "context" : "sga";
    const outcomeClaim =
        kind === "legislation" && (value.outcome === "passed" || value.outcome === "not_passed")
            ? value.outcome
            : "";
    const weight = clampWeight(value.weight);

    return { summary, quote, statedDate, thread, kind, involvement, outcomeClaim, weight };
}

export function eventKind(value: unknown, fallback: HistoryEventKind): HistoryEventKind {
    return HISTORY_EVENT_KINDS.includes(value as HistoryEventKind) ? (value as HistoryEventKind) : fallback;
}

export function clampWeight(value: unknown): 1 | 2 | 3 {
    const number = typeof value === "number" ? Math.round(value) : Number.NaN;
    return number >= 3 ? 3 : number === 2 ? 2 : 1;
}

const LABEL_WORDS = 4;
const LABEL_TRAILING = new Set(["a", "an", "and", "at", "by", "for", "from", "in", "of", "on", "or", "the", "to", "with"]);

/** A model-written short label, or "" when it is missing or over four words. */
export function historyLabel(value: string): string {
    const label = value.replace(/\s+/g, " ").trim().replace(/[.;:]+$/, "");
    return label && label.split(" ").length <= LABEL_WORDS ? label : "";
}

/** A short label for an event: its own, or the first words of its title. */
export function eventLabel(label: string, title: string): string {
    if (historyLabel(label)) return historyLabel(label);
    const words = title.replace(/\s+/g, " ").trim().replace(/^(the|a|an) /i, "").split(" ").slice(0, LABEL_WORDS);
    while (words.length > 1 && LABEL_TRAILING.has(words.at(-1)!.toLowerCase())) words.pop();
    const shortened = words.join(" ").replace(/[,.;:]+$/, "");
    return shortened.charAt(0).toUpperCase() + shortened.slice(1);
}

/** An event's first paragraph without citation markers, for a timeline flag. */
export function eventSummary(content: string): string {
    return (content.split(/\n\s*\n/)[0] ?? "").replace(/\s*\[\d+\]/g, "").replace(/\s+/g, " ").trim();
}

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

export type DatableDocument = {
    id: string;
    datedAt: Date | null;
    driveCreatedTime: Date | null;
    sessionNumber: number | null;
    /**
     * The archive could date it only to a session ("2026/2027"), and datedAt is
     * that session's opening day, not a day anything happened.
     */
    sessionOnly?: boolean;
};

export type ResolvedDate = { date: Date | null; precision: HistoryDatePrecision };

const PRECISION_RANK: Record<HistoryDatePrecision, number> = {
    day: 0,
    month: 1,
    year: 2,
    session: 3,
    approximate: 4,
};

/** Lower is more precise. */
export function precisionRank(precision: HistoryDatePrecision): number {
    return PRECISION_RANK[precision];
}

/** How far past its own date a document can plausibly report something as done. */
const FUTURE_SLACK_MS = 366 * 24 * 60 * 60 * 1000;

/**
 * When a finding happened.
 *
 * The date the text gives for the finding itself comes first: a resolution
 * passed in 2019 can recount a 2014 event, and that event belongs in 2014.
 * A stated date after the document's own date is distrusted beyond a year --
 * minutes announce upcoming events, but nothing recounts the distant future.
 * Then the document's own date, at the precision the archive established it
 * to; then the middle of the document's session; then Drive's created time,
 * which a copied template can put months out.
 */
export function resolveFindingDate(statedDate: string | null, document: DatableDocument, quote = ""): ResolvedDate {
    const reviewed = reviewedFindingDate(document.id, quote);
    if (reviewed) return { date: reviewed.date ? new Date(reviewed.date) : null, precision: reviewed.precision };
    const own = documentDate(document);

    const stated = statedDate ? parseStatedDate(statedDate) : null;
    if (!stated) return own;
    // The model is shown the stored date, so a year-only "1967" stored as
    // 1 January comes back as a stated "1967-01-01". That is the document's
    // date echoed, not a finer one, and keeps the precision established for it.
    if (echoesStoredDate(stated, document, own)) return own;

    const ceiling = own.date ? own.date.getTime() + FUTURE_SLACK_MS : Number.POSITIVE_INFINITY;
    if (stated.date.getUTCFullYear() < 1876 || stated.date.getTime() > ceiling) return own;

    // "In March" in minutes dated 12 March: the document's day is the finer
    // answer to the same question. A stated period the document's date falls
    // outside of is a different time, and wins however coarse it is.
    const sharper = own.date && precisionRank(own.precision) < precisionRank(stated.precision);
    if (sharper && withinPeriod(own.date!, stated)) return own;
    return stated;
}

function echoesStoredDate(
    stated: { date: Date; precision: HistoryDatePrecision },
    document: DatableDocument,
    own: ResolvedDate,
): boolean {
    if (!document.datedAt || own.precision === "day" || precisionRank(stated.precision) >= precisionRank(own.precision)) {
        return false;
    }
    if (stated.precision !== "day") return withinPeriod(document.datedAt, stated);
    const day = (date: Date) => date.toISOString().slice(0, 10);
    return day(stated.date) === day(document.datedAt);
}

function withinPeriod(date: Date, period: { date: Date; precision: HistoryDatePrecision }): boolean {
    if (date.getUTCFullYear() !== period.date.getUTCFullYear()) return false;
    return period.precision === "year" || date.getUTCMonth() === period.date.getUTCMonth();
}

function parseStatedDate(value: string): { date: Date; precision: HistoryDatePrecision } | null {
    const match = STATED_DATE.exec(value);
    if (!match) return null;
    const year = Number(match[1]);
    const month = match[2] ? Number(match[2]) : null;
    const day = match[3] ? Number(match[3]) : null;
    if (month !== null && (month < 1 || month > 12)) return null;

    if (month === null) return { date: utcNoon(year, 7, 1), precision: "year" };
    if (day === null) return { date: utcNoon(year, month, 15), precision: "month" };

    const date = utcNoon(year, month, day);
    if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
    return { date, precision: "day" };
}

function documentDate(document: DatableDocument): ResolvedDate {
    if (document.datedAt && document.sessionOnly) {
        const at = document.datedAt;
        const start = at.getUTCMonth() >= 5 ? at.getUTCFullYear() : at.getUTCFullYear() - 1;
        return { date: utcNoon(start, 12, 1), precision: "session" };
    }
    if (document.datedAt) {
        const established = ARCHIVE_DATE_PRECISION[document.id]?.precision;
        if (established === "year" || established === "approximate") {
            return { date: utcNoon(document.datedAt.getUTCFullYear(), 7, 1), precision: "year" };
        }
        if (established === "month") {
            const at = document.datedAt;
            return { date: utcNoon(at.getUTCFullYear(), at.getUTCMonth() + 1, 15), precision: "month" };
        }
        return { date: document.datedAt, precision: "day" };
    }
    if (document.sessionNumber) {
        const start = sessionStartDate(document.sessionNumber);
        return { date: utcNoon(start.getUTCFullYear(), 12, 1), precision: "session" };
    }
    const reviewed = HISTORY_DOCUMENT_DATES[document.id];
    if (reviewed) return { date: utcNoon(reviewed.year, 7, 1), precision: "year" };
    if (document.driveCreatedTime) return { date: document.driveCreatedTime, precision: "approximate" };
    return { date: null, precision: "approximate" };
}

function utcNoon(year: number, month: number, day: number): Date {
    return new Date(Date.UTC(year, month - 1, day, 12));
}

/**
 * The academic year a date falls in, which is the unit events are merged in.
 * Sessions turn over in June, so "2018-2019" runs June 2018 to May 2019.
 */
export function academicYearKey(date: Date | null): string {
    if (!date) return "undated";
    const year = date.getUTCFullYear();
    const start = date.getUTCMonth() >= 5 ? year : year - 1;
    return `${start}-${start + 1}`;
}

/** "2018–19" for the academic year a key like "2018-2019" names. */
export function academicYearLabel(key: string): string {
    const match = /^(\d{4})-(\d{4})$/.exec(key);
    return match ? `${match[1]}–${match[2]!.slice(-2)}` : "Undated";
}

/**
 * A date as precise as the record makes it, and no more. A year-precise
 * event placed at 1 July for drawing is "1982", never "July 1, 1982".
 */
export function historyDateLabel(
    date: Date | null,
    precision: HistoryDatePrecision,
    { short = false }: { short?: boolean } = {},
): string {
    if (!date) return "Undated";
    switch (precision) {
        case "day":
            return (short ? formatDateShort(date) : formatDate(date)) ?? "";
        case "month":
            return formatMonthYear(date) ?? "";
        case "year":
            return String(date.getUTCFullYear());
        case "session": {
            const year = date.getUTCMonth() >= 5 ? date.getUTCFullYear() : date.getUTCFullYear() - 1;
            return `${year}–${String(year + 1).slice(-2)} session`;
        }
        case "approximate":
            return `About ${formatMonthYear(date)}`;
    }
}

export function historySpanLabel(
    start: Date | null,
    end: Date | null,
    precision: HistoryDatePrecision,
    options: { short?: boolean } = {},
): string {
    const from = historyDateLabel(start, precision, options);
    if (!end) return from;
    return `${from} – ${historyDateLabel(end, precision, options)}`;
}

export type DatedFinding = { date: Date | null; precision: HistoryDatePrecision };

/**
 * An event's place on the timeline, from the findings merged into it.
 *
 * Only the most precise dates count: a bill's minutes dated to the day are
 * not stretched back to the September its file was created. Two or more days
 * between the earliest and latest of those makes it a span.
 */
export function eventSpan(findings: DatedFinding[]): {
    occurredAt: Date | null;
    endedAt: Date | null;
    precision: HistoryDatePrecision;
} {
    const dated = findings.filter((finding): finding is { date: Date; precision: HistoryDatePrecision } =>
        finding.date !== null,
    );
    if (dated.length === 0) return { occurredAt: null, endedAt: null, precision: "approximate" };

    const best = Math.min(...dated.map((finding) => precisionRank(finding.precision)));
    const tier = dated.filter((finding) => precisionRank(finding.precision) === best);
    const times = tier.map((finding) => finding.date.getTime());
    const start = Math.min(...times);
    const end = Math.max(...times);

    return {
        occurredAt: new Date(start),
        endedAt: end - start >= 2 * 24 * 60 * 60 * 1000 ? new Date(end) : null,
        precision: tier[0]!.precision,
    };
}

// ---------------------------------------------------------------------------
// Outcomes
// ---------------------------------------------------------------------------

export type OutcomeSource = {
    kind: string;
    driveFileId: string;
    title: string;
    displayTitle: string;
    /** The document's text, so a renamed bill can still be matched to its register row. */
    content?: string;
    outcomeClaim: "passed" | "not_passed" | "";
};

function isLegislationDocument(kind: string): boolean {
    return kind.startsWith("bill.") || kind === "resolution";
}

/**
 * Whether a piece of legislation passed, decided from the record rather than
 * by the model.
 *
 * The Bill Voting Records register first, then the full Senate's minutes when
 * the register is silent. A committee's recommendation, a reading, the bill's
 * own text, and newspaper reporting never establish adoption. Results that
 * disagree -- within the register, within the minutes, or between the two --
 * stay inconclusive rather than one being chosen silently. A file listed in
 * CONFIRMED_HISTORY_PASSAGE is passed; that review overrides a conflicting
 * later row in the register.
 */
export function legislationOutcome(
    kind: HistoryEventKind,
    sources: OutcomeSource[],
    votingRecords: BillVoteRecord[],
): HistoryOutcome {
    if (kind !== "legislation") return "";

    const results = new Set<"passed" | "not_passed">();
    let ambiguous = false;

    const confirmed = new Set<string>(CONFIRMED_HISTORY_PASSAGE.map((item) => item.legislationFileId));
    for (const source of sources) {
        if (!isLegislationDocument(source.kind)) continue;
        if (confirmed.has(source.driveFileId)) {
            results.add("passed");
            continue;
        }
        const decision = billVoteDecision(source, votingRecords);
        if (decision.status === "ambiguous") ambiguous = true;
        if (decision.status === "passed" || decision.status === "not_passed") results.add(decision.status);
    }

    const minutes = new Set(
        sources
            .filter((source) => source.kind === "minutes.senate" && source.outcomeClaim)
            .map((source) => source.outcomeClaim as "passed" | "not_passed"),
    );

    if (ambiguous || results.size > 1 || minutes.size > 1) return "inconclusive";
    if (results.size === 1) {
        const [registered] = results;
        if (minutes.size === 1 && !minutes.has(registered!)) return "inconclusive";
        return registered!;
    }
    if (minutes.size === 1) return [...minutes][0]!;
    return "unrecorded";
}
