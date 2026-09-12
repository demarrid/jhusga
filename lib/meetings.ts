/**
 * Pairing an agenda with the minutes written from it.
 *
 * A Senate meeting produces two documents that live in different folders and
 * never mention each other: the agenda ("Senate GBM #13", filed under
 * `Agenda Items`) and the minutes ("MINUTES of Senate GBM #13", filed under
 * `Minutes`). A reader looking at one almost always wants the other, so this
 * derives a key both sides agree on -- session, body, meeting number -- plus
 * which side of the pair a document is.
 *
 * The role is read from the *folder* rather than the title wherever possible,
 * because the folder is the one thing the SGA is consistent about. Titles are
 * not: the same series is variously "Senate GBM #13", "Senate Meeting #17",
 * "112th SGA Senate Meeting 7" and "MINUTES #1".
 *
 * Which body met is the exception, and goes the other way where the filename
 * says: a member filing their own minutes keeps them with their own paperwork
 * rather than with the meeting's. See `bodyFromTitle`.
 *
 * Deliberately conservative. A missing pair is a dead end the reader can route
 * around; a wrong pair asserts that a meeting decided something it did not.
 */

export const MEETING_ROLES = ["agenda", "minutes"] as const;

export type MeetingRole = (typeof MEETING_ROLES)[number];

export function isMeetingRole(value: string): value is MeetingRole {
    return (MEETING_ROLES as readonly string[]).includes(value);
}

export function meetingRoleLabel(role: string): string {
    switch (role) {
        case "agenda":
            return "Agenda";
        case "minutes":
            return "Minutes";
        default:
            return role;
    }
}

export type Meeting = {
    /** Stable join key, e.g. "113:senate:13". Empty when not a meeting. */
    key: string;
    /** Which half of the pair this document is, or "" when undetermined. */
    role: MeetingRole | "";
};

const NO_MEETING: Meeting = { key: "", role: "" };

/**
 * Duplicates and blanks. A "Copy of Senate GBM #15" sitting beside the real
 * one would make the agenda side of that pair ambiguous, and a template is
 * numbered "#X" precisely because it belongs to no meeting.
 */
const NOT_A_MEETING = /\btemplate\b|^\s*copy of\b/i;

/**
 * Meetings the Executive Board holds with somebody from outside the SGA: the
 * advisors, the deans, the University President, the trustees. They are
 * minuted into the same folder as the Board's own meetings but are not part of
 * that numbered series, and folding them in would file "March 10 2025 Exec x
 * Advisor Meeting" as an ordinary Executive Board meeting -- losing the one
 * thing the filename was written to say.
 */
const EXTERNAL_MEETING =
    /\badvisors?\b|\badvisers?\b|\bdeans?\b|president daniels|board of trustees/i;

/** "113th", "1st" -- the session, never the meeting number. */
const SESSION_ORDINAL = /\b\d{1,3}(?:st|nd|rd|th)\b/gi;

/** "2025-2026", "2025-26". */
const ACADEMIC_YEAR = /\b(?:19|20)\d{2}\s*(?:[-–—]|to)\s*(?:(?:19|20)?\d{2})\b/g;

/** A full date in any of the shapes the SGA writes them. */
const NUMERIC_DATE =
    /\b(\d{1,2})[./-](\d{1,2})[./-]((?:19|20)?\d{2})\b|\b((?:19|20)\d{2})-(\d{1,2})-(\d{1,2})\b/;

const MONTHS = [
    "january", "february", "march", "april", "may", "june",
    "july", "august", "september", "october", "november", "december",
];

/**
 * Months as the archive misspells them, in the same spirit as "exective"
 * above. "CE Meeting Minutes - 22 Feburary 2026" is dated; refusing to read it
 * files that meeting outside its own series over a transposed letter.
 */
const MONTH_MISSPELLINGS: Record<string, string> = {
    feburary: "february",
};

const MONTH_NAMES = [...MONTHS, ...Object.keys(MONTH_MISSPELLINGS)].join("|");

/** 1-12, or 0 for a word that is not a month. */
function monthNumber(name: string): number {
    const lower = name.toLowerCase();
    return MONTHS.indexOf(MONTH_MISSPELLINGS[lower] ?? lower) + 1;
}

