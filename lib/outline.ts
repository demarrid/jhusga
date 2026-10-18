/**
 * The sections a reader can jump to in a document.
 *
 * Google Docs exports almost none of this as markdown headings. An agenda is a
 * numbered list whose items are bold labels ("Call to Order"), with lettered
 * and roman lines underneath. A constitution is "ARTICLE IV" or an italic
 * "Section One" on its own line. Minutes that were typed as a transcript have
 * neither, and the sections are the short labels the author left between
 * speeches ("Office of Institutional Equity", "<Cabinet reports>").
 *
 * The outline is derived from the stored text, and each entry is keyed by the
 * offset of the line it came from. lib/render.ts stamps that same key onto the
 * block it draws for the line, so the sidebar and the page agree on a target
 * without moving a character a citation might index.
 */

export type DocumentSection = {
    id: string;
    title: string;
    children: DocumentSection[];
    href?: string;
    documentLinks?: { title: string; href: string }[];
    /**
     * A caption over a run of sections rather than a place in the text --
     * "Agenda" and "Minutes" when a file holds both. There is nothing on the
     * page to scroll to, so it is not a link.
     */
    group?: true;
};

type Line = { text: string; start: number };

type MarkerKind = "number" | "letter" | "roman" | "bullet" | "heading";

type Frame = {
    level: number;
    indent: number;
    /** A numbered, lettered, roman, or bulleted label, as opposed to a heading. */
    outline: boolean;
    /** A `#` heading, which is the author's own outline and outranks the rest. */
    markdown: boolean;
    marker: MarkerKind;
};

