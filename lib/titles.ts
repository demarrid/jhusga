/**
 * The name the site shows for a document.
 *
 * Drive filenames are whatever the officer typing that day felt like: leading
 * spaces, SHOUTING, "Exective Meeting #1 Minutes", "MINUTES senate 3",
 * "112th SGA Senate Meeting 7", "2Official SGA Attendance Sheet". Listing
 * those side by side makes a consistent series look like unrelated documents,
 * and makes it hard to see that #13 and #14 are the same kind of thing.
 *
 * So the site shows a tidied name, and keeps the filename. Three rules:
 *
 * 1. Every title is cleaned -- whitespace collapsed, shouting undone, known
 *    acronyms preserved.
 * 2. A document that is one half of a meeting is rewritten into one house
 *    style, "Senate General Body Meeting #3 — Minutes (09/08/26)", so a
 *    session's meetings sort and read as a series.
 * 3. A document that is a whole session of meetings typed into one file gets
 *    the same name stamped with the session instead of a date, "Civic
 *    Engagement Committee Meeting Minutes (114th Session)", so a committee
 *    that keeps its minutes that way is not filed differently from one that
 *    keeps a file per meeting.
 * 4. A document the SGA keeps one of per session -- the constitution, the
 *    bylaws, the attendance sheet -- is named for what it is and stamped with
 *    the session, so the copies line up next to each other.
 *
 * Renaming is never allowed to lose information. The original filename is
 * stored alongside and shown on hover, and a canonical name that would collide
 * with another document's is abandoned in favour of the cleaned original --
 * see `standardTitles`.
 */

import { formatDateNumeric } from "@/lib/dates";
import { meetingFor, meetingLog, type MeetingRole } from "@/lib/meetings";
import { sessionOrdinal } from "@/config/session";

/**
 * Strings that are not words and must not be title-cased. Lowercase form
 * mapped to the way the SGA writes them.
 */
const ACRONYMS = new Map(
    [
        "SGA", "JHU", "GBM", "RSO", "KSAS", "WSE", "CE", "IA", "SS", "AA",
        "HSS", "CSO", "PC", "FC", "SBP", "CSC", "BSC", "MSE", "TBD", "AV",
        "SHWB", "Q&A", "II", "III", "IV",
        // Student groups and events the SGA funds, which reach the archive
        // only through the bills that fund them: "JHUMA Funding Bill Fall
        // 2026" is the Muslim Association, not somebody called Jhuma.
        "JHUMA", "SARU", "ABSA", "MELA", "PRDC",
    ].map((word) => [word.toLowerCase(), word]),
);

/** Words that stay lowercase inside a title. */
const MINOR_WORDS = new Set([
    "a", "an", "and", "as", "at", "but", "by", "for", "in", "of", "on", "or",
    "the", "to", "with", "vs",
]);

/** Committee folder names, as the SGA would write them in prose. */
const COMMITTEE_NAMES: Record<string, string> = {
    "internal affairs": "Internal Affairs",
    "civic engagement": "Civic Engagement",
    "academic affairs": "Academic Affairs",
    "student services": "Student Services",
    "health safety and sustainability": "Health, Safety and Sustainability",
    finance: "Finance",
    programming: "Programming",
};

/**
 * A word that is shouting rather than an acronym.
 *
 * Length is the discriminator, and four is the threshold because every SGA
 * acronym a title actually uses is three letters or fewer, or is listed in
 * ACRONYMS. "MINUTES" is shouting; "GBM" and "KSAS" are not.
 *
 * Measured over each run of letters rather than the word as a whole, because
 * the SGA hyphenates its acronyms together: "SGA-FC" and "SGA-R-1718.08" are
 * short acronyms stuck end to end, and counting their letters in one lump
 * makes them long enough to look like shouting and come back as "Sga-fc".
 */
function isShouting(word: string): boolean {
    return (word.match(/[A-Za-z]+/g) ?? []).some((run) => {
        if (run.length < 4) return false;
        if (ACRONYMS.has(run.toLowerCase())) return false;
        return run === run.toUpperCase();
    });
}

