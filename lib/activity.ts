/**
 * What the home page can say just happened.
 *
 * Three lanes, and a document has to have cleared a bar before it can appear
 * in any of them. A resolution or a bill appears only when Senate minutes
 * record that the Senate passed it. A meeting appears only as minutes, and
 * only once its date is today or earlier -- an agenda is a plan, and a plan
 * is not yet something that happened.
 *
 * Passage is read out of the minutes rather than out of the bill. The bill
 * file is the text that was put in front of the Senate; it still says
 * "presented for first reading" after the vote. The minutes are where "motion
 * to pass, passed" is written down. A committee recommendation is not that
 * vote, and neither is a motion to table or refer that itself passed.
 */

import { documentDate } from "@/lib/identity";
import { extractDocumentLinks } from "@/lib/links";
import { toPlainText } from "@/lib/markdown";
import { compareNamesBySurname, nameKey } from "@/lib/contributors";

/** How many cards one lane of the home carousel shows. */
export const ACTIVITY_CARD_LIMIT = 3;

/** Kept in the archive, excluded only from homepage editorial highlights. */
export function isHomepageHighlight(driveFileId: string): boolean {
    return driveFileId !== "1GfPEmdmayF7MwY4R1XQq9YKG3KzIdYz-D1NQr8yPvDo";
}

/** A resolution may be signed by the body collectively rather than individuals. */
export function collectiveResolutionAuthor(content: string): string {
    return toPlainText(content).match(/\bIn solidarity with our students,\s*(?:The\s+)?(\d{1,3}(?:st|nd|rd|th)\s+Student Government Association)\b/i)?.[1] ?? "";
}

const ZONE = "America/New_York";

export type ActivityLaneId = "resolutions" | "meetings" | "bills";

export type ActivityCard = {
    id: string;
    href: string;
    title: string;
    dateLabel: string;
    summary: string;
    /** Introducer and sponsors, or the person who took the minutes. */
    authors: string;
    /** "Passed" for legislation, "Minutes" for a meeting that was held. */
    status: string;
};

export type ActivityLane = {
    id: ActivityLaneId;
    label: string;
    cards: ActivityCard[];
};

export const ACTIVITY_LANE_ORDER: { id: ActivityLaneId; label: string }[] = [
    { id: "resolutions", label: "Resolutions" },
    { id: "meetings", label: "Meetings" },
    { id: "bills", label: "Bills" },
];

/** A bill or resolution the minutes say the Senate passed, linked by file id. */
export type PassedLegislation = {
    fileId: string;
    anchor: string;
};

const PASS_MOTION =
    /\b(?:motion|moved|moves)\s+to\s+pass(?:\s+(?:the\s+)?bill)?\b(?!\s+(?:over|on|to)\b)/i;

/** "Bill passes" / "the bill passed", not "passing bills" or "bill to pass". */
const BILL_PASSES = /\bbills?\s+pass(?:es|ed)?\b/i;

const RESULT = /\b(?:passed|passes)\b/i;
const FAIL = /\b(?:fail(?:s|ed)?|lost|rejected)\b/i;
const NOT_PASSED = /\b(?:not|never)\s+pass(?:ed|es)?\b/i;
const RESULT_ONLY = /^(?:passed|passes)[!?.]*$/i;
const FAIL_ONLY = /^(?:failed|fails|lost|rejected)[!?.]*$/i;

/** A paragraph that mentions passage is discussion, not the vote line. */
const VOTE_LINE = 120;

const LIST_MARKER = /^(\d{1,3}|[a-z]|[ivxlcdm]{1,6})\\?[.)]\s+(\S.*)$/i;

type Row = {
    indent: number;
    list: boolean;
    /** The line with its list marker removed, so "1. Bill passes" is "Bill passes". */
    text: string;
    raw: string;
};

function indentWidth(prefix: string): number {
    return prefix.replace(/\t/g, "  ").length;
}

/**
 * Outlook wraps Drive links when minutes are pasted from email. The file id
 * is in the inner url, which is what the archive stored the bill under.
 */