const RULE = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/;
const HASH_HEADING = /^\s*(#{1,6})\s+(\S.*?)\s*#*\s*$/;
const LIST_HEADING = /^(\s*)(?:\d{1,3}[.)]|[-*+])\s+(#{1,6})\s+(\S.*?)\s*#*\s*$/;
const QUOTE = /^\s*(?:>\s?)+/;
const NUMBER_WORD =
    "one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve";
const STRUCTURAL = new RegExp(
    `^(article|section|amendment|title|chapter|part|clause)\\s+((?:${NUMBER_WORD})|[ivxlcdm]+|\\d+)\\b[:\\s\\-—]*(.*)$`,
    "i",
);
const SENTENCE_VERB =
    /\b(is|are|was|were|be|been|shall|will|would|should|can|could|must|may|have|has|had|does|do|did)\b/i;
const STAGE = /^<([^>\n]{2,80})>$/;
const MONTH =
    /\b(jan(uary)?|feb(ruary)?|mar(ch)?|apr(il)?|may|june?|july?|aug(ust)?|sept?(ember)?|oct(ober)?|nov(ember)?|dec(ember)?)\b/i;
/** More than this is an index, not something a reader can scan beside the text. */
const MAX_SECTIONS = 60;

/**
 * A label rather than a sentence.
 *
 * Agenda items and section titles are short and do not predicate anything.
 * Numbered clauses in a constitution ("The SGA will not restrict...") are
 * sentences, and listing every one of them would turn the outline into a
 * second copy of the document.
 */
function isLabel(plain: string): boolean {
    if (plain.length < 2 || plain.length > 110) return false;
    const words = plain.split(/\s+/);
    if (words.length > 16) return false;
    // "Shall assist the President..." is a duty, and a line that ends in a
    // period is a sentence. Agenda labels do neither.
    if (SENTENCE_VERB.test(plain)) return false;
    if (/[.!?\u2026]$/.test(plain)) return false;
    // A long line in sentence case is prose that happens to lack a verb from
    // the list: "Expecting around 48 people, with a possible rotation...".
    // Long agenda items are named things, and mostly capitalised.
    if (words.length > 8 && capitalisedShare(words) < 0.5) return false;
    return true;
}

function capitalisedShare(words: string[]): number {
    const significant = words.filter((word) => word.replace(/[^\p{L}]/gu, "").length > 3);
    if (significant.length === 0) return 0;
    return significant.filter((word) => /^[^\p{L}]*\p{Lu}/u.test(word)).length / significant.length;
}

/**
 * The meeting's own title is already the page heading. "AGENDA" is a divider.
 *
 * A file that keeps a semester of meetings -- "MEETING #1", "MEETING #2", one
 * after another -- is the exception: there the titles are the outline, and
 * `meetingsAreSections` keeps them.
 */
function isBanner(plain: string, meetingsAreSections: boolean): boolean {
    if (/^(agenda|minutes)$/i.test(plain)) return true;
    if (
        /^(the\s+)?(\d+(st|nd|rd|th)\s+)?(jhu\s+|johns hopkins\s+)?(student government(\s+association)?|sga)$/i.test(
            plain,
        )
    ) {
        return true;
    }
    // A News-Letter byline: "By ABBY SHEGELMAN · The Johns Hopkins News-Letter · ...".
    if (/^by\s/i.test(plain) && plain.includes("\u00b7")) return true;
    return !meetingsAreSections && isMeetingTitle(plain);
}

function isDatedMeetingHeading(plain: string): boolean {
    return /^\d{1,2}\/\d{1,2}(?:\/(?:\d{4}|\d{2}))?$/.test(plain)
        || /^meeting\s+#?\d+[a-z]?\s*[:—–-]/i.test(plain);
}

function isMeetingTitle(plain: string): boolean {
    return (
        plain.length < 120 &&
        (/\b(senate|sga|committee|executive)\b/i.test(plain) || /^meeting\s+#?\d+[a-z]?\b/i.test(plain)) &&
        /\bmeeting\b/i.test(plain) &&
        !/\b(call to order|reports|reading|business|adjourn)/i.test(plain)
    );
}

/**
 * A meeting's when-and-where line, not a title that happens to name a month.
 *
 * "Updated October 2024" is a policy. "October 13th, 2026 | 07:00 PM EST" is
 * the banner under the title, and it is already in the page header.
 */
function isDateLine(plain: string): boolean {
    // "10.11.2026" and "10/11/26" on their own are the committee template's banner.
    if (plain.length < 40 && /^\d{1,2}[./-]\d{1,2}[./-](\d{4}|\d{2})\b/.test(plain)) return true;
    // "3:30 PM EDT | IA.114.06". A clock time and a dash is a transcript's
    // own break instead; see `isBreakLine`.
    if (
        plain.length < 60 &&
        !plain.includes("\u2014") &&
        /^\d{1,2}(:\d{2})?\s*(a\.?m\.?|p\.?m\.?)(?=\s|$|[|,])/i.test(plain)
    ) {
        return true;
    }
    if (!/\b(19|20)\d{2}\b/.test(plain)) return false;
    // "September 12, 2023 / 07:00 PM / Hackerman B17" and "· November 12, 2015".
    if (/\b(am|pm)\b/i.test(plain) || plain.includes("|")) return true;
    return /[/\u00b7]/.test(plain) && MONTH.test(plain);
}

/**
 * "7:10 p.m. — Meeting called to order": a transcript's own section break.
 *
 * It is not title case, and it is not a speech. The em dash is what the
 * minutes use to set a moment apart from the speaker turns around it.
 */
function isBreakLine(plain: string): boolean {
    // The time is what makes it a section break. A remark that happens to end
    // in an em dash ("...first reading then—") is still a remark.
    if (!/^\d{1,2}:\d{2}\b/.test(plain) || !plain.includes("\u2014")) return false;
    if (plain.length < 8 || plain.length > 80) return false;
    return !isSpeaker(plain);
}

/**
 * A heading the author styled is still sometimes the meeting's banner, its
 * when-and-where line -- "# Senate Meeting #5", "## September 12, 2023 / 07:00
 * PM" -- or a whole paragraph someone set in a heading style.
 */
function isHeadingTitle(title: string, meetingsAreSections: boolean): boolean {
    return (
        title.length > 0 &&
        title.length <= 120 &&
        !RULE.test(title) &&
        !isBanner(title, meetingsAreSections) &&
        (!isDateLine(title) || (meetingsAreSections && (isMeetingTitle(title) || isDatedMeetingHeading(title))))
    );
}

/** Whether more than one line of the document is a meeting's title. */
function holdsSeveralMeetings(lines: Line[]): boolean {
    let found = 0;
    for (const line of lines) {
        const text = clean(line.text.replace(/^\s*(?:>\s?)*(?:(?:\d{1,3}[.)]|[-*+])\s+)?#{0,6}\s*/, ""));
        if ((isMeetingTitle(text) || isDatedMeetingHeading(text)) && ++found > 1) return true;
    }
    return false;
}

function isNoise(plain: string): boolean {
    if (plain.length < 2) return true;
    if (/^(script|scripts|silence|n\/a|none|nay|aye|abstain|second)$/i.test(plain)) return true;
    if (/^(aye|nay|abstain|second|motion)\b/i.test(plain)) return true;
    return false;
}

/**
 * "Jazz: Thank you" is a speaker taking the floor. "Student Body President:
 * Jason Yu" is an agenda line whose colon introduces a name, not a speech.
 */
function isSpeaker(plain: string): boolean {
    const match = /^([^:]{1,50}):\s*(\S.*)$/.exec(plain);
    if (!match) return false;
    const name = match[1]!.trim();
    const speech = match[2]!.trim();
    if (!/^[\p{L}]/u.test(name)) return false;
    const nameWords = name.split(/\s+/);
    if (nameWords.length > 4) return false;
    if (speech.length > 24 || /[.!?]/.test(speech)) return true;
    return nameWords.length <= 2 && speech.split(/\s+/).length >= 2;
}

function isTitleCase(plain: string): boolean {
    if (plain.length < 8 || plain.length > 70) return false;
    if (/[.!?\u2026]$/.test(plain) || /[.?!]\s/.test(plain)) return false;
    if (isSpeaker(plain) || isDateLine(plain) || isNoise(plain)) return false;
    // "Introduced by: Me" is a field, and "Rachel, Omar, Zoe, Srigouri" is
    // who came. Neither is the name of a part of the document.
    if (/:\s*\S/.test(plain) || (plain.match(/,/g)?.length ?? 0) >= 3) return false;
    const words = plain.split(/\s+/).filter((word) => /[\p{L}]/u.test(word));
    if (words.length < 2 || words.length > 10) return false;
    return capitalisedShare(words) >= 0.6;
}

/** Drop the export's emphasis, links, and escapes, leaving the words. */
function clean(text: string): string {
    return text
        .replace(/\s+\{#[^}\n]+\}\s*$/, "")
        .replace(/\\([^A-Za-z0-9\n])/g, "$1")
        .replace(/\[([^\]\n]*)\]\((?:\\.|[^)\n])*\)/g, "$1")
        .replace(/[*_~]/g, "")
        .replace(/\s+/g, " ")
        .trim();
}

function displayTitle(plain: string): string {
    return plain
        // "7:10 p.m. — Meeting called to order" is the moment, not the clock.
        .replace(/^\d{1,2}:\d{2}\s*(?:a\.m\.|p\.m\.)?\s*\u2014\s*/i, "")
        .replace(/:\s*$/, "")
        .trim();
}

function emphasis(text: string): { plain: string; wrapped: "bold" | "italic" | null } {
    const trimmed = text.trim();
    const bold = /^\*\*(.+)\*\*$/.exec(trimmed) ?? /^__(.+)__$/.exec(trimmed);
    if (bold) return { plain: clean(bold[1]!), wrapped: "bold" };
    const italic = /^\*(.+)\*$/.exec(trimmed) ?? /^_(.+)_$/.exec(trimmed);
    if (italic) return { plain: clean(italic[1]!), wrapped: "italic" };
    return { plain: clean(trimmed), wrapped: null };
}

type Mark = {
    indent: number;
    raw: string;
    kind: "number" | "letter" | "roman" | "bullet";
    /** 1 when the list starts over, which is a nested list rather than "b." under "a.". */
    value: number;
};

const ROMAN_VALUE: Record<string, number> = {
    i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8, ix: 9, x: 10, xi: 11, xii: 12,
};

function outlineMark(text: string): Mark | null {
    const number = /^(\s*)(\d{1,3})[.)]\s+(\S.*)$/.exec(text);
    if (number) return { indent: number[1]!.length, raw: number[3]!, kind: "number", value: Number(number[2]) };

    // Before the single-letter test, so "i." and "v." stay roman.
    const roman = /^(\s*)(xii|xi|x|ix|iv|viii|vii|vi|v|iii|ii|i)[.)]\s+(\S.*)$/i.exec(text);
    if (roman) {
        return {
            indent: roman[1]!.length,
            raw: roman[3]!,
            kind: "roman",
            value: ROMAN_VALUE[roman[2]!.toLowerCase()] ?? 1,
        };
    }

    const letter = /^(\s*)([a-z])[.)]\s+(\S.*)$/.exec(text);
    if (letter) {
        return { indent: letter[1]!.length, raw: letter[3]!, kind: "letter", value: letter[2]!.charCodeAt(0) - 96 };
    }

    const bullet = /^(\s*)[-*+]\s+(\S.*)$/.exec(text);
    if (bullet) return { indent: bullet[1]!.length, raw: bullet[2]!, kind: "bullet", value: 1 };

    return null;
}