function capitaliseWord(word: string, isFirst: boolean): string {
    const bare = word.replace(/[^A-Za-z&]/g, "").toLowerCase();

    const acronym = ACRONYMS.get(bare);
    if (acronym) return word.replace(/[A-Za-z&]+/, acronym);

    if (!isFirst && MINOR_WORDS.has(bare)) return word.toLowerCase();

    // The first *letter*, not the first character: "[TEMPLATE]" leads with a
    // bracket, and capitalising that leaves "[template]".
    return word.toLowerCase().replace(/[a-z]/, (letter) => letter.toUpperCase());
}

/**
 * Tidy a filename into something readable, without changing what it says.
 *
 * Re-casing is done per word, and only to words that are shouting. Titles here
 * are routinely half-shouted ("MINUTES of Senate GBM #14"), and a whole-title
 * rule would either miss those or flatten the author's correct capitalisation
 * in "JHU SGA Bylaws 2025-2026".
 */
export function cleanTitle(raw: string): string {
    const collapsed = raw
        .replace(/\s+/g, " ")
        .replace(/\s+([,.;:])/g, "$1")
        .trim();

    if (!collapsed) return "";

    return collapsed
        .split(" ")
        .map((word, index) =>
            isShouting(word) ? capitaliseWord(word, index === 0) : word,
        )
        .join(" ");
}

function titleCase(value: string): string {
    return value
        .split(" ")
        .map((word, index) => capitaliseWord(word, index === 0))
        .join(" ");
}

/** The body a meeting key names, as the site writes it. */
function bodyLabel(body: string): string | null {
    if (body.startsWith("committee:")) {
        const name = body.slice("committee:".length);
        return `${COMMITTEE_NAMES[name] ?? titleCase(name)} Committee Meeting`;
    }

    switch (body) {
        case "senate":
            return "Senate General Body Meeting";
        case "executive":
            return "Executive Board Meeting";
        case "executive:summer":
            return "Summer Executive Board Meeting";
        case "judicial":
            return "Judiciary Meeting";
        default:
            return null;
    }
}

/** "2026-09-06" -> "09/06/26". */
function shortIsoDate(iso: string): string | null {
    const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
    if (!parts) return null;
    return `${parts[2]}/${parts[3]}/${parts[1].slice(2)}`;
}

/** "113:senate:13" -> { label: "Senate General Body Meeting", ordinal: "13" }. */
function meetingParts(
    key: string,
): { label: string; number: string | null; date: string | null } | null {
    // The body may itself contain a colon ("committee:internal affairs",
    // "executive:summer"), so the session is everything before the first colon
    // and the ordinal is everything after the last.
    const firstColon = key.indexOf(":");
    const lastColon = key.lastIndexOf(":");
    if (firstColon === -1 || lastColon <= firstColon) return null;

    const body = key.slice(firstColon + 1, lastColon);
    const ordinal = key.slice(lastColon + 1);
    if (!body || !ordinal) return null;

    const label = bodyLabel(body);
    if (!label) return null;

    // A meeting keyed by date was dated by whoever named the file, which beats
    // anything inferred; one keyed by number has to fall back to Drive.
    const date = shortIsoDate(ordinal);
    return date
        ? { label, number: null, date }
        : { label, number: ordinal, date: null };
}

const ROLE_SUFFIX: Record<MeetingRole, string> = {
    agenda: "Agenda",
    minutes: "Minutes",
};

export type TitleInput = {
    id: string;
    title: string;
    folderPath: string;
    sessionNumber: number | null;
    /**
     * When Drive says the file was made. Used as the meeting's date when the
     * filename carries none, which is most of them: the SGA writes the agenda
     * the day of or a day or two before, and the minutes into the same file
     * the evening it meets. Checked against the dates the documents state in
     * their own headers before being relied on here.
     */
    driveCreatedTime?: Date | null;
    /**
     * The exported text. Only a document's own contents can say that it holds
     * a whole session of meetings rather than one; see `logTitle`.
     */
    content?: string;
};