/**
 * "4/27" -- a month and a day with no year, as in "Student Services Meeting
 * Mins 9/3". Its second half reads as a meeting number if left alone.
 */
// Not \b-anchored: the separator in the archive is as often "_" as a space,
// and "_4" has no word boundary in front of the digit.
const PARTIAL_DATE = /(?<![\d./])(\d{1,2})\s*\/\s*(\d{1,2})(?![\d/])/;

/**
 * "14 September 2025" / "September 14, 2025" / "September 3rd, 2026". All
 * three appear in committee titles and in the headings inside a running log,
 * and the ordinal suffix has to be part of the pattern rather than something
 * skipped afterwards: there is no word boundary between the "3" and the "rd".
 */
const TEXTUAL_DATE = new RegExp(
    `\\b(?:(\\d{1,2})(?:st|nd|rd|th)?\\s+(${MONTH_NAMES})|(${MONTH_NAMES})\\s+(\\d{1,2})(?:st|nd|rd|th)?)\\b(?:,?\\s*((?:19|20)\\d{2}))?`,
    "i",
);

/**
 * The committee a document belongs to, from the folder trail. Committees each
 * own a folder, which is far more reliable than trying to read the committee
 * out of an abbreviated title like "IA.114.02".
 */
function committeeFrom(folderPath: string): string | null {
    const match = /(?:^|\/)committees\/([^/]+)/i.exec(folderPath);
    if (!match) return null;

    const name = match[1]
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, " ")
        .trim()
        .replace(/\s+/g, " ");

    return name || null;
}

/**
 * The Executive Board meets over the summer and numbers those meetings from
 * one again, so the 113th holds both an "EXECUTIVE MEETING #2" and an
 * "EXECUTIVE SUMMER MEETING #2". They are two different meetings, and keying
 * them alike would pair one's minutes with the other's agenda.
 *
 * "Sum" is included because the 114th files the series as "Sum Exec Minutes 3".
 */
const SUMMER = /\bsummer\b|\bsum\b/i;

/**
 * Bodies in the order they have to be tested, since a title naming two of them
 * names the more specific one: "Exec x Senate liaison minutes" is the Board's.
 */
const BODY_WORDS: [RegExp, string][] = [
    [/judicial|judiciary/, "judicial"],
    [/\bexec(?:utive)?\b|\bexective\b/, "executive"],
    [/\bsenate\b|general body|\bgbm\b/, "senate"],
];

/**
 * A word that says the file is about a meeting at all, so that "Senate Bill
 * Draft" in a committee folder is not read as minutes of the Senate.
 */
const NAMES_A_MEETING = /\bmeetings?\b|\bminutes\b|\bmins\b|\bagenda\b|\bgbm\b|general body/i;

/** "Internal Affairs Committee Meeting Minutes" -- the folder says which. */
const NAMES_A_COMMITTEE = /\bcommi?t+ee\b/i;

/**
 * The body a filename names a meeting of, or null when it names none.
 *
 * This is the one thing that beats the folder. Members file their own copies
 * where their own paperwork lives -- a senator sitting on Internal Affairs
 * keeps their minutes of a Senate GBM in the Internal Affairs folder -- and
 * those are still the Senate's minutes. A filename that names a committee is
 * no help, since committees are told apart by folder rather than by the
 * abbreviations titles use for them, so it defers as before.
 */
function bodyFromTitle(title: string, folderPath: string): string | null {
    if (!NAMES_A_MEETING.test(title) || NAMES_A_COMMITTEE.test(title)) return null;

    const name = title.toLowerCase();

    for (const [pattern, body] of BODY_WORDS) {
        if (!pattern.test(name)) continue;
        // The folder gets a say in *which* executive series, because the
        // 113th files its summer minutes under a folder that says summer and
        // titles them as if there were only one series.
        return body === "executive" && SUMMER.test(`${folderPath}/${title}`.toLowerCase())
            ? "executive:summer"
            : body;
    }

    return null;
}