function structuralLevel(keyword: string): number {
    const name = keyword.toLowerCase();
    return name === "section" || name === "clause" ? 3 : 2;
}

/**
 * "ARTICLE 3, SECTION 1" is the section, one step under the article. A line
 * that is only "ARTICLE 3" stays an article.
 */
function structuralDepth(keyword: string, plain: string): number {
    const base = structuralLevel(keyword);
    if (keyword.toLowerCase() === "article" && /,\s*section\b/i.test(plain)) return base + 1;
    return base;
}

/** "3.2.1 STUDENT BODY PRESIDENT" — a numbered heading, not "1. Call to Order". */
const DECIMAL_HEADING = /^(\d+(?:\.\d+)+)\s+(\S.*)$/;

const VOTE_RESULT = /^(pass(?:ed|es)?|fail(?:ed|s)?|tabled|adopted|lost|approved|rejected|seconded)$/i;

const INLINE_ARTICLE_SECTION = new RegExp(
    `^(article\\s+(?:(?:${NUMBER_WORD})|[ivxlcdm]+|\\d+)\\s*,\\s*section\\s+(?:(?:${NUMBER_WORD})|[ivxlcdm]+|\\d+))\\b`,
    "i",
);

/**
 * Where a decimal heading sits: under the article section, and deeper as the
 * number gains parts, so 4.1.2.5.1 nests under 4.1.2.
 */