function unwrapSafeLinks(markdown: string): string {
    return markdown.replace(
        /https?:\/\/[^\s)]*safelinks\.protection\.outlook\.com\/[^\s)]+/gi,
        (url) => {
            const cleaned = url.replace(/\\([^A-Za-z0-9])/g, "$1");
            try {
                const inner = new URL(cleaned).searchParams.get("url");
                if (inner && /google\.com|sharepoint\.com/i.test(inner)) return inner;
            } catch {
                return url;
            }
            return url;
        },
    );
}

function rowsFrom(content: string): Row[] {
    const source = unwrapSafeLinks(content.replace(/<br\s*\/?>/gi, "\n"));

    return source.split("\n").map((raw) => {
        const split = /^([ \t]*)(.*)$/.exec(raw);
        const prefix = split?.[1] ?? "";
        const rest = split?.[2] ?? "";
        const marker = LIST_MARKER.exec(rest);

        return {
            indent: indentWidth(prefix),
            list: marker !== null,
            text: (marker?.[2] ?? rest).trim(),
            raw,
        };
    });
}

/**
 * Whether this list line is the heading of an instrument, not a remark that
 * happens to contain a link.
 *
 * "1. a. [Survey Tabling Bill](url)" is a heading. "See the [rules](url)" is
 * not, and must not start a second item in the middle of a debate.
 */
function leadsWithLink(text: string): boolean {
    let rest = text.trim();

    for (let depth = 0; depth < 3; depth += 1) {
        rest = rest.replace(/^(?:\*\*|__|\*|_|~~)+/, "").trim();
        const nested = /^(?:\d{1,3}|[a-z]|[ivxlcdm]{1,6})\\?[.)]\s+/i.exec(rest);
        if (!nested) break;
        rest = rest.slice(nested[0].length).trim();
    }

    return rest.startsWith("[");
}

function billPassesLine(line: string): boolean {
    if (line.length > VOTE_LINE) return false;
    if (!BILL_PASSES.test(line)) return false;
    if (FAIL.test(line) || NOT_PASSED.test(line)) return false;
    // "Passed in finance committee" is the committee's recommendation. The
    // Senate's own vote is a later line, and this one must not stand in for it.
    if (/\b(?:committee|recommendation|reading)\b/i.test(line)) return false;
    return true;
}

/**
 * Whether this line records the Senate adopting the instrument.
 *
 * A motion carries when the same line says it passed, or when the next
 * indented line is nothing but "passed" / "passes". "Motion to table, passed"
 * is a different motion and is ignored. So is "motion to pass" with no result,
 * which is how minutes record a vote that was moved and not yet taken.
 */
function passageCarried(block: Row[], index: number): boolean {
    const line = block[index]!.text;
    if (billPassesLine(line)) return true;

    const motion = PASS_MOTION.exec(line);
    if (!motion) return false;

    const after = line.slice(motion.index + motion[0].length);
    // Adopting an amendment or passing a committee motion does not adopt the bill.
    if (/^\s+(?:the\s+)?(?:amendment|section|clause|motion)\b/i.test(after)) return false;
    if (/\bcommittee\b/i.test(line)) return false;
    if (FAIL.test(after) || NOT_PASSED.test(after)) return false;
    if (RESULT.test(after)) return true;

    const indent = block[index]!.indent;
    let passed = false;
    let failed = false;

    for (let cursor = index + 1; cursor < block.length; cursor += 1) {
        const child = block[cursor]!;
        if (!child.text) continue;
        if (child.indent <= indent) break;
        if (RESULT_ONLY.test(child.text)) passed = true;
        if (FAIL_ONLY.test(child.text)) failed = true;
    }

    return passed && !failed;
}

function blockEnd(rows: Row[], start: number): number {
    const origin = rows[start]!.indent;

    for (let index = start + 1; index < rows.length; index += 1) {
        const row = rows[index]!;
        if (!row.text) continue;
        if (row.list && leadsWithLink(row.text)) return index;
        if (row.indent <= origin) return index;
    }

    return rows.length;
}

