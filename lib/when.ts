/**
 * Reading a date range out of a question.
 *
 * "What happened last week" is a real question about this archive, and it has
 * nothing in common with "how many caucus senators can there be". There is no
 * word in it to match: "happened" appears nowhere in the documents, "last" and
 * "week" appear in all of them, and full-text search answers it with noise and
 * then with an apology.
 *
 * What the reader named is a range of dates, and the archive knows the date of
 * every document it holds. So the range is parsed out first, the words that
 * expressed it are dropped from the search terms, and the range is what selects
 * the documents. Whatever terms survive only order them.
 *
 * Ranges are half-open, `start` inclusive and `end` exclusive, and resolved
 * against Baltimore's calendar for the same reason lib/dates.ts formats there:
 * a document filed at 9pm on a Friday belongs to Friday, not to Saturday.
 */

const ZONE = "America/New_York";

const MONTHS = [
    "january", "february", "march", "april", "may", "june",
    "july", "august", "september", "october", "november", "december",
];

const MONTH_ALTERNATION = MONTHS.join("|");

export type Timeframe = {
    /** Inclusive. */
    start: Date;
    /** Exclusive. */
    end: Date;
    /**
     * How the range reads back to the reader: "the past 7 days".
     *
     * Always phrased to follow "for", so one label works in a heading
     * ("Documents for the past 7 days"), in a sentence ("holds nothing for
     * the past 7 days") and in the prompt.
     */
    label: string;
    /** The words that expressed it, dropped before search terms are taken. */
    matched: string;
};

// ---------------------------------------------------------------------------
// Baltimore's calendar
// ---------------------------------------------------------------------------

function clockParts(instant: Date) {
    const formatted = new Intl.DateTimeFormat("en-US", {
        timeZone: ZONE,
        hour12: false,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
    }).formatToParts(instant);

    const read = (type: Intl.DateTimeFormatPartTypes) =>
        Number(formatted.find((part) => part.type === type)?.value ?? "0");

    // With hour12 off, Intl writes midnight as hour 24 rather than hour 0.
    return {
        year: read("year"),
        month: read("month"),
        day: read("day"),
        hour: read("hour") % 24,
        minute: read("minute"),
        second: read("second"),
    };
}

/** How far ahead of UTC the wall clock in Baltimore reads, at an instant. */
function zoneOffsetMs(instant: Date): number {
    const { year, month, day, hour, minute, second } = clockParts(instant);
    const wall = Date.UTC(year, month - 1, day, hour, minute, second);
    return wall - Math.floor(instant.getTime() / 1000) * 1000;
}

/**
 * Midnight in Baltimore on a civil date, as an instant.
 *
 * Resolved twice because the offset that applies is the one at the answer and
 * not the one at the guess, and the two differ by an hour across the Sunday in
 * March when a question asking for "the past 7 days" spans the change.
 */
function midnight(year: number, month: number, day: number): Date {
    const wall = Date.UTC(year, month - 1, day);
    const guess = new Date(wall - zoneOffsetMs(new Date(wall)));
    return new Date(wall - zoneOffsetMs(guess));
}

/** Midnight in Baltimore, `shiftDays` from the day an instant falls on. */
function startOfDay(instant: Date, shiftDays = 0): Date {
    const { year, month, day } = clockParts(instant);
    return midnight(year, month, day + shiftDays);
}

function startOfMonth(instant: Date, shiftMonths = 0): Date {
    const { year, month } = clockParts(instant);
    return midnight(year, month + shiftMonths, 1);
}

// ---------------------------------------------------------------------------
// Shapes a range comes in
// ---------------------------------------------------------------------------

const UNIT_DAYS: Record<string, number> = {
    day: 1,
    night: 1,
    week: 7,
    fortnight: 14,
    month: 30,
    quarter: 90,
    year: 365,
};

const COUNT_WORDS: Record<string, number> = {
    a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6,
    seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
    couple: 2, few: 3, several: 3,
};