function decimalLevel(number: string): number {
    return 3 + number.split(".").length - 1;
}

/**
 * A bylaws heading set in capitals, as opposed to a clause that happens to
 * start with its own number.
 *
 * "4.1.1 SENATORS" names a part of the article. "3.2.6.3 Organizes SGA
 * Tabling Events" and "3.2.6.3.5.8 The Bloomberg Student Center" are the
 * clause and one of its examples.
 */
function isProvisionHeading(plain: string): boolean {
    const match = DECIMAL_HEADING.exec(plain);
    if (!match) return false;
    const title = match[2]!.replace(/[:.\s]+$/, "").trim();
    if (title.length < 2 || title.length > 80) return false;
    if (SENTENCE_VERB.test(title) || /[.!?]$/.test(title)) return false;
    const letters = title.replace(/[^\p{L}]/gu, "");
    const capitals = title.replace(/[^\p{Lu}]/gu, "");
    return letters.length > 0 && capitals.length / letters.length >= 0.8;
}

/**
 * A numbered line that names a part of the meeting, rather than a note the
 * secretary typed under one.
 *
 * Agendas number their parts ("a. Judiciary confirmation", "Cabinet
 * Reports"). Minutes number the notes too ("Bring meetings with different
 * departments to GBM", "Luke", "passed"), and an outline of those is the
 * document again.
 */
function isOutlineEntry(plain: string): boolean {
    if (VOTE_RESULT.test(plain.trim()) || isBareName(plain)) return false;
    // Before the speaker test: "Bylaws Amendment: Choosing the CSAC
    // Representative" names a bill, and the colon is the title, not a speech.
    if (/\(\s*\d+\s*min(?:ute)?s?\s*\)/i.test(plain)) return true;
    if (/\b(bills?|resolutions?|amendments?|directives?)\b/i.test(plain) && !SENTENCE_VERB.test(plain)) {
        return true;
    }
    if (isSpeaker(plain)) return false;
    if (isRoleLine(plain)) return true;

    const words = plain.split(/\s+/);
    const share = headingShare(plain);
    // "Judiciary confirmation", "Cabinet Reports": a short name of a part.
    if (words.length <= 3 && share >= 0.5) return true;
    // A longer title is capitals. "Auditions due at October 4th" is a note:
    // the lowercase word is what makes it one, even when the names are capital.
    return words.length >= 2 && share >= 0.75;
}

/** Share of words of three letters or more that start with a capital. */
function headingShare(plain: string): number {
    const words = plain.split(/\s+/).filter((word) => word.replace(/[^\p{L}]/gu, "").length >= 3);
    if (words.length === 0) return 0;
    return words.filter((word) => /^[^\p{L}]*\p{Lu}/u.test(word)).length / words.length;
}

/** "Luke", "Srika". A one-word heading of the document is not a person's name. */
function isBareName(plain: string): boolean {
    const word = plain.replace(/:\s*$/, "");
    if (!/^\p{Lu}\p{Ll}{1,14}$/u.test(word)) return false;
    return !/^(attendance|adjournment|preamble|reports|minutes|agenda|closing|opening|business|announcements|legislation|quorum)$/i.test(
        word,
    );
}

/**
 * "Student Body President - Jason", "Secretary - Honora". The right-hand side
 * is a name. A remark after a colon is a speaker, and is rejected first.
 */
function isRoleLine(plain: string): boolean {
    const match = /^(.{2,80}?)\s+[-–—:]\s+(\p{Lu}[\p{L}'.-]*(?:\s+\p{Lu}[\p{L}'.-]*){0,2})$/u.exec(plain);
    if (!match) return false;
    const left = match[1]!.trim();
    if (/[.!?]/.test(match[2]!)) return false;
    const leftWords = left.split(/\s+/);
    if (leftWords.length > 8) return false;
    return leftWords.length === 1 || capitalisedShare(leftWords) >= 0.34;
}

function toLines(content: string): Line[] {
    const lines: Line[] = [];
    let start = 0;
    for (const text of content.split("\n")) {
        lines.push({ text: text.replace(/\r$/, ""), start });
        start += text.length + 1;
    }
    return lines;
}

function countSections(sections: DocumentSection[]): number {
    return sections.reduce((total, section) => total + 1 + countSections(section.children), 0);
}

type Index = { sections: DocumentSection[]; anchors: Map<number, string> };

/**
 * The line offset of every candidate section, and the id lib/render.ts stamps
 * on the block it draws for that line.
 *
 * This is a superset of what the sidebar lists: `documentSections` drops the
 * page's own title, entries the renderer had no block for, and whole levels
 * of a document too long to outline. An id on a block nobody links to costs
 * nothing.
 */
export function sectionAnchors(content: string): Map<number, string> {
    return indexSections(content).anchors;
}