/**
 * Instruments Senate minutes record as passed.
 *
 * Each linked heading is one item. The vote has to fall inside that item, so
 * a motion under the next bill is not borrowed by the one before it. The
 * first link on the heading is the instrument; a link mentioned later in the
 * debate is somebody citing a document, not a second thing that passed.
 */
export function passedLegislation(content: string): PassedLegislation[] {
    const rows = rowsFrom(content);
    const found: PassedLegislation[] = [];
    const seen = new Set<string>();

    for (let index = 0; index < rows.length; index += 1) {
        const heading = rows[index]!;
        if (!heading.list || !leadsWithLink(heading.text)) continue;

        const block = rows.slice(index, blockEnd(rows, index));
        const carried = block.some((_, line) => passageCarried(block, line));
        if (!carried) continue;

        const link = extractDocumentLinks(heading.raw)[0];
        if (!link || seen.has(link.fileId)) continue;

        seen.add(link.fileId);
        found.push({ fileId: link.fileId, anchor: link.text.trim() });
    }

    return found;
}

const EXCLUDED_KIND =
    /^(?:presentation|template|attendance|directory|tracker|unknown)$/;

/**
 * Which carousel lane a document belongs in, once minutes have said it passed.
 *
 * Resolutions are bills in the archive's taxonomy -- both are legislation --
 * but the Senate numbers and titles them apart, and the carousel does too.
 * The title and the opening caption are what decide it. A funding bill that
 * mentions a resolution later in its sections stays a bill.
 */
export function legislationLane(input: {
    title: string;
    kind: string;
    content?: string;
}): "resolution" | "bill" | null {
    const title = input.title.trim();
    const kind = input.kind;

    if (/\btemplate\b/i.test(title) || /voting records/i.test(title)) return null;
    if (
        kind.startsWith("minutes.") ||
        kind.startsWith("newsletter.") ||
        kind.startsWith("guiding.") ||
        kind.startsWith("judicial.")
    ) {
        return null;
    }
    if (EXCLUDED_KIND.test(kind)) return null;

    if (kind === "resolution" || /\bresolutions?\b/i.test(title)) return "resolution";

    const head = toPlainText((input.content ?? "").slice(0, 1_500));
    // The caption sits under a letterhead, so "S. Resolution 26-27" is not the
    // first words of the file. A title that already calls itself a bill is
    // not re-read as a resolution because the body cites one.
    const titledAsBill = /\bbills?\b|\bact\b/i.test(title);
    if (!titledAsBill && /\bS\.?\s*Resolutions?\b/i.test(head)) return "resolution";
    if (kind.startsWith("bill.")) return "bill";
    return null;
}

/** "Copy of Senate GBM #4" is a duplicate somebody made, not a second meeting. */
export function isCopyTitle(title: string): boolean {
    return /^\s*copy of\b/i.test(title);
}

/**
 * A member's own folder. Their notes of a Senate meeting are not the Senate's
 * minutes, and reading a vote out of them would let one person's draft decide
 * what the carousel says passed.
 */
export function isPersonalMinutes(folderPath: string): boolean {
    return /(?:^|\/)[^/]*'s folder(?:\/|$)/i.test(folderPath);
}

export function countsAsOccurredMeeting(input: {
    kind: string;
    meetingRole: string;
    title: string;
    folderPath: string;
}): boolean {
    return (
        input.kind.startsWith("minutes.") &&
        input.meetingRole === "minutes" &&
        !isCopyTitle(input.title) &&
        !isPersonalMinutes(input.folderPath)
    );
}

/** Senate minutes the passage reader is willing to trust. */
export function countsAsSenateRecord(input: {
    kind: string;
    meetingRole: string;
    title: string;
    folderPath: string;
}): boolean {
    return input.kind === "minutes.senate" && countsAsOccurredMeeting(input);
}