/** "3 weeks" counted back from the end of today, as a range. */
function rolling(now: Date, count: number, unit: string, matched: string): Timeframe {
    const days = count * (UNIT_DAYS[unit] ?? 1);

    return {
        // Ending tomorrow rather than now, so a document filed this morning is
        // inside "the past 7 days" instead of just outside it.
        start: startOfDay(now, -(days - 1)),
        end: startOfDay(now, 1),
        label: days <= 31
            ? `the past ${plural(days, "day")}`
            : count === 1
                ? `the past ${unit}`
                : `the past ${plural(count, unit)}`,
        matched,
    };
}

function plural(count: number, noun: string): string {
    return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/**
 * The academic term a date sits in.
 *
 * August through December is the autumn term and January through July the
 * spring, which is coarse but is how the SGA's own year is shaped: a session
 * runs across one autumn and the spring after it.
 */
function term(instant: Date, previous: boolean): { start: Date; end: Date } {
    const { year, month } = clockParts(instant);
    const autumn = month >= 8;

    if (!previous) {
        return {
            start: autumn ? midnight(year, 8, 1) : midnight(year, 1, 1),
            end: startOfDay(instant, 1),
        };
    }

    return autumn
        ? { start: midnight(year, 1, 1), end: midnight(year, 8, 1) }
        : { start: midnight(year - 1, 8, 1), end: midnight(year, 1, 1) };
}

function monthNumber(name: string): number {
    return MONTHS.indexOf(name.toLowerCase()) + 1;
}

// ---------------------------------------------------------------------------
// The patterns
// ---------------------------------------------------------------------------

const COUNTED =
    new RegExp(
        String.raw`\b(?:in|over|during|within|from)?\s*(?:the\s+)?(?:last|past|previous|preceding|prior)\s+(\d{1,3}|${Object.keys(COUNT_WORDS).join("|")})\s+(?:of\s+)?(day|night|week|fortnight|month|quarter|year)s?\b`,
        "i",
    );

const NAMED =
    /\b(?:in|over|during|within)?\s*(?:the\s+)?(?:last|past|previous|preceding|prior)\s+(day|night|week|fortnight|month|quarter|semester|term|year)\b/i;

const CURRENT = /\b(?:so\s+far\s+)?this\s+(week|month|semester|term|year)\b/i;

const TODAY = /\b(today|tonight)\b/i;

const YESTERDAY = /\byesterday\b/i;

const SINCE_MONTH =
    new RegExp(String.raw`\bsince\s+(${MONTH_ALTERNATION})(?:\s+(?:of\s+)?((?:19|20)\d{2}))?\b`, "i");

const SINCE_YEAR = /\bsince\s+((?:19|20)\d{2})\b/i;

const MONTH_YEAR =
    new RegExp(String.raw`\b(${MONTH_ALTERNATION})\s+(?:of\s+)?((?:19|20)\d{2})\b`, "i");

/**
 * A month on its own only counts after a preposition.
 *
 * "May" and "march" are ordinary English words, and a question about a march on
 * campus should not be answered with everything filed in the spring.
 */
const PREPOSED_MONTH =
    new RegExp(String.raw`\b(?:in|during|for|throughout)\s+(${MONTH_ALTERNATION})\b`, "i");

/** Same restraint for a bare year, which is otherwise half the budget bills. */
const PREPOSED_YEAR = /\b(?:in|during|for|from|throughout|of)\s+((?:19|20)\d{2})\b/i;

const RECENT =
    /\b(?:most\s+)?recent(?:ly)?\b|\blately\b|\bof\s+late\b|\bso\s+far\b|\blatest\b|\bnewest\b/i;

/** What "recently" is taken to mean, in days. */
const RECENT_DAYS = 30;

/**
 * The range a question names, or null if it names none.
 *
 * Checked most specific first, so "recent bills in April 2026" resolves to
 * April rather than to the last thirty days.
 */
export function parseTimeframe(question: string, now: Date = new Date()): Timeframe | null {
    const today = TODAY.exec(question);
    if (today) {
        return {
            start: startOfDay(now),
            end: startOfDay(now, 1),
            label: "today",
            matched: today[0],
        };
    }

    const yesterday = YESTERDAY.exec(question);
    if (yesterday) {
        return {
            start: startOfDay(now, -1),
            end: startOfDay(now),
            label: "yesterday",
            matched: yesterday[0],
        };
    }

    const counted = COUNTED.exec(question);
    if (counted) {
        const word = counted[1]!.toLowerCase();
        const count = COUNT_WORDS[word] ?? Number(word);
        if (Number.isFinite(count) && count > 0) {
            return rolling(now, count, counted[2]!.toLowerCase(), counted[0]);
        }
    }

    const named = NAMED.exec(question);
    if (named) {
        const unit = named[1]!.toLowerCase();

        if (unit === "semester" || unit === "term") {
            const { start, end } = term(now, true);
            return { start, end, label: "last semester", matched: named[0] };
        }

        return rolling(now, 1, unit, named[0]);
    }

    const current = CURRENT.exec(question);
    if (current) {
        const unit = current[1]!.toLowerCase();
        const end = startOfDay(now, 1);

        if (unit === "semester" || unit === "term") {
            return { ...term(now, false), label: "this semester", matched: current[0] };
        }

        if (unit === "week") {
            // Sunday-start, matching how the calendar is read locally. Local
            // midnight is 4 or 5am UTC on the same date, so the UTC weekday of
            // that instant is the local one.
            const weekday = startOfDay(now).getUTCDay();
            return {
                start: startOfDay(now, -weekday),
                end,
                label: "this week",
                matched: current[0],
            };
        }

        if (unit === "month") {
            return { start: startOfMonth(now), end, label: "this month", matched: current[0] };
        }

        return {
            start: midnight(clockParts(now).year, 1, 1),
            end,
            label: "this year",
            matched: current[0],
        };
    }

    const sinceMonth = SINCE_MONTH.exec(question);
    if (sinceMonth) {
        const month = monthNumber(sinceMonth[1]!);
        const year = sinceMonth[2] ? Number(sinceMonth[2]) : impliedYear(now, month);
        return {
            start: midnight(year, month, 1),
            end: startOfDay(now, 1),
            label: `${capitalise(sinceMonth[1]!)} ${year} onwards`,
            matched: sinceMonth[0],
        };
    }

    const sinceYear = SINCE_YEAR.exec(question);
    if (sinceYear) {
        const year = Number(sinceYear[1]);
        return {
            start: midnight(year, 1, 1),
            end: startOfDay(now, 1),
            label: `${year} onwards`,
            matched: sinceYear[0],
        };
    }

    const monthYear = MONTH_YEAR.exec(question);
    if (monthYear) {
        const month = monthNumber(monthYear[1]!);
        const year = Number(monthYear[2]);
        return {
            start: midnight(year, month, 1),
            end: midnight(year, month + 1, 1),
            label: `${capitalise(monthYear[1]!)} ${year}`,
            matched: monthYear[0],
        };
    }

    const preposedMonth = PREPOSED_MONTH.exec(question);
    if (preposedMonth) {
        const month = monthNumber(preposedMonth[1]!);
        const year = impliedYear(now, month);
        return {
            start: midnight(year, month, 1),
            end: midnight(year, month + 1, 1),
            label: `${capitalise(preposedMonth[1]!)} ${year}`,
            matched: preposedMonth[0],
        };
    }

    const preposedYear = PREPOSED_YEAR.exec(question);
    if (preposedYear) {
        const year = Number(preposedYear[1]);
        return {
            start: midnight(year, 1, 1),
            end: midnight(year + 1, 1, 1),
            label: String(year),
            matched: preposedYear[0],
        };
    }

    const recent = RECENT.exec(question);
    if (recent) {
        return rolling(now, RECENT_DAYS, "day", recent[0]);
    }

    return null;
}

/** A month named without a year is the most recent one that has happened. */
function impliedYear(now: Date, month: number): number {
    const { year, month: current } = clockParts(now);
    return month > current ? year - 1 : year;
}

function capitalise(word: string): string {
    return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}

/**
 * The question with the words that named the range taken out.
 *
 * Left in, "week" and "last" are searched for like any other word, and a
 * question about the past seven days is answered with every passage that
 * happens to contain the word "week".
 */
export function withoutTimeframe(question: string, timeframe: Timeframe | null): string {
    if (!timeframe) return question;
    return question.replace(timeframe.matched, " ");
}