/** senate | executive | judicial | committee:<name>, or null when unclear. */
function bodyFor(title: string, folderPath: string): string | null {
    const titled = bodyFromTitle(title, folderPath);
    if (titled) return titled;

    const committee = committeeFrom(folderPath);
    if (committee) return `committee:${committee}`;

    const haystack = `${folderPath}/${title}`.toLowerCase();

    for (const [pattern, body] of BODY_WORDS) {
        if (!pattern.test(haystack)) continue;
        return body === "executive" && SUMMER.test(haystack) ? "executive:summer" : body;
    }

    return null;
}

/**
 * Whether this is the agenda or the minutes.
 *
 * The folder wins: "MINUTES for Exec Meetings" holds documents titled
 * "Executive Meeting #10" that are minutes despite the title, and an agenda
 * titled "Senate GBM #13" says nothing about itself at all. Only when the
 * folder is silent does the title get a say.
 */
function roleFor(title: string, folderPath: string): MeetingRole | "" {
    const segments = folderPath.split("/");

    const folderSaysMinutes = segments.some((segment) => /minutes/i.test(segment));
    const folderSaysAgenda = segments.some((segment) => /agenda/i.test(segment));

    // A folder claiming both is no evidence either way.
    if (folderSaysMinutes && !folderSaysAgenda) return "minutes";
    if (folderSaysAgenda && !folderSaysMinutes) return "agenda";

    if (/\bminutes\b|\bmins\b/i.test(title)) return "minutes";
    if (/\bagenda\b/i.test(title)) return "agenda";

    // Committee folders hold that committee's minutes. Titles there often
    // date the meeting and say nothing else ("CE June 15 2026"), so without
    // this they never become a meeting and keep whatever the author typed --
    // which is the gap between Internal Affairs' dated series and Civic
    // Engagement's leftover filenames. Restricted to titles that already
    // look like a meeting, so a working document in the same folder is not
    // renamed into one.
    if (
        committeeFrom(folderPath) &&
        (meetingDate(title) || meetingNumber(title) || /\bmeetings?\b/i.test(title))
    ) {
        return "minutes";
    }

    return "";
}

/** The title with everything that is a year or a session filed off. */
function withoutYears(title: string): string {
    return title
        .replace(SESSION_ORDINAL, " ")
        .replace(ACADEMIC_YEAR, " ")
        .replace(/\b(?:19|20)\d{2}\b/g, " ");
}