export type OutlineOptions = {
    /** The names the page already shows in its own heading. */
    titles?: string[];
    /**
     * The section ids the rendered blocks carry. An entry without one would be
     * a link to nothing -- a bullet inside a spreadsheet cell, say, which the
     * sheet renderer draws as part of a table rather than a block of its own.
     */
    anchored?: ReadonlySet<string>;
    /** The document's kind, e.g. "minutes.committee". See `groupRepeats`. */
    kind?: string;
};

/**
 * The outline the sidebar shows. Empty when the document has nothing to list.
 *
 * Fewer than two sections is not an outline -- a title by itself, or a stub
 * with nothing to jump between. More than MAX_SECTIONS loses its deepest
 * level until it fits; a codebook whose top level alone is longer than that
 * is an index, and gets no outline at all.
 */
export function documentSections(
    content: string,
    options: OutlineOptions = {},
): DocumentSection[] {
    const titles = new Set((options.titles ?? []).map(comparable));
    const keep = (section: DocumentSection) =>
        (!options.anchored || options.anchored.has(section.id)) &&
        !titles.has(comparable(section.title));

    let sections = filterSections(dropRollCall(indexSections(content).sections), keep);
    for (let depth = maxDepth(sections); countSections(sections) > MAX_SECTIONS && depth > 1; depth -= 1) {
        sections = truncate(sections, depth - 1);
    }
    const count = countSections(sections);
    return count < 2 || count > MAX_SECTIONS ? [] : groupRepeats(sections, options.kind, content.length);
}

/**
 * Captions a run of top-level sections that the document goes through twice.
 *
 * Committee minutes are written into a copy of the agenda, and the file
 * keeps both: "Convening Business" to "Closing" as planned, then again with
 * the notes. Listed flat, the outline names every part twice with nothing to
 * say which is which.
 *
 * Only that shape is captioned: exactly two copies, in a set of minutes, the
 * second longer than the first because it has the notes in it. A notebook of
 * weekly meetings repeats its headings too, and calling those "Agenda" and
 * "Minutes" would be wrong; they stay as they are.
 */
function groupRepeats(
    sections: DocumentSection[],
    kind: string | undefined,
    length: number,
): DocumentSection[] {
    if (!kind?.startsWith("minutes")) return sections;
    const keys = sections.map((section) => comparable(section.title));
    const offset = (section: DocumentSection | undefined) =>
        section ? Number(section.id.slice("section-".length)) : length;

    for (let from = 0; from < sections.length; from += 1) {
        for (let run = 2; from + run * 2 <= sections.length; run += 1) {
            const first = keys.slice(from, from + run).join("\n");
            if (keys.slice(from + run, from + run * 2).join("\n") !== first) continue;
            // A third copy is a series, not an agenda and its minutes.
            if (keys.slice(from + run * 2, from + run * 3).join("\n") === first) return sections;

            const agenda = offset(sections[from + run]) - offset(sections[from]);
            const minutes = offset(sections[from + run * 2]) - offset(sections[from + run]);
            if (minutes <= agenda) return sections;

            const groups = ["Agenda", "Minutes"].map((title, index) => {
                const children = sections.slice(from + run * index, from + run * (index + 1));
                return { id: `group-${children[0]!.id}`, title, children, group: true as const };
            });
            return [...sections.slice(0, from), ...groups, ...sections.slice(from + run * 2)];
        }
    }

    return sections;
}

const ROLL_CALL_WORDS = new Set([
    "present", "absent", "absentees", "absences", "excused", "execused", "unexcused", "tardy",
    "tardies", "late", "quorum", "partial", "partially", "not", "members", "senators",
    "and", "or",
]);
const ROLL_CALL_CORE =
    /\b(present|absent|absentees|absences|excused|unexcused|tardy|tardies|late|quorum)\b/i;

/**
 * "Present", "Absent:", "ii. Unexcused", "Members Not Present": a slot in the
 * roll call, filled in with names. The part before a colon is the label, so
 * "Partial Excused: Mamadou Thiam" is one too.
 */
function isRollCall(title: string): boolean {
    // Minutes write the names after a dash as often as after a colon.
    const label = title.split(/:|\s[-\u2013\u2014]|[-\u2013\u2014]\s/)[0]!.toLowerCase().replace(/[()]/g, " ");
    const words = label.split(/[\s/&,-]+/).filter(Boolean);
    return (
        words.length > 0 &&
        ROLL_CALL_CORE.test(label) &&
        words.every((word) => ROLL_CALL_WORDS.has(word))
    );
}

/**
 * Drops each roll-call slot together with everything under it -- the names,
 * and "Excused" or "Unexcused" nested in "Absent". The item that holds the
 * roll call ("Call to Order & Roll Call") stays: it is a part of the meeting,
 * where who came is not something a reader jumps to.
 */
