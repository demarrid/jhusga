/**
 * What a document says about itself: which session it belongs to, and when
 * it was written.
 *
 * Drive metadata is a poor substitute. Officers copy last year's bill into a
 * new file and type over it, so the Google Doc's createdTime is the day the
 * template was made -- July 2024, for a rules bill the 114th considered on
 * 21 April 2026. Linked-in files inherit a session from whichever agenda first
 * pointed at them, and a file still cited two sessions later gets pinned to
 * the earliest of those, even after its text has been rewritten for the
 * current one.
 *
 * The caption is the thing the Senate actually adopted. "S.B.26-27.21.04-1",
 * "{S-B.26-27 04.21.26-1}", "CONSIDERED THIS 21ST DAY OF APRIL IN THE YEAR
 * 2026" -- those are the identity. Folder placement still wins for anything
 * the walk found; this is for documents we only have because an agenda
 * linked them.
 *
 * Where a document names no session at all, the date it states is read as one:
 * a session runs with the academic year, so a report bylined May 2019 is the
 * 106th's work however recently somebody linked to it. That is a weaker
 * inference than a caption and a much better one than the folder of whichever
 * agenda pointed here.
 */

import {
    academicYearStart,
    sessionFromAcademicYearStart,
} from "@/config/session";
import { toPlainText } from "@/lib/markdown";
import { meetingDate } from "@/lib/meetings";

/**
 * How much of the body is a caption rather than discussion.
 *
 * A bill names itself in the heading; an agenda that later cites last year's
 * minutes must not inherit that session. Two thousand characters covers a
 * long enacting clause and stops before the body starts citing other years.
 */
const HEADER_CHARS = 2_000;

/**
 * "2026-2027", "2026-27", "2026–2027", "2018/2019".
 *
 * The slash is not optional politeness: the SGA writes an academic year that
 * way about as often as it hyphenates it, and a report on the "2018/2019
 * referendum" that says so in its own title was being filed under whichever
 * session happened to link to it.
 */
const ACADEMIC_YEAR =
    /\b((?:19|20)\d{2})\s*(?:[-–—/]|to)\s*((?:19|20)?\d{2})\b/gi;

/**
 * Bill numbers as the SGA writes them: "S.B.26-27", "S-B.26-27",
 * "S. BILL 23-24, 01", "SGA-B-2627", optionally followed by a date
 * ("S.B.26-27.21.04-1", "{S-B.26-27 04.21.26-1}").
 */
const BILL_NUMBER =
    /(?:S\.?\s*-?\s*B(?:ill)?\.?|SGA-B-)\s*(\d{2})[-–—,]?\s*(\d{2})(?:[.\s]+(\d{1,2})[./](\d{1,2})(?:[./-](\d{2,4}))?)?/gi;

/**
 * The 114th's numbering, which drops the academic year in favour of the
 * session and a full date: "S-B.114.09.08.2026-1", "{ S. Bill. 114.09.08.2026-1 }".
 *
 * Distinguished from the older "26-27" form by the four-digit year at the end,
 * which is also what makes it worth reading: it states the session and the day
 * the bill was put to the Senate in one string.
 */
const BILL_NUMBER_DATED =
    /(?:S\.?\s*-?\s*B(?:ill)?\.?)\s*(\d{1,3})\s*\.\s*(\d{1,2})\s*\.\s*(\d{1,2})\s*\.\s*((?:19|20)\d{2})/gi;

/** "114th session", "114th legislative session", "114th SGA". */
const SESSION_PHRASE =
    /\b(\d{1,3})(?:st|nd|rd|th)\s+(?:legislative\s+)?(?:session|sga)\b/gi;

const MONTHS = [
    "january", "february", "march", "april", "may", "june",
    "july", "august", "september", "october", "november", "december",
];

/**
 * The clause a bill dates itself with, up to and including the year.
 *
 * Only the words "day of" and the year are fixed, because nothing else about
 * how the template gets filled in is. The blanks are meant to read "this 21st
 * day of April in the year 2026" and in practice hold the day in the month's
 * blank ("this the day of August 24th in the year 2024"), or the month in a
 * clause of its own ("THE DAY OF 31 IN THE MONTH OF March IN THE YEAR 2026").
 * Half the bills in the archive are one of those, so the day, the month and the
 * year are picked out of the clause rather than matched in a fixed order.
 */
const DAY_OF_CLAUSE =
    /\bday\s+of\b(.{0,60}?)\b(?:in\s+the\s+year\s+)?((?:19|20)\d{2})\b/gi;

/** How much of the run-up to "day of" can hold the day: "this 21st day of". */
const DAY_OF_LEAD_CHARS = 24;

const MONTH_NAME = new RegExp(`\\b(${MONTHS.join("|")})\\b`, "gi");