function isoDate(year: number, month: number, day: number): string | null {
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    const full = year < 100 ? 2000 + year : year;
    return `${full}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * How far from a meeting a file recording it can have been made.
 *
 * An agenda is drafted a few days ahead and minutes are typed in the room, so
 * a month either side is generous. It has to be finite: without a bound, "9/3"
 * on a file made in March would be dated to a September nobody attended.
 */
const DATING_WINDOW_DAYS = 31;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The year a yearless date belongs to, read off when Drive says the file was
 * made.
 *
 * "Student Services Meeting Mins 9/3" and "CE Meeting Minutes - 14 September"
 * are dated documents that only look undated; the year is the one thing the
 * author left out because, sitting in that folder that week, it was obvious.
 * Drive still knows it. The neighbouring years are tried too, since a January
 * meeting is minuted in a file made the December before.
 */
function yearFrom(
    month: number,
    day: number,
    createdTime: Date | null | undefined,
): number | null {
    if (!createdTime) return null;

    const created = createdTime.getTime();
    if (!Number.isFinite(created)) return null;

    const madeIn = createdTime.getUTCFullYear();
    for (const year of [madeIn, madeIn - 1, madeIn + 1]) {
        const candidate = Date.UTC(year, month - 1, day);
        if (Math.abs(candidate - created) <= DATING_WINDOW_DAYS * DAY_MS) return year;
    }

    return null;
}

/**
 * The meeting date, when the title carries an unambiguous one.
 *
 * `createdTime` is what lets a title dated "9/3" or "14 September" count: the
 * year is recoverable from the file itself, and a date is a far better key
 * than the meeting number the archive mostly does not write down. Without it
 * such a title stays undated, since the same day one session earlier reads
 * identically.
 */
export function meetingDate(title: string, createdTime?: Date | null): string | null {
    const numeric = NUMERIC_DATE.exec(title);
    if (numeric) {
        // The SGA writes US order, so "09.06.2026" is 6 September.
        if (numeric[1]) {
            return isoDate(Number(numeric[3]), Number(numeric[1]), Number(numeric[2]));
        }
        return isoDate(Number(numeric[4]), Number(numeric[5]), Number(numeric[6]));
    }

    const textual = TEXTUAL_DATE.exec(title);
    if (textual) {
        const day = Number(textual[1] ?? textual[4]);
        const month = monthNumber(textual[2] ?? textual[3]);
        const stated = textual[5];
        if (stated) return isoDate(Number(stated), month, day);

        const year = yearFrom(month, day, createdTime);
        return year === null ? null : isoDate(year, month, day);
    }

    const partial = PARTIAL_DATE.exec(title);
    if (partial) {
        const month = Number(partial[1]);
        const day = Number(partial[2]);
        if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
            const year = yearFrom(month, day, createdTime);
            if (year !== null) return isoDate(year, month, day);
        }
    }

    return null;
}

/**
 * The meeting's number within its session.
 *
 * Session ordinals and years are stripped first, so "112th SGA Senate Meeting
 * 7" is meeting 7 rather than meeting 112.
 */
export function meetingNumber(title: string): number | null {
    // A dated meeting is identified by its date; a stray number in the same
    // title is a room or a time, not an ordinal.
    if (meetingDate(title)) return null;

    // A title dated without a year is dated all the same. Reading the day as
    // an ordinal is how "Exec Deans Meeting_4/27" became Executive Meeting
    // #27 -- a meeting it has nothing to do with.
    const partial = PARTIAL_DATE.exec(title);
    if (partial && Number(partial[1]) <= 12 && Number(partial[2]) <= 31) return null;
    if (TEXTUAL_DATE.test(title)) return null;

    const cleaned = withoutYears(title);

    const patterns = [
        /#\s*(\d{1,3})\b/,
        /\b(?:meeting|gbm|minutes|mins|session|no\.?|number)\s*#?\s*(\d{1,3})\b/i,
        // "MINUTES senate 3", "Sum Exec Minutes 1": the ordinal trails the title.
        /\b(\d{1,3})\s*$/,
    ];

    for (const pattern of patterns) {
        const match = pattern.exec(cleaned);
        if (match) {
            const value = Number(match[1]);
            if (value > 0 && value <= 200) return value;
        }
    }

    return null;
}

export type MeetingInput = {
    title: string;
    folderPath: string;
    sessionNumber: number | null;
    /** When Drive says the file was made; supplies the year of a "9/3" title. */
    driveCreatedTime?: Date | null;
};

/**
 * Derive a document's meeting identity.
 *
 * Returns an empty key for anything that is not a numbered or dated meeting of
 * a recognisable body, which is most of the archive.
 */
export function meetingFor(input: MeetingInput): Meeting {
    const title = input.title.trim();

    if (!title || NOT_A_MEETING.test(title)) return NO_MEETING;
    if (EXTERNAL_MEETING.test(title)) return NO_MEETING;
    if (input.sessionNumber === null) return NO_MEETING;

    const role = roleFor(title, input.folderPath);
    if (!role) return NO_MEETING;

    const body = bodyFor(title, input.folderPath);
    if (!body) return NO_MEETING;

    const ordinal =
        meetingDate(title, input.driveCreatedTime) ?? meetingNumber(title);
    if (ordinal === null) return { key: "", role };

    return { key: `${input.sessionNumber}:${body}:${ordinal}`, role };
}

// ---------------------------------------------------------------------------
// Running logs
//
// Half the SGA's committees keep one file per meeting. The other half type
// every meeting of the year into the same file: "HSS Meeting Notes 2025-2026",
// "Committee on Internal Affairs Meeting Minutes", "Student Services
// Committee", "Civic Engagement Fall 2026 Weekly Minutes". Those files name no
// single meeting, so they fall out of everything above and keep whatever the
// author typed -- which is why one committee's minutes read as a series and
// the next committee's read as loose paperwork.
//
// A log cannot be recognised from its filename, which is exactly the thing
// that is inconsistent about it. It is recognised from the inside instead: a
// file that holds two or more meeting headings is a log of those meetings, and
// a file that holds one is that one meeting.
// ---------------------------------------------------------------------------

/** "Meeting #3", "Official Meeting 3" -- the heading that opens a section. */
const MEETING_SECTION = /\bmeetings?\s*#\s*(\d{1,3})\b/i;

/**
 * The label a body writes above the list of who turned up. Minutes have one
 * and working documents do not, which is what tells "Student Services
 * Committee" (nine meetings) from "CEC Initiatives Working Doc" (none).
 */
const RECORDS_ATTENDANCE =
    /^[\s*_]*(?:students?\s+|staff\s+)?(?:present|attendance|absences|absent)\b/im;

/** A heading is a line. A paragraph that mentions a date is prose. */
const MAX_HEADING_LENGTH = 160;

/**
 * Markdown punctuation removed, so a heading reads as the author saw it.
 *
 * The leading `#` of a heading goes; the ones inside it stay, because a
 * meeting's number is written "#1" and the export escapes it to "\#1".
 */
function plainLine(line: string): string {
    return line
        .replace(/\\(.)/g, "$1")
        .replace(/^[\s>*+-]*#{1,6}\s+/, "")
        .replace(/[*_>|[\]]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

/**
 * What a line says about which meeting it opens, or null if it opens none.
 *
 * Two shapes, both taken from the archive: a line that starts with the date
 * ("8/30/25, 4:30pm, BCL 2010", "Date: 9/15/2024"), and a line that numbers
 * the meeting and dates it ("MEETING #1 7 SEPTEMBER 2025 / Minutes By: ...").
 * The return value identifies the meeting rather than merely counting it, so
 * that a heading repeated in a table of contents is not a second meeting.
 */
function meetingHeading(line: string): string | null {
    const text = plainLine(line);
    if (!text || text.length > MAX_HEADING_LENGTH) return null;

    const numbered = MEETING_SECTION.exec(text);
    const dated = NUMERIC_DATE.exec(text) ?? TEXTUAL_DATE.exec(text) ?? PARTIAL_DATE.exec(text);

    if (numbered && dated) return `#${numbered[1]}`;

    // Otherwise the date has to be the first thing on the line, or every
    // bullet that happens to mention a date opens a meeting.
    const opening = text.replace(/^date\s*:\s*/i, "");
    const opens =
        NUMERIC_DATE.exec(opening) ?? TEXTUAL_DATE.exec(opening) ?? PARTIAL_DATE.exec(opening);
    if (opens?.index === 0) return opens[0].toLowerCase();

    return null;
}

export type MeetingLog = {
    /** senate | executive | committee:<name> -- as `meetingFor` writes it. */
    body: string;
    role: MeetingRole;
    /** How many meetings the file holds. Always two or more. */
    meetings: number;
};

/**
 * The meetings a single file records, when it records more than one.
 *
 * Returns null for everything else, including a file that records exactly one
 * meeting: that one has a date of its own and belongs in the numbered series
 * with the rest, not under a name that claims to cover a session.
 *
 * A document whose filename names a meeting is that meeting, whatever its text
 * looks like. Minutes are drafted by copying the last set, and several in the
 * archive still carry the heading of the meeting they were copied from -- one
 * document, two headings, but not two meetings.
 */
export function meetingLog(input: MeetingInput & { content: string }): MeetingLog | null {
    if (meetingFor(input).key) return null;

    const title = input.title.trim();
    if (!title || NOT_A_MEETING.test(title)) return null;

    const body = bodyFor(title, input.folderPath);
    if (!body) return null;

    // A log's filename is silent about which half of a meeting it is, so where
    // neither it nor the folder says, the attendance the file itself keeps
    // does: nobody writes down who was absent from an agenda.
    const role =
        roleFor(title, input.folderPath) ||
        (RECORDS_ATTENDANCE.test(input.content) ? "minutes" : "");
    if (!role) return null;

    const meetings = new Set<string>();
    for (const line of input.content.split("\n")) {
        const heading = meetingHeading(line);
        if (heading) meetings.add(heading);
    }

    if (meetings.size < 2) return null;

    return { body, role, meetings: meetings.size };
}
