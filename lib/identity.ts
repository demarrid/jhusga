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
 */

import {
    academicYearStart,
    sessionFromAcademicYearStart,
} from "@/config/session";

/**
 * How much of the body is a caption rather than discussion.
 *
 * A bill names itself in the heading; an agenda that later cites last year's
 * minutes must not inherit that session. Two thousand characters covers a
 * long enacting clause and stops before the body starts citing other years.
 */
const HEADER_CHARS = 2_000;

/** "2026-2027", "2026-27", "2026–2027". */
const ACADEMIC_YEAR =
    /\b((?:19|20)\d{2})\s*(?:[-–—]|to)\s*((?:19|20)?\d{2})\b/gi;

/**
 * Bill numbers as the SGA writes them: "S.B.26-27", "S-B.26-27",
 * "SGA-B-2627", optionally followed by a date ("S.B.26-27.21.04-1",
 * "{S-B.26-27 04.21.26-1}").
 */
const BILL_NUMBER =
    /(?:S\.?\s*-?\s*B\.?|SGA-B-)\s*(\d{2})[-–—]?(\d{2})(?:[.\s]+(\d{1,2})[./](\d{1,2})(?:[./-](\d{2,4}))?)?/gi;

/** "114th session", "114th legislative session", "114th SGA". */
const SESSION_PHRASE =
    /\b(\d{1,3})(?:st|nd|rd|th)\s+(?:legislative\s+)?(?:session|sga)\b/gi;

/** "21ST DAY OF APRIL IN THE YEAR 2026". */
const ENACTING_DATE =
    /\b(\d{1,2})(?:st|nd|rd|th)?\s+day of\s+(january|february|march|april|may|june|july|august|september|october|november|december)\s+(?:in the year\s+)?((?:19|20)\d{2})\b/i;

const MONTHS = [
    "january", "february", "march", "april", "may", "june",
    "july", "august", "september", "october", "november", "december",
];

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

    for (const match of text.matchAll(SESSION_PHRASE)) {
        const session = Number(match[1]);
        if (session >= 1 && session <= 300) sessions.add(session);
    }

    return sessions;
}

function header(title: string, content?: string): string {
    const body = content ? content.slice(0, HEADER_CHARS) : "";
    return `${title}\n${body}`;
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

function datesFromEnactingClause(text: string): Date[] {
    const match = ENACTING_DATE.exec(text);
    if (!match) return [];
    const dated = calendarDate(Number(match[3]), monthNumber(match[2]!), Number(match[1]));
    return dated ? [dated] : [];
}

/**
 * The date the document states, or null if it does not state one.
 *
 * Prefers an enacting clause ("considered this 21st day of April") over a
 * bill-number caption, and ignores Drive createdTime entirely -- that is
 * when the file was copied, not when the Senate considered it.
 */
export function dateFromDocument(input: IdentityInput): Date | null {
    const text = header(input.title, input.content);
    const enacted = datesFromEnactingClause(text);
    if (enacted.length === 1) return enacted[0]!;

    const numbered = datesFromBillNumbers(text);
    if (numbered.length === 0) return null;

    const first = numbered[0]!.getTime();
    if (numbered.every((date) => date.getTime() === first)) return numbered[0]!;
    return null;
}

/**
 * The session a linked-in document should carry.
 *
 * A caption that names a session wins over the session inherited from the
 * documents that pointed here. Folder-walked files should not call this:
 * the enclosing master folder is the filing, and is not to be second-guessed
 * from a mention of another year in the text.
 */
export function linkedSession(input: IdentityInput, inherited: number): number {
    return sessionFromDocument(input) ?? inherited;
}

/** Re-export so callers dating a document can also name the year it sits in. */
export { academicYearStart };