/**
 * When each meeting met, for meetings whose filenames do not say.
 *
 * One date per meeting rather than per document, because the two halves are
 * written on different days: the agenda is drafted a day or two ahead, and the
 * minutes are typed in the room. Dating each by its own file would put the
 * agenda and the minutes of one meeting on two different dates, which is
 * exactly the sort of thing a reader reads as two meetings.
 *
 * The minutes win, being the half written while the meeting was happening.
 */
function meetingDates(documents: TitleInput[]): Map<string, Date> {
    const seen = new Map<string, { minutes: Date | null; earliest: Date | null }>();

    for (const document of documents) {
        const created = document.driveCreatedTime;
        if (!created) continue;

        const meeting = meetingFor(document);
        if (!meeting.key) continue;

        const entry = seen.get(meeting.key) ?? { minutes: null, earliest: null };
        if (meeting.role === "minutes" && (!entry.minutes || created < entry.minutes)) {
            entry.minutes = created;
        }
        if (!entry.earliest || created < entry.earliest) entry.earliest = created;
        seen.set(meeting.key, entry);
    }

    const dates = new Map<string, Date>();
    for (const [key, entry] of seen) {
        const date = entry.minutes ?? entry.earliest;
        if (date) dates.set(key, date);
    }

    return dates;
}

/** The canonical name for a meeting document, or null if it is not one. */
function meetingTitle(input: TitleInput, dates?: Map<string, Date>): string | null {
    const meeting = meetingFor(input);
    if (!meeting.key || !meeting.role) return null;

    const parts = meetingParts(meeting.key);
    if (!parts) return null;

    const number = parts.number ? ` #${parts.number}` : "";
    const date =
        parts.date ??
        formatDateNumeric(dates?.get(meeting.key) ?? input.driveCreatedTime);

    return formatMeetingTitle(
        parts.label,
        meeting.role,
        number,
        date,
    );
}

/**
 * One house style for every meeting document.
 *
 * The qualifier is a date for a single meeting and a session for a file that
 * holds a whole year of them, so Internal Affairs' "one file per meeting" and
 * Civic Engagement's "one file for the semester" read as the same kind of
 * thing sitting next to each other.
 */
function formatMeetingTitle(
    label: string,
    role: MeetingRole,
    number: string,
    qualifier: string | null,
): string {
    return `${label}${number} — ${ROLE_SUFFIX[role]}${qualifier ? ` (${qualifier})` : ""}`;
}

/**
 * The canonical name for a file holding a whole session of meetings, or null.
 *
 * Committees split evenly between keeping one file per meeting and keeping one
 * file for all of them, and only the first kind was getting a house name --
 * so the 114th's Internal Affairs minutes read as a dated series while its
 * Civic Engagement minutes stayed "Civic Engagement Fall 2026 Weekly Minutes".
 * Both are that committee's minutes, so both are named that way; the log takes
 * the session where a single meeting takes its date.
 */
function logTitle(input: TitleInput): string | null {
    if (input.sessionNumber === null || !input.content) return null;

    const log = meetingLog({ ...input, content: input.content });
    if (!log) return null;

    const label = bodyLabel(log.body);
    if (!label) return null;

    return formatMeetingTitle(
        label,
        log.role,
        "",
        `${sessionOrdinal(input.sessionNumber)} Session`,
    );
}

/**
 * Documents the SGA keeps exactly one of per session, by the name the site
 * gives them. Keyed on the filename with every year and session marker taken
 * out, so "JHU SGA Bylaws 2026-2027", "JHU SGA Bylaws" and "114th SGA Bylaws"
 * are all recognised as the bylaws.
 */