/**
 * Calendar day in Baltimore, so a noon-UTC stored date stays on the day it names.
 *
 * Built from the named parts rather than a locale's date string. `en-CA` is
 * not a reliable YYYY-MM-DD on every machine, and a day string that comes
 * back "9/1/2026" does not sort against "10/13/2026".
 */
export function calendarDay(date: Date): string {
    const parts = new Intl.DateTimeFormat("en-US", {
        timeZone: ZONE,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    }).formatToParts(date);
    const value = (type: Intl.DateTimeFormatPartTypes) =>
        parts.find((part) => part.type === type)?.value ?? "";

    return `${value("year")}-${value("month")}-${value("day")}`;
}

/** A meeting dated tomorrow has not happened, even if the agenda is already filed. */
export function hasOccurred(when: Date, now: Date): boolean {
    return calendarDay(when) <= calendarDay(now);
}

/**
 * When a document happened.
 *
 * The date it states wins, including the one rewritten into a meeting title.
 * Drive's created time is not a fallback: that is the day a template was
 * copied, which is how an undated file would otherwise outrank last night's
 * meeting.
 */
export function activityDate(input: {
    title: string;
    displayTitle?: string;
    datedAt?: Date | null;
    driveCreatedTime?: Date | null;
}): Date | null {
    if (input.datedAt) return input.datedAt;

    return documentDate({
        title: input.displayTitle || input.title,
        driveCreatedTime: input.driveCreatedTime,
    });
}

export type MinutesCandidate = {
    meetingKey: string;
    folderPath: string;
    title: string;
    when: number;
};

/**
 * Which copy of a meeting to show when the archive holds more than one.
 *
 * The folder the body files its minutes in outranks a second export. Personal
 * copies are already dropped; this is for two official files that share a key.
 */
export function minutesPreference(input: { folderPath: string; title: string }): number {
    let score = 0;
    if (/general body meetings\/minutes/i.test(input.folderPath)) score += 8;
    if (/minutes for executive/i.test(input.folderPath)) score += 8;
    if (/committee minutes|meeting minutes/i.test(input.folderPath)) score += 5;
    if (/\/minutes(?:\/|$)/i.test(input.folderPath)) score += 2;
    if (isPersonalMinutes(input.folderPath)) score -= 6;
    if (isCopyTitle(input.title)) score -= 8;
    return score;
}

/**
 * The names along the bottom of a legislation card.
 *
 * The introducer is named first. Sponsors follow, and a person who is both
 * is named once. Order within each role is by surname, which is how the
 * rest of the archive lists people.
 */
export function authorLine(people: { role: string; name: string }[]): string {
    const introducers: string[] = [];
    const sponsors: string[] = [];

    for (const person of people) {
        if (person.role === "introducer" || person.role === "author") introducers.push(person.name);
        else if (person.role === "sponsor") sponsors.push(person.name);
    }

    const seen = new Set<string>();
    const names: string[] = [];

    for (const name of [
        ...introducers.sort(compareNamesBySurname),
        ...sponsors.sort(compareNamesBySurname),
    ]) {
        const key = nameKey(name);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        names.push(name);
    }

    return names.join(", ");
}

/** One card per meeting, newest first. */
export function chooseMeetings<T extends MinutesCandidate>(items: T[], limit: number): T[] {
    const best = new Map<string, T>();
    const loose: T[] = [];

    for (const item of items) {
        if (!item.meetingKey) {
            loose.push(item);
            continue;
        }

        const current = best.get(item.meetingKey);
        if (!current || minutesPreference(item) > minutesPreference(current)) {
            best.set(item.meetingKey, item);
        }
    }

    return [...best.values(), ...loose]
        .sort((left, right) => right.when - left.when || left.title.localeCompare(right.title))
        .slice(0, limit);
}

/** A filled-in enactment line is evidence; committee votes and XX templates are not. */
export function recordedResolutionPassage(content: string): boolean {
    const match = toPlainText(content).match(/\bThe Resolution hereby PASSES by a vote of (\d+) to (\d+) with (\d+) abstentions?\b/i);
    return !!match && Number(match[1]) > Number(match[2]);
}