/** A day of the month, ordinal or not, and not part of a longer number. */
const DAY_NUMBER = /(?<![\d.])(\d{1,2})(?:st|nd|rd|th)?(?![\d.])/g;

/** The single value in a list, or null when there is none or more than one. */
function only<T>(values: T[]): T | null {
    return values.length === 1 ? values[0]! : null;
}

/**
 * What a "day of" clause is dating, most authoritative first.
 *
 * A bill carries several: introduced on one day, read on another, enacted on a
 * third. The one a reader wants filed as *the* date of the document is the
 * furthest it got, so enactment beats a reading and a reading beats the day
 * somebody typed it -- and where a bill only ever got introduced, that is the
 * date it is filed under.
 */
const CLAUSE_RANKS: { pattern: RegExp; rank: number }[] = [
    { pattern: /\b(?:enacted|enacting|adopted|ratified|signed)\b/i, rank: 4 },
    { pattern: /\b(?:passed|considered|considering)\b/i, rank: 3 },
    { pattern: /\b(?:presented|reading|read)\b/i, rank: 2 },
    { pattern: /\b(?:introduced|submitted|drafted|written)\b/i, rank: 1 },
];

/** How much text before a clause can say what the clause is dating. */
const CLAUSE_LABEL_CHARS = 80;

function monthNumber(name: string): number {
    return MONTHS.indexOf(name.toLowerCase()) + 1;
}

/** 26 → 2026, 2026 → 2026. Two-digit years are the 2000s. */
function fullYear(year: number): number | null {
    const value = year < 100 ? 2000 + year : year;
    if (value < 1913 || value > 2100) return null;
    return value;
}

function calendarDate(year: number, month: number, day: number): Date | null {
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    const full = fullYear(year);
    if (full === null) return null;
    // Noon UTC so America/New_York formatting stays on the intended day.
    return new Date(Date.UTC(full, month - 1, day, 12, 0, 0));
}

function academicStartFromParts(first: string, second: string): number | null {
    const start = Number(first);
    if (!Number.isInteger(start) || start < 1913 || start > 2100) return null;

    const endRaw = Number(second);
    if (!Number.isInteger(endRaw)) return null;

    let end = endRaw < 100 ? Math.floor(start / 100) * 100 + endRaw : endRaw;
    if (end < start) end += 100;
    if (end !== start + 1) return null;

    return start;
}

/**
 * The academic-year start encoded in a two-digit pair, or null.
 *
 * "26-27" and "2627" are 2026. A pair that does not look like consecutive
 * years (26-29) is not an academic year.
 */
function yearPair(first: string, second: string): number | null {
    const startTwo = Number(first);
    const endTwo = Number(second);
    if (!Number.isInteger(startTwo) || !Number.isInteger(endTwo)) return null;
    if (startTwo < 0 || startTwo > 99 || endTwo < 0 || endTwo > 99) return null;

    const expectedEnd = (startTwo + 1) % 100;
    if (endTwo !== expectedEnd) return null;

    return fullYear(startTwo);
}

function collectSessions(text: string): Set<number> {
    const sessions = new Set<number>();

    for (const match of text.matchAll(ACADEMIC_YEAR)) {
        const start = academicStartFromParts(match[1]!, match[2]!);
        const session = start === null ? null : sessionFromAcademicYearStart(start);
        if (session !== null) sessions.add(session);
    }

    for (const match of text.matchAll(BILL_NUMBER)) {
        const start = yearPair(match[1]!, match[2]!);
        const session = start === null ? null : sessionFromAcademicYearStart(start);
        if (session !== null) sessions.add(session);
    }

    for (const match of text.matchAll(BILL_NUMBER_DATED)) {
        const session = Number(match[1]);
        if (session >= 1 && session <= 300) sessions.add(session);
    }

    for (const match of text.matchAll(SESSION_PHRASE)) {
        const session = Number(match[1]);
        if (session >= 1 && session <= 300) sessions.add(session);
    }

    return sessions;
}

/**
 * The title and the top of the body, with markdown taken off.
 *
 * Flattened because every caption in the archive is bold, and half of them are
 * bold one word at a time: "Considering this **2nd** day of **September**" is
 * one clause to a reader and three fragments to a regular expression. The
 * offsets citations index into are untouched -- nothing here is stored.
 */
function header(title: string, content?: string): string {
    const body = content ? content.slice(0, HEADER_CHARS) : "";
    return `${toPlainText(title)}\n${toPlainText(body)}`;
}

export type IdentityInput = {
    title: string;
    content?: string;
};

/**
 * The session the document names, or null if it does not name one (or names
 * more than one, which is a citation of somebody else's work rather than an
 * identity).
 */
export function sessionFromDocument(input: IdentityInput): number | null {
    const sessions = collectSessions(header(input.title, input.content));
    if (sessions.size !== 1) return null;
    return [...sessions][0]!;
}