function dropRollCall(sections: DocumentSection[]): DocumentSection[] {
    return sections
        .filter((section) => !isRollCall(section.title))
        .map((section) => ({
            ...section,
            // "ATTENDANCE" is a part of the document a reader can jump to; the
            // groups under it -- "Committee Members", "Guests & Observers" --
            // are just more of the roll.
            children: ROLL_CALL_HEADING.test(section.title) ? [] : dropRollCall(section.children),
        }));
}

const ROLL_CALL_HEADING = /^(attendance|roll\s*call|roll)$/i;

function comparable(title: string): string {
    return title.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

/** Drops the entries `keep` rejects, and moves their children up to take their place. */
function filterSections(
    sections: DocumentSection[],
    keep: (section: DocumentSection) => boolean,
): DocumentSection[] {
    return sections.flatMap((section) => {
        const children = filterSections(section.children, keep);
        return keep(section) ? [{ ...section, children }] : children;
    });
}

function maxDepth(sections: DocumentSection[]): number {
    return sections.reduce((deepest, section) => Math.max(deepest, 1 + maxDepth(section.children)), 0);
}

function truncate(sections: DocumentSection[], depth: number): DocumentSection[] {
    return sections.map((section) => ({
        ...section,
        children: depth <= 1 ? [] : truncate(section.children, depth - 1),
    }));
}

function indexSections(content: string): Index {
    const anchors = new Map<number, string>();
    const sections: DocumentSection[] = [];
    const parents: DocumentSection[][] = [sections];
    const frames: Frame[] = [];
    let skippingContents = false;
    // Under "Signatures of Enactment" every line is a name or an office.
    let signing = false;
    // Bold lines before the first section or sentence. Several in a row are a
    // title block -- "Senate / of the / Student Government Association" on a
    // bill -- and one alone is a heading, "Attendance" over the names.
    let front: { title: string; at: number }[] | null = [];
    // Headings with text of their own under them, and the ones the author
    // styled with `#`. See `dropPlaceholders`.
    const bodied = new Set<DocumentSection>();
    const styled = new Set<DocumentSection>();
    let open: DocumentSection | null = null;

    function closeFront() {
        if (front === null) return;
        const pending = front;
        front = null;
        if (pending.length === 1) {
            const level = frames.some((frame) => frame.markdown) ? minorLevel() : 2;
            place(level, 0, false, false, "heading", pending[0]!.title, pending[0]!.at);
        }
    }

    /** A line of the document that is not a section: the open one has a body. */
    function body() {
        closeFront();
        if (open) bodied.add(open);
    }

    function place(
        level: number,
        indent: number,
        outline: boolean,
        markdown: boolean,
        marker: MarkerKind,
        title: string,
        at: number,
    ) {
        // Bold lines that run straight into a heading -- the room under the
        // date, "BSC 201 - Barber Boardroom" -- are the banner over it.
        if (markdown) front = null;
        else closeFront();
        const shown = displayTitle(title);
        if (shown.length < 2) return;
        signing = /^signatures?\b/i.test(shown);

        const node: DocumentSection = {
            id: `section-${at}`,
            title: shown,
            children: [],
        };

        while (frames.length > 0 && frames[frames.length - 1]!.level >= level) {
            frames.pop();
            parents.pop();
        }

        parents[parents.length - 1]!.push(node);
        frames.push({ level, indent, outline, markdown, marker });
        parents.push(node.children);
        anchors.set(at, node.id);
        open = node;
        if (markdown) styled.add(node);

        if (/^table of contents$/i.test(shown)) skippingContents = true;
    }

    /**
     * Where a label that is not itself numbered sits.
     *
     * Under a markdown heading it is one step below that heading, and a run of
     * them are siblings -- the topic lines in a set of minutes. With no such
     * heading, it tucks under the article or statement it follows.
     */
    function minorLevel(): number {
        for (let index = frames.length - 1; index >= 0; index -= 1) {
            if (frames[index]!.markdown) return frames[index]!.level + 1;
        }
        for (let index = frames.length - 1; index >= 0; index -= 1) {
            const frame = frames[index]!;
            if (!frame.outline && frame.level <= 2) return 3;
        }
        return 2;
    }

    /**
     * The level of a lettered or roman line under the agenda item it belongs to.
     *
     * Indent is the signal, and it is unreliable on its own: "1. Present" sits
     * at the same column as "1. **Call to Order**" and is still a child of it,
     * because the bold item is the parent and the plain one is not. A deeper
     * indent steps down; the same indent is another item at that depth.
     *
     * A list that starts again at 1 under the item above it is that item's
     * own list. "b." indented under "a." did not start over, and the export
     * indents it that way anyway, so it stays a sibling.
     */
    function outlineLevel(indent: number, kind: MarkerKind, value: number): number {
        if (kind !== "bullet") {
            for (let index = frames.length - 1; index >= 0; index -= 1) {
                const frame = frames[index]!;
                if (!frame.outline) break;
                if (frame.marker === kind && frame.indent === indent) return frame.level;
            }
        }

        let index = frames.length - 1;
        while (index >= 0 && frames[index]!.outline) {
            const frame = frames[index]!;
            // The export indents "b." and "c." under "a." even when they are
            // the same kind of item. A bullet between two roman lines is a
            // note on the one before it, not a new parent for the one after.
            const sameKind = kind !== "bullet" && frame.marker === kind;
            const crossedBullet = frame.marker === "bullet" && kind !== "bullet";
            const restarted = value === 1 && frame.indent < indent;
            if (frame.indent < indent && (!sameKind || restarted) && !crossedBullet) break;
            index -= 1;
        }
        const parent = index >= 0 ? frames[index]! : null;
        return (parent?.level ?? 0) + 1;
    }

    const lines = toLines(content);
    const meetings = holdsSeveralMeetings(lines);

    for (const line of lines) {
        let text = line.text;
        let at = line.start;

        // The committee template pads every heading with empty `##` lines.
        if (text.trim().length === 0 || RULE.test(text) || /^\s*#{1,6}\s*$/.test(text)) continue;
        if (text.trimStart().startsWith("|")) {
            body();
            continue;
        }

        const quoted = QUOTE.exec(text);
        if (quoted) {
            text = text.slice(quoted[0].length);
            at += quoted[0].length;
        }

        if (skippingContents) {
            if (outlineMark(text)) continue;
            skippingContents = false;
        }

        if (text.startsWith("\f")) {
            const name = clean(text.slice(1));
            if (name) place(2, 0, false, false, "heading", name, line.start);
            continue;
        }

        const listedHeading = LIST_HEADING.exec(text);
        if (listedHeading) {
            const title = clean(listedHeading[3]!);
            if (isHeadingTitle(title, meetings)) {
                place(listedHeading[2]!.length, listedHeading[1]!.length, false, true, "heading", title, at);
            }
            continue;
        }

        const hashed = HASH_HEADING.exec(text);
        if (hashed) {
            const title = clean(hashed[2]!);
            if (isHeadingTitle(title, meetings)) {
                place(hashed[1]!.length, 0, false, true, "heading", title, at);
            } else if (!RULE.test(title) && (isBanner(title, meetings) || isDateLine(title))) {
                // A second copy of the meeting's banner starts its own banner
                // block, so the room line under this date is not a section.
                front = [];
            }
            continue;
        }

        const { plain, wrapped } = emphasis(text);
        if (!plain || isBanner(plain, meetings) || isDateLine(plain)) continue;
        // "Last Updated April 2026" is the revision stamp under the title
        // block. Closing the block here is what lets the first article be a
        // section instead of one more line of the title.
        if (/^last updated\b/i.test(plain) && MONTH.test(plain)) {
            closeFront();
            continue;
        }
        // `\<script\>` is a note that a passage was not transcribed, not a section.
        if (/\bscripts?\b/i.test(plain) && plain.length < 120) continue;

        const structural = STRUCTURAL.exec(plain);
        // "SECTION 1. TITLE." is a heading whether or not it ends in a period.
        const unstopped = plain.replace(/\.$/, "");
        // A sentence that happens to open with "Section 4 is..." is not a heading.
        // Emphasis is trusted: the author italicised "*Section One: Name*" to set
        // it apart from the clause under it.
        if (structural && (wrapped !== null || isLabel(unstopped))) {
            const subtitle = (structural[3] ?? "").replace(/^[.\s]+/, "").replace(/\.$/, "").trim();
            const title = isLabel(unstopped)
                ? unstopped
                : `${structural[1]} ${structural[2]}${subtitle && isLabel(subtitle) ? `: ${subtitle}` : ""}`;
            place(structuralDepth(structural[1]!, unstopped), 0, false, false, "heading", clean(title), at);
            continue;
        }

        // The clause is on the heading's own line: "ARTICLE 1, SECTION 1.
        // These Bylaws...". The label is the section; the sentence is its body.
        const inlineSection = INLINE_ARTICLE_SECTION.exec(unstopped);
        if (inlineSection && unstopped.length > inlineSection[1]!.length + 8) {
            const title = inlineSection[1]!.replace(/\s+/g, " ").replace(/[.\s]+$/, "");
            body();
            place(structuralDepth("article", unstopped), 0, false, false, "heading", clean(title), at);
            if (open) bodied.add(open);
            continue;
        }

        const mark = outlineMark(text);
        if (mark) {
            const label = emphasis(mark.raw);
            // A colon here introduces the bill or the person reporting, not a
            // speech. "Jazz: Thank you..." is never a numbered label.
            if (!isLabel(label.plain) || isBanner(label.plain, meetings)) {
                body();
                continue;
            }
            // A plain bullet is a note -- a point in the minutes, a name on a
            // list -- and an outline of every one is the document again.
            if (mark.kind === "bullet" && label.wrapped === null) {
                if (open) bodied.add(open);
                continue;
            }

            // A bold numbered item is a new agenda heading. The plain items
            // under it -- "Present", "i. Excused", "a. Judiciary confirmation"
            // -- are its children, even when the export did not indent them.
            const agendaHeading = mark.kind === "number" && label.wrapped === "bold";
            // A note numbered like an agenda item is still a note.
            if (!agendaHeading && !isOutlineEntry(label.plain)) {
                if (open) bodied.add(open);
                continue;
            }
            if (agendaHeading) {
                place(2, mark.indent, false, false, "heading", label.plain, at);
            } else if (mark.kind === "bullet") {
                // A bullet belongs to the item it follows. Giving it that
                // item's indent plus one keeps the next roman line from
                // treating the bullet as its parent.
                let index = frames.length - 1;
                if (index >= 0 && frames[index]!.marker === "bullet") index -= 1;
                const parent = index >= 0 ? frames[index]! : null;
                place(
                    (parent?.level ?? 0) + 1,
                    (parent?.indent ?? -1) + 1,
                    true,
                    false,
                    "bullet",
                    label.plain,
                    at,
                );
            } else {
                place(
                    outlineLevel(mark.indent, mark.kind, mark.value),
                    mark.indent,
                    true,
                    false,
                    mark.kind,
                    label.plain,
                    at,
                );
            }
            continue;
        }

        // Docs escapes the brackets the minutes use as topic labels: `\<Cabinet reports\>`.
        const stage = STAGE.exec(text.replace(/\\([^A-Za-z0-9\n])/g, "$1").trim());
        if (stage) {
            const title = clean(stage[1]!);
            if (!isNoise(title) && !isSpeaker(title) && isLabel(title) && title.split(/\s+/).length <= 8) {
                place(minorLevel(), 0, false, false, "heading", title, at);
            } else {
                body();
            }
            continue;
        }

        if (wrapped === "bold" && isLabel(plain) && !isNoise(plain) && !isSpeaker(plain)) {
            const decimal = DECIMAL_HEADING.exec(plain);
            if (decimal) {
                if (!isProvisionHeading(plain)) {
                    body();
                    continue;
                }
                if (front !== null) closeFront();
                place(decimalLevel(decimal[1]!), 0, false, false, "heading", plain, at);
                continue;
            }
            if (front !== null && !(meetings && isMeetingTitle(plain))) {
                front.push({ title: plain, at });
                continue;
            }
            const level = frames.some((frame) => frame.markdown) ? minorLevel() : 2;
            place(level, 0, false, false, "heading", plain, at);
            continue;
        }

        // A bare title-case line only counts once a section is already open.
        // Otherwise the document's own title -- "Constitution of the" on one
        // line, the university's name on the next -- becomes the outline.
        const opened = frames.length > 0;
        if (!signing && wrapped === null && isBreakLine(plain)) {
            place(minorLevel(), 0, false, false, "heading", plain, at);
            continue;
        }
        if (
            !signing &&
            isTitleCase(plain) &&
            !SENTENCE_VERB.test(plain) &&
            (wrapped === "italic" || (wrapped === null && opened))
        ) {
            const decimal = DECIMAL_HEADING.exec(plain);
            if (decimal) {
                if (isProvisionHeading(plain)) {
                    place(decimalLevel(decimal[1]!), 0, false, false, "heading", plain, at);
                } else {
                    body();
                }
                continue;
            }
            place(minorLevel(), 0, false, false, "heading", plain, at);
            continue;
        }

        body();
    }

    closeFront();

    return { sections: dropPlaceholders(sections, bodied, styled), anchors };
}

/**
 * Drops a `#` heading with nothing under it when the same heading has a body
 * somewhere else.
 *
 * The committee template opens the minutes with a copy of the agenda's
 * banner, so "ATTENDANCE" appears twice and only one of them holds the roll.
 * An agenda item with nothing under it ("Adjournment") is still a part of
 * the meeting, which is why only a repeated heading goes.
 */
function dropPlaceholders(
    sections: DocumentSection[],
    bodied: ReadonlySet<DocumentSection>,
    styled: ReadonlySet<DocumentSection>,
): DocumentSection[] {
    const filled = new Set<string>();
    const visit = (nodes: DocumentSection[]) => {
        for (const node of nodes) {
            if (bodied.has(node) || node.children.length > 0) filled.add(comparable(node.title));
            visit(node.children);
        }
    };
    visit(sections);

    const prune = (nodes: DocumentSection[]): DocumentSection[] =>
        nodes
            .filter(
                (node) =>
                    !(
                        styled.has(node) &&
                        !bodied.has(node) &&
                        node.children.length === 0 &&
                        filled.has(comparable(node.title))
                    ),
            )
            .map((node) => ({ ...node, children: prune(node.children) }));
    return prune(sections);
}