const STANDING_DOCUMENTS = new Map<string, string>(
    Object.entries({
        "constitution": "JHU SGA Constitution",
        "sga constitution": "JHU SGA Constitution",
        "jhu sga constitution": "JHU SGA Constitution",
        "bylaws": "JHU SGA Bylaws",
        "sga bylaws": "JHU SGA Bylaws",
        "jhu sga bylaws": "JHU SGA Bylaws",
        "attendance sheet": "SGA Attendance Sheet",
        "sga attendance sheet": "SGA Attendance Sheet",
        "official sga attendance sheet": "SGA Attendance Sheet",
        "attendance guidelines": "SGA Attendance Guidelines",
        "sga attendance guidelines": "SGA Attendance Guidelines",
        "roster": "SGA Roster",
        "sga roster": "SGA Roster",
        "email list": "SGA Contact List",
        "sga email list": "SGA Contact List",
        "contact list": "SGA Contact List",
        "links": "SGA Links",
        "sga links": "SGA Links",
        "bill template": "SGA Bill Template",
        "agenda item template": "SGA Agenda Item Template",
    }),
);

/** "113th", "1st" -- the session, never a count. */
const SESSION_ORDINAL = /\b\d{1,3}(?:st|nd|rd|th)\b/g;

/** "2025-2026", "2025-26". */
const ACADEMIC_YEAR = /\b(?:19|20)\d{2}\s*(?:[-–—]|to)\s*(?:(?:19|20)?\d{2})\b/g;

/**
 * The filename reduced to what the document *is*.
 *
 * Deliberately strict about what it throws away: only years, session ordinals
 * and the digit officers prefix to a filename to pin it to the top of a Drive
 * listing ("2Official SGA Attendance Sheet"). Every other word survives, which
 * is what keeps "JHU SGA Bylaws (Amended April 2026)" and "SGA Bylaws Omnibus
 * Update 2026" from being mistaken for the bylaws themselves.
 */
function standingKey(title: string): string {
    return (
        title
            .toLowerCase()
            .replace(SESSION_ORDINAL, " ")
            .replace(ACADEMIC_YEAR, " ")
            .replace(/\b(?:19|20)\d{2}\b/g, " ")
            // After the years, never before: the "114" of "114th SGA Roster"
            // leads the string too, and is a session rather than a sort digit.
            .replace(/^\s*\d+\s*(?=[a-z])/, "")
            .replace(/[^a-z]+/g, " ")
            .trim()
    );
}

/** The canonical name for a once-per-session document, or null. */
function standingTitle(input: TitleInput): string | null {
    if (input.sessionNumber === null) return null;

    const name = STANDING_DOCUMENTS.get(standingKey(input.title));
    if (!name) return null;

    return `${name} (${sessionOrdinal(input.sessionNumber)} Session)`;
}

/**
 * The name the site would give this document, or null to keep the filename.
 *
 * `dates` comes from `standardTitles`, which is the only caller that can see
 * the whole corpus and therefore both halves of a meeting.
 */
export function canonicalTitle(
    input: TitleInput,
    dates?: Map<string, Date>,
): string | null {
    return meetingTitle(input, dates) ?? logTitle(input) ?? standingTitle(input);
}

/**
 * Display titles for a whole corpus.
 *
 * Corpus-wide because a canonical name is only safe if it is unique. The
 * 114th's Guiding Documents folder holds two files both called "JHU SGA
 * Bylaws 2026-2027", which canonicalise identically -- naming both "JHU SGA
 * Bylaws (114th Session)" would assert they are one document. When that
 * happens, everyone in the collision keeps their cleaned filename instead.
 */
export function standardTitles(documents: TitleInput[]): Map<string, string> {
    const cleaned = new Map(
        documents.map((document) => [document.id, cleanTitle(document.title) || document.title]),
    );

    const dates = meetingDates(documents);
    const usage = new Map<string, string[]>();

    for (const document of documents) {
        const canonical = canonicalTitle(document, dates);
        if (!canonical) continue;
        usage.set(canonical, [...(usage.get(canonical) ?? []), document.id]);
    }

    const titles = new Map(cleaned);

    for (const [canonical, ids] of usage) {
        if (ids.length !== 1) continue;
        // Also refuse a canonical name already taken by some other document's
        // cleaned filename.
        const clash = [...cleaned].some(
            ([id, name]) => id !== ids[0] && name === canonical,
        );
        if (clash) continue;
        titles.set(ids[0]!, canonical);
    }

    return titles;
}