function datesFromBillNumbers(text: string): Date[] {
    const dates: Date[] = [];

    for (const match of text.matchAll(BILL_NUMBER)) {
        const start = yearPair(match[1]!, match[2]!);
        if (start === null) continue;

        const a = match[3] === undefined ? null : Number(match[3]);
        const b = match[4] === undefined ? null : Number(match[4]);
        const yearPart = match[5] === undefined ? null : Number(match[5]);
        if (a === null || b === null) continue;

        if (yearPart !== null) {
            const dated = calendarDate(yearPart, a, b);
            if (dated) dates.push(dated);
            continue;
        }

        // "S.B.26-27.21.04-1": day.month when the first number cannot be a month.
        if (a > 12 && b >= 1 && b <= 12) {
            const dated = calendarDate(start, b, a);
            if (dated) dates.push(dated);
            continue;
        }
        if (a >= 1 && a <= 12 && b >= 1 && b <= 31) {
            const dated = calendarDate(start, a, b);
            if (dated) dates.push(dated);
        }
    }

    return dates;
}

function datesFromDatedBillNumbers(text: string): Date[] {
    const dates: Date[] = [];

    for (const match of text.matchAll(BILL_NUMBER_DATED)) {
        const dated = calendarDate(
            Number(match[4]),
            Number(match[2]),
            Number(match[3]),
        );
        if (dated) dates.push(dated);
    }

    return dates;
}

/** How authoritative a "day of" clause is, from the words in front of it. */
function clauseRank(text: string, at: number): number {
    const label = text.slice(Math.max(0, at - CLAUSE_LABEL_CHARS), at);

    for (const { pattern, rank } of CLAUSE_RANKS) {
        if (pattern.test(label)) return rank;
    }

    return 0;
}

/**
 * The dates a document's "day of" clauses give, grouped by what each dates.
 *
 * Grouped rather than merged because a bill legitimately carries several and
 * they are not alternatives: the ranking decides which one the document is
 * filed under, and disagreement within one rank is what stops a guess.
 */
function datesFromDayOfClauses(text: string): Map<number, Date[]> {
    const byRank = new Map<number, Date[]>();

    for (const match of text.matchAll(DAY_OF_CLAUSE)) {
        if (match.index === undefined) continue;

        // The day can sit on either side of "day of", so the clause is read
        // from the words leading into it as well as the words after.
        const lead = text.slice(
            Math.max(0, match.index - DAY_OF_LEAD_CHARS),
            match.index,
        );
        const clause = `${lead} ${match[1]}`;

        const month = only([...clause.matchAll(MONTH_NAME)].map((found) => found[1]!));
        const day = only([...clause.matchAll(DAY_NUMBER)].map((found) => Number(found[1])));
        if (month === null || day === null) continue;

        const dated = calendarDate(Number(match[2]), monthNumber(month), day);
        if (!dated) continue;

        const rank = clauseRank(text, match.index);
        byRank.set(rank, [...(byRank.get(rank) ?? []), dated]);
    }

    return byRank;
}

/** The one date a list agrees on, or null when it names several. */
function agreedDate(dates: Date[]): Date | null {
    if (dates.length === 0) return null;
    const first = dates[0]!;
    return dates.every((date) => date.getTime() === first.getTime())
        ? first
        : null;
}

/**
 * The date the document states, or null if it does not state one.
 *
 * A bill's own clauses come first -- "presented for first reading this 8th day
 * of September", "considering this 2nd day of September" -- because that is
 * the day the Senate did something, which is what a reader looking for a bill
 * is looking for. The caption is read next, and Drive's createdTime never: that
 * is when somebody copied the template.
 */
export function dateFromDocument(input: IdentityInput): Date | null {
    const text = header(input.title, input.content);

    const clauses = datesFromDayOfClauses(text);
    for (const rank of [...clauses.keys()].sort((a, b) => b - a)) {
        const agreed = agreedDate(clauses.get(rank)!);
        if (agreed) return agreed;
    }

    return (
        agreedDate(datesFromDatedBillNumbers(text)) ??
        agreedDate(datesFromBillNumbers(text))
    );
}

/**
 * How far into a document its own date can still be a byline, in lines.
 *
 * A report puts the day it was written under its title, and minutes put the
 * day they were taken under theirs. Further down, a date is something the
 * document is talking about rather than something it is claiming about itself.
 */
const BYLINE_LINES = 12;

/** A byline is a line. A paragraph mentioning a date is prose. */
const BYLINE_CHARS = 100;

/**
 * How many words a byline may carry besides the date itself.
 *
 * "September 8th, 2026 | 07:00 PM EST | BSC 404" is a byline with three words
 * of furniture on it; "The committee met on 3 February 2026 to discuss it" is a
 * sentence about a date, and dating a document by it would file a report under
 * the meeting it describes. Four is the line between the two.
 */
const BYLINE_MAX_WORDS = 4;

/** Everything a date is written with: the numbers, the months, the ordinals. */
const DATE_CHARACTERS = new RegExp(
    `\\d+(?:st|nd|rd|th)?|\\b(?:${MONTHS.join("|")})\\b`,
    "gi",
);

/** Whether a line is a date with a little furniture, rather than a sentence. */
function readsAsByline(line: string): boolean {
    const rest = line.replace(DATE_CHARACTERS, " ");
    return (rest.match(/[A-Za-z]{2,}/g) ?? []).length <= BYLINE_MAX_WORDS;
}

/**
 * The date a document prints under its own title, or null.
 *
 * "May 8th, 2019" on the third line of a report is the report's date, and
 * without reading it the archive falls back to Drive -- which for a document
 * drafted over a fortnight is a date the document never claims. Lines that
 * disagree date nothing, since a document that opens by naming two days is
 * dating something other than itself.
 */
function bylineDate(content: string): Date | null {
    const dates = new Set<string>();

    const lines = content
        .slice(0, HEADER_CHARS)
        .split(/\r?\n/)
        .map((line) => toPlainText(line))
        .filter(Boolean)
        .slice(0, BYLINE_LINES);

    for (const line of lines) {
        if (line.length > BYLINE_CHARS || !readsAsByline(line)) continue;
        const iso = meetingDate(line);
        if (iso) dates.add(iso);
    }

    if (dates.size !== 1) return null;

    const [year, month, day] = [...dates][0]!.split("-").map(Number);
    return calendarDate(year!, month!, day!);
}

/**
 * The date to file a document under, or null if it names none.
 *
 * `dateFromDocument` is the document arguing about itself in a clause written
 * to be quoted, and wins. A meeting does not: it states its date in its title
 * and nowhere else, which is why that is read next. Without it most of the
 * archive is undated, since minutes and agendas are most of what the archive
 * holds -- and a reader asking what happened last week is asking about exactly
 * those. A byline is read last, being the weakest of the three: it is a line
 * that happens to sit where a date belongs rather than a date that says what
 * it is for.
 *
 * Drive's createdTime is deliberately not a fallback here. It is the day
 * somebody copied a template, and a caller that wants it should say so.
 */
export function documentDate(input: {
    title: string;
    content?: string;
    driveCreatedTime?: Date | null;
}): Date | null {
    const stated = dateFromDocument(input);
    if (stated) return stated;

    const meeting = meetingDate(input.title, input.driveCreatedTime ?? null);
    if (meeting) {
        const [year, month, day] = meeting.split("-").map(Number);
        const dated = calendarDate(year!, month!, day!);
        if (dated) return dated;
    }

    return input.content ? bylineDate(input.content) : null;
}

/**
 * The session a date falls in.
 *
 * Sessions run with the academic year, and the boundary is June rather than
 * September because the SGA turns over after the spring elections: the summer's
 * meetings are minuted by the incoming session and filed in its folder. So May
 * 2019 is the 106th, which sat from 2018, and June 2026 is the 114th.
 */
export function sessionForDate(date: Date): number | null {
    const month = date.getUTCMonth() + 1;
    const year = date.getUTCFullYear();
    return sessionFromAcademicYearStart(month >= 6 ? year : year - 1);
}

/**
 * The session a linked-in document should carry.
 *
 * Folder-walked files should not call this: the enclosing master folder is the
 * filing, and is not to be second-guessed from a mention of another year in
 * the text. A linked-in file has no such filing, and inheriting the session of
 * whichever agenda pointed at it is a guess like any other -- a worse one than
 * anything the document says about itself. So a caption wins, and where there
 * is no caption the date the document states does: a report on the 2018/2019
 * referendum belongs to the 106th SGA that ran it, not to the 113th that was
 * still citing it seven years later.
 */
export function linkedSession(input: IdentityInput, inherited: number): number {
    // The filename is a caption too, and a caption somebody typed on purpose.
    // "S.B.23-24.01 Rules Bill" was copied from the year before and still says
    // 2022-2023 in its own prose; the name it was filed under is the better
    // evidence of which session claimed it.
    const titled = sessionFromDocument({ title: input.title });
    if (titled !== null) return titled;

    const named = collectSessions(header(input.title, input.content));
    if (named.size === 1) return [...named][0]!;

    // A document that names several sessions is citing at least one of them.
    // Its date cannot settle which is which -- a rules bill adopted in April
    // sits in one academic year and governs the next -- so nothing is guessed.
    if (named.size > 1) return inherited;

    const dated = documentDate(input);
    return (dated ? sessionForDate(dated) : null) ?? inherited;
}

/** Re-export so callers dating a document can also name the year it sits in. */
export { academicYearStart };
