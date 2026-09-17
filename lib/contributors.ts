import { toPlainText } from "@/lib/markdown";

/**
 * Pulling people out of SGA documents.
 *
 * The documents name people in a small number of recurring shapes -- bills
 * carry "Introduced by" and "Sponsored by" lines, minutes carry attendance
 * rolls -- so this reads those lines rather than trying to find names anywhere
 * in the prose. That keeps it conservative: a missed contributor is a gap, but
 * a hallucinated one is a false claim about who did what.
 *
 * Every extraction keeps the line it came from as `evidence`, so any name shown
 * on the site can be traced back to the text that produced it.
 */

/** What a person did on a particular document. */
export const CONTRIBUTOR_ROLES = [
    "introducer",
    "sponsor",
    "confirmed",
    "nominee",
    "reporting",
    "interlocutor",
    "author",
    "present",
    "staff",
    "guest",
    "excused",
    "absent",
    "late",
    "drive_owner",
    "drive_editor",
] as const;

export type ContributorRole = (typeof CONTRIBUTOR_ROLES)[number];

export function isContributorRole(value: string): value is ContributorRole {
    return (CONTRIBUTOR_ROLES as readonly string[]).includes(value);
}

/**
 * Where a role sorts when one person holds several on the same document.
 *
 * CONTRIBUTOR_ROLES is written in the order a reader wants them: what somebody
 * did to the document, then what the body did about them, then how they took
 * part in the meeting, then whether they were there at all, and last what
 * Drive says about the file. Being confirmed to a seat is the thing worth
 * leading with, and having spoken the thing worth trailing.
 *
 * A role this file has never heard of sorts to the end rather than the front.
 */
export function contributorRoleOrder(role: string): number {
    const index = (CONTRIBUTOR_ROLES as readonly string[]).indexOf(role);
    return index === -1 ? CONTRIBUTOR_ROLES.length : index;
}

/** Human label for a role, for listings and filters. */
export function contributorRoleLabel(role: string): string {
    switch (role) {
        case "introducer":
            return "Introduced";
        case "sponsor":
            return "Sponsored";
        case "reporting":
            return "Reported";
        // What the minutes actually witness: they took the floor. Saying
        // "Present" of someone the minutes only ever show speaking claims the
        // weaker fact and leaves the stronger one unsaid.
        case "interlocutor":
            return "Interlocutor";
        case "author":
            return "Author";
        case "confirmed":
            return "Confirmed";
        case "nominee":
            return "Nominated";
        case "present":
            return "Present";
        case "staff":
            return "Staff";
        case "guest":
            return "Guest";
        case "excused":
            return "Excused";
        case "absent":
            return "Absent";
        case "late":
            return "Late";
        case "drive_owner":
            return "Drive owner";
        case "drive_editor":
            return "Last edited";
        default:
            return role;
    }
}

/** Line prefixes that introduce a list of people, mapped to what they mean. */
const ROLE_LABELS: { pattern: RegExp; role: ContributorRole; firstNames?: boolean }[] = [
    { pattern: /^introduced\s+by$/i, role: "introducer" },
    { pattern: /^(?:sponsored\s+by|sponsors?|co-?sponsors?)$/i, role: "sponsor" },
    { pattern: /^(?:staff\s+present|staff|faculty|admin|advisors?)$/i, role: "staff" },
    {
        pattern: /^(?:students?\s+present|members?\s+present|senators?\s+present|permanent\s+members|committee\s+members|present|in\s+attendance|attendees?)$/i,
        role: "present",
    },
    { pattern: /^(?:guests?|observers?|non-?committee\s+members?)$/i, role: "guest" },
    { pattern: /^(?:absent\s+)?excused$/i, role: "excused" },
    { pattern: /^(?:unexcused|absent(?:\s+unexcused)?|absentees?)$/i, role: "absent" },
    { pattern: /^late$/i, role: "late" },
    // The Senate elects a Senator of the Month, and the line that records it
    // is the only place some senators are named all meeting.
    { pattern: /^nominees?$/i, role: "nominee" },
    { pattern: /^here$/i, role: "present", firstNames: true },
];

/**
 * Parenthetical text that names an office rather than annotating attendance.
 * "(CE Chair)" is a role; "(leaving early)" is not.
 */
const OFFICE_WORDS =
    /\b(chairs?|president|vice|secretary|treasurer|senators?|director|specialist|coordinator|advisor|adviser|dean|officer|representative|liaison|justices?|parliamentarian)\b/i;

/**
 * Template placeholders. Bill templates are stored alongside real bills, and
 * their "Sponsored by: SENATOR \#1" lines must not become people.
 */
const PLACEHOLDER_WORDS = new Set([
    "name",
    "names",
    "introducer",
    "senator",
    "sponsor",
    "day",
    "month",
    "year",
    "title",
    "tbd",
    "na",
    "none",
    "n/a",
    "insert",
    "student",
    "author",
    // What an agenda writes where a person would go when nobody is reporting.
    // "Nothing To Report" is three Title Case words and no one at all.
    "nothing",
    "report",
    "reports",
    "update",
    "updates",
    "present",
    "absent",
    "excused",
    "unexcused",
    "everyone",
    "adjourned",
    // An agenda links to the bill templates from inside its own report
    // section, and "Template Bills" is two Title Case words.
    "template",
    "templates",
    "senators",
    "cabinet",
    "officers",
    "guests",
    "members",
]);

/**
 * Honorifics, which are not offices and are not caught by OFFICE_WORDS.
 * "Dr Jane Doe" still has to become Jane Doe.
 */
const HONORIFIC = /^(?:(dr|prof|professor|mr|ms|mrs)\.?\s+)/i;

/**
 * A short all-caps office acronym: VPOTS, SBP, CE, IA. Longer shouting is
 * a template blank, not a title.
 */
const OFFICE_ACRONYM = /^[A-Z]{2,6}$/;

/** Canonical spelling of a stripped one-word title. */
function normaliseTitle(raw: string): string {
    const cleaned = raw.toLowerCase().replace(/[-\s]+/g, " ").replace(/s$/, "");
    return cleaned
        .split(" ")
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(" ");
}

/**
 * Whether a prefix is an office rather than the start of a three-word name.
 *
 * "Finance Chair", "Chair of IA", "President of the Senate", "VPOTS" are
 * offices. "Mary" is not, so "Mary Ann Smith" stays one name.
 */
function looksLikeOffice(prefix: string): boolean {
    const text = prefix.replace(/\s+/g, " ").trim();
    if (!text) return false;
    if (OFFICE_WORDS.test(text)) return true;
    if (OFFICE_ACRONYM.test(text)) return true;
    if (/^(?:vpots|sbp|vpot?s)\b/i.test(text)) return true;
    return false;
}

/**
 * Whether a line is an office title rather than a sentence that happens to
 * mention one.
 *
 * `looksLikeOffice` is a word test, so "no single justice controls outcomes"
 * matches on "justice". A slide writes the office on its own line in Title
 * Case — "Chief Justice", "Justice" — and that is the only shape this treats
 * as the office a name above it holds.
 */
function isOfficeLine(text: string): boolean {
    const item = text.replace(/\s+/g, " ").trim();
    if (!item || item.length > 40) return false;
    const words = item.split(" ");
    if (words.length > 4) return false;
    if (/[0-9.?!]/.test(item)) return false;
    if (
        !words.every(
            (word) =>
                /^[A-Z][A-Za-z'’-]*$/.test(word) || /^(?:of|the|and|for)$/.test(word),
        )
    ) {
        return false;
    }
    // NOTES, CSO, END match the 2–6 letter acronym test used for VPOTS, and
    // they are headings, not an office a person holds.
    if (OFFICE_ACRONYM.test(item)) return false;
    if (!OFFICE_WORDS.test(item) && !/^(?:vpots|sbp|vpot?s)$/i.test(item)) {
        return false;
    }
    const first = words[0] ?? "";
    if (
        !OFFICE_WORDS.test(first) &&
        !/^(?:The|Vice|Co|Chief|Associate|Executive|Student|Senate)$/i.test(first)
    ) {
        return false;
    }
    // "Senator Tyler Turner" is a person. "Senator Chats" and "Vice Chair
    // Elections" leave a leftover word that is not an office either.
    const parsed = parsePersonToken(item);
    if (parsed?.office && looksLikePersonName(parsed.name)) {
        if (parsed.name.split(/\s+/).length >= 2) return false;
        if (!/\bof\b/i.test(item) && !OFFICE_WORDS.test(parsed.name)) return false;
    }
    return true;
}

function tidyOffice(prefix: string): string {
    const collapsed = prefix.replace(/\s+/g, " ").trim();
    if (
        /^(?:vice[-\s]?chair|co[-\s]?chair|chairs?|vice[-\s]?president|president|secretary|treasurer|senators?|justices?|parliamentarian)$/i.test(
            collapsed,
        )
    ) {
        return normaliseTitle(collapsed);
    }
    return collapsed;
}

/**
 * The personal name at the end of a titled token, and the office in front.
 *
 * Bills write "Finance Chair Peter Tarpley" and "President of the Senate
 * Jazzlyn Fernandez". Those are four Title Case words, so they look like a
 * name unless the office is peeled off. Two-word names are tried first so
 * "Finance Chair Peter Tarpley" does not become someone called Chair Peter
 * Tarpley.
 */
function peelLeadingOffice(working: string): {
    name: string;
    office: string | null;
} {
    const honorific = HONORIFIC.exec(working);
    if (honorific) working = working.replace(HONORIFIC, "").trim();

    const parts = working.split(/\s+/).filter(Boolean);

    // An office and a surname, which is how the minutes name everyone who is
    // not a senator: "VP Morris", "Chair Xiong", "Dean Chow". Taken before the
    // loop below, which reads two words as a given name and a surname and so
    // would seat a person called Chair Xiong beside the Angela Xiong she is.
    if (parts.length === 2 && looksLikeOffice(parts[0]!) && isPlausibleName(parts[1]!)) {
        return { name: parts[1]!, office: tidyOffice(parts[0]!) };
    }

    for (const length of [2, 3, 4, 1]) {
        if (parts.length < length) continue;
        const name = parts.slice(-length).join(" ");
        const prefix = parts.slice(0, -length).join(" ");
        if (!isPlausibleName(name)) continue;
        if (!prefix) {
            return {
                name,
                office: honorific ? normaliseTitle(honorific[1]!) : null,
            };
        }
        if (looksLikeOffice(prefix)) {
            return { name, office: tidyOffice(prefix) };
        }
    }

    return {
        name: working,
        office: honorific ? normaliseTitle(honorific[1]!) : null,
    };
}

export type ExtractedContributor = {
    name: string;
    role: ContributorRole;
    /** An office named alongside them, e.g. "CE Chair". */
    office: string | null;
    /** Anything else in parentheses, e.g. "leaving early". */
    note: string | null;
    /** The line this came from. */
    evidence: string;
    /**
     * Read from a shape loose enough that the name is only worth believing if
     * the archive already holds the person; see harvestSpeaker below. The
     * caller drops these rather than creating anybody for them.
     */
    onlyIfKnown: boolean;
};

/**
 * Is this a plausible personal name rather than a placeholder or a fragment?
 *
 * Deliberately strict. Real names in these documents are Title Case with one to
 * four parts; anything shouting in caps, carrying digits, or running longer
 * than that is template scaffolding or a sentence that happened to follow a
 * colon. Minutes typed during a meeting are often all lowercase, so a single
 * given name in lowercase still counts, and two lowercase tokens count when
 * they are not ordinary English.
 */
function isPlausibleName(candidate: string): boolean {
    const name = candidate.trim();

    if (name.length < 3 || name.length > 60) return false;
    if (/[0-9#@:;/\\|]/.test(name)) return false;

    // ALL CAPS is how the templates write their blanks.
    if (name === name.toUpperCase() && /[A-Z]/.test(name)) return false;

    const parts = name.split(/\s+/);
    if (parts.length > 4) return false;

    if (parts.some((part) => PLACEHOLDER_WORDS.has(part.toLowerCase()))) {
        return false;
    }

    // Every part must look like a name: starts uppercase, letters only
    // afterwards (allowing O'Brien, Garduno-Castaneda, and initials).
    if (parts.every((part) => /^[A-Z][A-Za-z'’.-]*$/.test(part))) {
        return true;
    }

    // "jason", "sumire", "femi" — a first name the minute-taker did not
    // capitalise.
    if (parts.length === 1 && /^[a-z][a-z'’.-]{2,}$/.test(parts[0]!)) {
        return true;
    }

    // "grace yang" under a confirmation heading. Two ordinary English words
    // ("sports clubs") are not a name.
    if (
        parts.length === 2 &&
        parts.every(
            (part) =>
                /^[a-z][a-z'’.-]{2,}$/.test(part) && !LOWERCASE_NAME_NOISE.has(part),
        )
    ) {
        return true;
    }

    return false;
}

/** Words that are not a surname, used to refuse lowercase two-word phrases. */
const LOWERCASE_NAME_NOISE = new Set([
    "the", "and", "of", "for", "to", "in", "on", "at", "with", "from", "as",
    "by", "or", "but", "an", "is", "was", "are", "be", "this", "that", "not",
    "no", "non", "more", "first", "class", "committee", "meeting", "report",
    "update", "motion", "public", "safety", "video", "games", "weekend",
    "finance", "annual", "legislative", "business", "confirmation", "discussion",
    "attendance", "sports", "clubs", "none",
]);

/** Capitalise a name the minutes wrote in lowercase, so "jason" is Jason. */
function displayName(name: string): string {
    if (name !== name.toLowerCase()) return name;
    return name
        .split(/\s+/)
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(" ");
}

/** Split "A, B (note) and C" into its members, keeping parentheticals attached. */
function splitPeople(list: string, firstNames = false): string[] {
    if (firstNames && !/[,;&]| and /i.test(list)) {
        return list.split(/\s+/).map((part) => part.trim()).filter(Boolean);
    }

    return list
        .split(/,|;|\band\b|&|\/|\u2022/i)
        .map((part) => part.trim())
        .filter(Boolean);
}

function statusToRole(status: string): ContributorRole | null {
    const value = toPlainText(status).toLowerCase();
    if (/^present\b/.test(value)) return "present";
    if (/^excused\b/.test(value)) return "excused";
    if (/^late\b/.test(value)) return "late";
    if (/^absent\b/.test(value)) return "absent";
    return null;
}

/**
 * Peel titles, offices, and notes off a raw name token.
 *
 * Handles "Chair Angela Xiong", "Finance Chair Peter Tarpley",
 * "Jackson Morris (CE Chair)", and "Shreemann Patel, Chair".
 */
function parsePersonToken(candidate: string): {
    name: string;
    office: string | null;
    note: string | null;
} | null {
    let working = candidate.trim();
    if (!working) return null;

    const withParens = /^(.*?)\s*\(([^)]*)\)\s*$/.exec(working);
    const parenthetical = withParens ? withParens[2].trim() : null;
    working = (withParens ? withParens[1] : working).trim();

    const trailingOffice = /^(.*?),\s*([^,]+)$/.exec(working);
    let commaOffice: string | null = null;
    if (trailingOffice && OFFICE_WORDS.test(trailingOffice[2])) {
        working = trailingOffice[1].trim();
        commaOffice = trailingOffice[2].trim();
    }

    const peeled = peelLeadingOffice(working);
    working = peeled.name;

    if (!isPlausibleName(working)) return null;

    const parenIsOffice = parenthetical ? OFFICE_WORDS.test(parenthetical) : false;

    return {
        name: working,
        office: parenIsOffice
            ? parenthetical
            : commaOffice
                ? commaOffice
                : peeled.office,
        note: parenthetical && !parenIsOffice ? parenthetical : null,
    };
}

/**
 * Words a real person's name never contains, but that fall out of
 * `parsePersonToken` when it peels titles off a phrase like "Senator Sun
 * Moon of the FLI caucus" — it hands back "caucus" as if that were the name.
 * Every one of these is the body somebody serves in, not the person serving.
 */
const NON_NAME_WORDS = new Set([
    "senate",
    "caucus",
    "council",
    "committee",
    "class",
    "board",
    "cabinet",
    "congress",
    "executive",
    "judiciary",
    "association",
    "coalition",
    "university",
    "school",
    "department",
    "society",
    "the",
]);

/** A parsed name that could actually belong to a person. */
function looksLikePersonName(name: string): boolean {
    return !name
        .split(/\s+/)
        .some((part) => NON_NAME_WORDS.has(part.toLowerCase()));
}

function recordPerson(
    found: Map<string, ExtractedContributor>,
    candidate: string,
    role: ContributorRole,
    evidence: string,
    /** An office the line gave separately, e.g. the label before a colon. */
    office?: string,
    onlyIfKnown = false,
): boolean {
    const parsed = parsePersonToken(candidate);
    if (!parsed) return false;

    // "Senator Sun Moon of the FLI caucus" peels down to "caucus", and
    // "President Stone Meng of the Sophomore Class" to "Sophomore Class".
    // The name that came back is the body somebody belongs to, not a person.
    if (!looksLikePersonName(parsed.name)) return false;

    const key = `${nameKey(parsed.name)}::${role}`;
    if (found.has(key)) return true;

    found.set(key, {
        name: displayName(parsed.name),
        role,
        office: parsed.office ?? (office ? tidyOffice(office) : null),
        note: parsed.note,
        evidence: evidence.slice(0, 300),
        onlyIfKnown,
    });
    return true;
}

/** Pull every "Label: names" segment out of a line that may contain several. */
function labeledSegments(text: string): { role: ContributorRole; names: string; firstNames: boolean }[] {
    const matches: { index: number; length: number; role: ContributorRole; firstNames: boolean }[] = [];

    for (const entry of ROLE_LABELS) {
        // Patterns are written to match a whole label (`^...$`). Drop the
        // anchors so "Present:" can be found in the middle of a flattened
        // attendance line.
        const body = entry.pattern.source.replace(/^\^/, "").replace(/\$$/, "");
        const global = new RegExp(`\\b(?:${body})(?=\\s*:)`, `${entry.pattern.flags}g`);
        for (const match of text.matchAll(global)) {
            if (match.index === undefined) continue;
            matches.push({
                index: match.index,
                length: match[0].length,
                role: entry.role,
                firstNames: Boolean(entry.firstNames),
            });
        }
    }

    matches.sort((a, b) => a.index - b.index || b.length - a.length);

    // "Staff Present:" also matches the shorter "Present:" label. Keep the
    // longer one so Willow is staff, not just present.
    const unique: typeof matches = [];
    for (const match of matches) {
        const overlaps = unique.some(
            (kept) =>
                match.index < kept.index + kept.length &&
                kept.index < match.index + match.length,
        );
        if (!overlaps) unique.push(match);
    }
    matches.length = 0;
    matches.push(...unique);

    return matches.map((match, index) => {
        const start = match.index + match.length;
        const colon = text.indexOf(":", start);
        const end = index + 1 < matches.length ? matches[index + 1].index : text.length;
        const names = text.slice(colon === -1 ? start : colon + 1, end).trim();
        return { role: match.role, names, firstNames: match.firstNames };
    }).filter((segment) => segment.names.length > 0 && segment.names.length < 400);
}

/** Whether the line's final characters mean the list has more names coming. */
const TRAILING_JOIN = /(?:\band\b|,|;|&)\s*$/i;

/**
 * Bills stack introducers and co-sponsors as indented lines under the label,
 * often with no trailing "and". Attendance rolls wrap with a joiner instead.
 */
const STACKED_LIST_ROLES = new Set<ContributorRole>(["introducer", "sponsor"]);

/**
 * How a wrapped label list closes.
 *
 *   "trailing" is the old behaviour: an attendance line that ends with a
 *   comma wraps once, and the very next line -- names, and only names --
 *   is added to it. The rest of the meeting agenda is not.
 *
 *   "stacked" is the new behaviour: a bill lists co-sponsors as one
 *   indented block, sometimes for three or four lines with no joiner, and
 *   the list stays open until the first line that is not a person.
 */
type CarryingList = {
    role: ContributorRole;
    evidence: string;
    mode: "trailing" | "stacked";
};

/**
 * If a labelled line still has names coming, keep the role open.
 *
 * A trailing "and" or comma is the old wrap: the Accountability Act writes
 * "Sponsored by: Jazzlyn Fernandez and" and continues Isaac Zhang on the
 * next line. Stacked without a joiner is the new one: the JHUMA BBQ bill
 * puts Jackson Morris on the label line and Veda Kommineni on the next,
 * and only sponsor/introducer lists in bills stack that way.
 */
function openContinuation(line: string): CarryingList | null {
    const segments = labeledSegments(line);
    const last = segments[segments.length - 1];
    if (!last) return null;
    if (TRAILING_JOIN.test(last.names)) {
        return { role: last.role, evidence: line, mode: "trailing" };
    }
    if (
        STACKED_LIST_ROLES.has(last.role) &&
        splitPeople(last.names).some((token) => {
            const parsed = parsePersonToken(token);
            return parsed !== null && looksLikePersonName(parsed.name);
        })
    ) {
        return { role: last.role, evidence: line, mode: "stacked" };
    }
    return null;
}

/**
 * "Sponsored By:" with the names on the following lines, not after the colon.
 *
 * Only sponsor and introducer labels wrap this way in bills. Attendance rolls
 * "Absent:", "Present:", "Excused:" are followed by tables or comma lists,
 * not stacked names -- an agenda's "Absent: / Agenda" would otherwise become
 * a person called Agenda.
 */
function openBareLabel(line: string): CarryingList | null {
    const match = /^(.+?)\s*:\s*$/.exec(line);
    if (!match) return null;
    const label = match[1].trim();
    for (const entry of ROLE_LABELS) {
        if (!STACKED_LIST_ROLES.has(entry.role)) continue;
        if (entry.pattern.test(label)) {
            return { role: entry.role, evidence: line, mode: "stacked" };
        }
    }
    return null;
}

/**
 * Record any people named on a wrapped line, e.g. the "Chair of Academic
 * Affairs Isaac Zhang" line that continues a "Sponsored by:" list.
 *
 * `parsePersonToken` is forgiving -- it peels titles off a phrase until
 * something plausible is left -- so inside a labelled list "Senator Sun Moon
 * of the FLI caucus" reduces to a name of "caucus". The body-word guard in
 * `recordPerson` throws that away; a name still missing is a better outcome
 * than a body written down as a person.
 */
function harvestContinuedList(
    found: Map<string, ExtractedContributor>,
    line: string,
    carry: { role: ContributorRole; evidence: string },
): boolean {
    let recorded = 0;
    let carried = "";
    for (const candidate of splitPeople(line)) {
        const token = carried ? `${carried} and ${candidate}` : candidate;
        if (parsePersonToken(token)) {
            if (recordPerson(found, token, carry.role, carry.evidence)) recorded += 1;
            carried = "";
            continue;
        }
        if (looksLikeOffice(candidate)) {
            carried = token;
            continue;
        }
        carried = "";
    }
    return recorded > 0;
}

function harvestLabeledText(
    found: Map<string, ExtractedContributor>,
    text: string,
    evidence: string,
): number {
    let recorded = 0;

    for (const segment of labeledSegments(text)) {
        let carried = "";
        for (const candidate of firstNameRoll(
            splitPeople(segment.names, segment.firstNames),
            segment.role,
            segment.firstNames,
        )) {
            // "and" joins two people *and* two titles of one person
            // ("VPOTS and Chair of IA Shreemann Patel"). A fragment that is
            // only an office is held and stuck on the next name.
            const token = carried ? `${carried} and ${candidate}` : candidate;
            if (parsePersonToken(token)) {
                if (recordPerson(found, token, segment.role, evidence)) recorded += 1;
                carried = "";
                continue;
            }
            if (looksLikeOffice(candidate)) {
                carried = token;
                continue;
            }
            carried = "";
        }
    }

    return recorded;
}

const ATTENDANCE_ROLES = new Set<ContributorRole>([
    "present",
    "excused",
    "absent",
    "late",
    "guest",
    "staff",
]);

/**
 * A space-separated roll of first names on an attendance line.
 *
 * "Here:" already splits on spaces. "Excused: Yash Cole Issac" does not,
 * because two Title Case words are usually a given name and a surname
 * ("Abraham Aini"). Three or more bare given names on an attendance role
 * are a roll, not someone called Yash Cole Issac.
 */
function firstNameRoll(
    candidates: string[],
    role: ContributorRole,
    alreadySplit: boolean,
): string[] {
    if (alreadySplit || !ATTENDANCE_ROLES.has(role) || candidates.length !== 1) {
        return candidates;
    }

    const tokens = candidates[0]!.split(/\s+/).filter(Boolean);
    if (
        tokens.length >= 3 &&
        tokens.every((token) => /^[A-Za-z][a-z'’.-]{2,}$/.test(token))
    ) {
        return tokens;
    }

    return candidates;
}

/**
 * A label introducing the people who report to a meeting: "Cabinet Reports:",
 * "Advisor Report:", "Senator Reports Initiatives Updates:".
 *
 * The colon is required, and nothing may follow it. Minutes are full of
 * sentences about people reporting -- "Jason reports Jay Games this weekend" --
 * and a heading is the one shape that means a list of people is coming.
 */
const REPORTS_LABEL = /^[^:]{0,60}\breports?\b[^:]{0,40}:$/i;

/**
 * The same heading with the colon left off, which is how the minutes write it:
 * "Senator reports", "Cabinet Reports (4 mins)", "Advisor Report (2 min)".
 *
 * What may follow the word is the meeting's own time estimate in brackets and
 * more of the heading -- "Senator Reports Initiatives Updates" -- but only in
 * Title Case. That is what does the colon's job in its absence: a heading goes
 * on in capitals and "Jason reports Jay Games this weekend" goes on in a
 * sentence.
 */
const REPORTS_HEADING =
    /^(?:[A-Za-z'-]+ ){0,5}[Rr]eports?(?:\s+[A-Z][A-Za-z']*){0,3}\s*(?:\([^)]{0,30}\))?$/;

/**
 * A section heading, which is where a run of report items ends.
 *
 * The exports write a heading as a whole line of bold, sometimes numbered:
 * "6.  **Non-Legislative Business**". Read as a report item that would be a
 * person called Non-Legislative Business.
 */
const HEADING_LINE = /^\s*(?:\d+[.)]\s*)*\*\*[^*]+\*\*[ \t]*$/;

/** "i.", "ii)", "a." -- the sub-item numbering markdown does not strip. */
const ENUMERATOR = /^\(?(?:[ivxlcdm]+|[a-z]|\d+)[.)]\s*/i;

/**
 * "Student Body President: Jason Yu" -- an office, a separator, and its holder.
 *
 * The agenda template writes a colon and the minutes write a dash, so both
 * count. The dash has to be spaced on each side, or "Garduno-Castaneda" would
 * be somebody called Castaneda holding an office called Garduno.
 */
const OFFICE_HOLDER = /^([^:]{2,60}?)\s*(?::|\s[-\u2013\u2014]\s)\s*(.{3,60})$/;

/**
 * A person listed under a report heading, if the line is one.
 *
 * Two shapes, both of which the agenda template uses: an office and who holds
 * it ("iv. Treasurer: Amy Xu"), and a senator named on their own ("ii. Kai
 * Martin"). Returns false for anything else, which is what closes the run --
 * a report list that has stopped being a list of people has ended, and the
 * next Title Case line is a heading rather than somebody's name.
 */
function harvestReportItem(
    found: Map<string, ExtractedContributor>,
    line: string,
): boolean {
    const item = line.replace(ENUMERATOR, "").trim();
    if (!item) return false;

    // "senators" under a reports heading is a grouping, not a person called
    // Senators. Keep the run open so the names nested under it are still read.
    if (REPORT_GROUP.test(item)) return true;

    const titled = OFFICE_HOLDER.exec(item);
    if (titled) {
        const [, office, candidate] = titled;
        if (!looksLikeOffice(office!)) return false;
        // Shape is still a report item slot even when the candidate is a
        // body ("Advisor Report - Executive Team- Exec"); the next line can
        // still be a real reporter, so the run has not ended.
        recordPerson(found, candidate!, "reporting", line, office!);
        return true;
    }

    if (parsePersonToken(item)) {
        recordPerson(found, item, "reporting", line);
        return true;
    }
    return false;
}

/**
 * A grouping heading inside a report section: "senators", "cabinet". Not a
 * person, but not the end of the reports either.
 */
const REPORT_GROUP =
    /^(?:senators?|cabinet|officers?|guests?|members?|advisors?|staff|exec(?:utive)?(?:\s+board)?|cses?)$/i;

/**
 * "Confirmation of Senate Parliamentarian: Shreemann Patel, confirmed with
 * majority vote" -- the Senate seating somebody.
 *
 * Only the colon form. "Confirmation of Chief Advisor - Vice President Jackson
 * Morris, President Ryan Chou" is the same words with a dash and does not mean
 * the same thing: those two are the officers bringing the confirmation, not
 * the people being confirmed, and there is nothing in the line to tell them
 * apart from someone who was.
 */
const CONFIRMATION = /^confirmations?\s+of\s+(.{2,50}?)\s*:\s*(.{3,150})$/i;

/**
 * Somebody the Senate voted into a seat.
 *
 * Read as its own shape rather than left to the rules below, because it is the
 * record of how a person came to hold an office -- a stronger thing to be able
 * to say about them than that they were in the room that evening, and the
 * office it names is theirs from then on.
 */
function harvestConfirmation(
    found: Map<string, ExtractedContributor>,
    line: string,
): boolean {
    const seated = CONFIRMATION.exec(line.replace(ENUMERATOR, "").trim());
    if (!seated) return false;

    const office = seated[1]!.replace(/^the\s+/i, "");
    let recorded = 0;

    for (const candidate of splitPeople(seated[2]!)) {
        if (recordPerson(found, candidate, "confirmed", line, office)) recorded += 1;
    }

    return recorded > 0;
}

/**
 * A list marker of any shape. Minutes are one long nested list, and being an
 * item in it is much of what separates a remark somebody made at the meeting
 * from a field in the document's own header.
 */
const LIST_ITEM = /^[ \t]*(?:[-*+\u2022]|\(?(?:[ivxlcdm]+|[a-z]|\d+)[.)])\s+/i;

/**
 * Somebody named as speaking, which in a set of minutes is often the only
 * record that they were in the room at all.
 *
 * The Senate's minutes leave the attendance roll blank -- "Present" with
 * nothing after it -- and then name a dozen people down the page as they say
 * things. A parser that reads only labelled lists comes back from a full
 * meeting with two excused absences and nobody present.
 *
 * Two shapes, because the minutes are typed two ways. Structured minutes put
 * each remark under a list marker (`1. Kai: do absences need…`). Hurried ones
 * drop the marker and write `jazz: any questions?` as an ordinary paragraph,
 * sometimes several speakers to a line, and sometimes the name alone above
 * the bullets of what they said. The list form is read in every document; the
 * paragraph form is only read in minutes, because that is also how a bill
 * writes `Location: Levering` and a sheet writes `Variable type: …`.
 *
 * The shape is still far too loose to be trusted on its own: "Venue: Levering
 * (Free)" and "Article I: Bill of Rights" are the same handful of tokens as a
 * senator making a point. So what is found here is marked `onlyIfKnown` and
 * is thrown away unless the name turns out to be somebody the archive already
 * holds a full name for. That is what lets this be generous about the shape
 * and still not seat a senator called Timeline.
 */
function harvestSpeaker(
    found: Map<string, ExtractedContributor>,
    rawLine: string,
    line: string,
    next: { raw: string; line: string } | null,
    minutes: boolean,
): void {
    const inList = LIST_ITEM.test(rawLine);
    if (!inList && !minutes) return;

    const text = line.replace(ENUMERATOR, "").trim();
    harvestSpeakerAttributions(found, text);

    if (!minutes || inList) return;

    // `charles:` on its own line, the remark wrapping onto the next. An empty
    // colon followed by another attribution (`seconds:` then `point of
    // information:`) is a heading, not a person speaking.
    const hanging = /^([A-Za-z][A-Za-z'’.-]{1,}(?:\s+[A-Za-z][A-Za-z'’.-]{1,}){0,2})\s*:\s*$/.exec(
        text,
    );
    if (hanging && next && !attributionStart(next.line) && /[a-z]/.test(next.line)) {
        recordSpeaker(found, hanging[1]!, next.line, text);
    }

    // `Felix` above a nested list of what he said. A heading like "ceremony"
    // followed by a paragraph is not this: the next line has to be a bullet.
    if (
        next &&
        LIST_ITEM.test(next.raw) &&
        parsePersonToken(text) &&
        looksLikePersonName(text)
    ) {
        recordSpeaker(found, text, next.line, text);
    }
}

/**
 * Words that sit in front of a colon in the minutes without being a person:
 * the seconder, the vote, the heading for a point of information. Read as
 * names they would only ever be believed if the archive already held somebody
 * called Aye, which it does not — but skipping them here keeps them off the
 * resolver's desk.
 */
const SPEAKER_NOISE = new Set([
    "second",
    "seconds",
    "aye",
    "nay",
    "abstain",
    "passed",
    "motion",
    "poi",
    "text",
    "note",
    "notes",
    "process",
    "summary",
    "total",
    "date",
    "time",
    "location",
    "agenda",
    "question",
    "questions",
    "someone",
    "person",
    "information",
]);

/**
 * Headings the minutes write with a colon, which parse as a two-word name.
 * "First Reading:" and "Action Items:" are the same tokens as "Grace Guan:".
 */
const SPEAKER_HEADING_WORDS = new Set([
    "reading",
    "items",
    "item",
    "meeting",
    "business",
    "follow-up",
    "followup",
    "findings",
    "purpose",
    "suggestion",
    "initiatives",
    "initiative",
    "absences",
    "absence",
    "action",
    "actions",
    "announcements",
    "adjournment",
    "attendance",
    "ceremony",
    "estimates",
    "readers",
    "presentation",
    "discussion",
    "logistics",
    "ideas",
    "first",
    "last",
    "new",
    "next",
    "other",
    "updates",
    "update",
    "report",
    "reports",
    "notetaker",
    "venue",
    "timeline",
    "processes",
    "passed",
    "chief",
    "medical",
    "mental",
    "health",
    "operations",
    "chats",
    "giveaways",
    "massage",
]);

function recordSpeaker(
    found: Map<string, ExtractedContributor>,
    speaker: string,
    remark: string,
    evidence: string,
): void {
    const name = speaker.trim();
    if (SPEAKER_NOISE.has(name.toLowerCase())) return;
    const keyParts = nameKey(name).split(" ").filter(Boolean);
    if (keyParts.some((part) => SPEAKER_NOISE.has(part) || SPEAKER_HEADING_WORDS.has(part))) {
        return;
    }
    if (name.includes(",")) return;
    if (isStageDirection(remark)) return;
    if (remarkAboutSomeoneAbsent(remark)) return;
    // Hurried minutes name people in one or two words. Three is a heading:
    // "Last Meeting Follow-up", "Academic Affairs Chair".
    if (name.split(/\s+/).length > 2) return;
    recordPerson(found, name, "interlocutor", evidence, undefined, true);
}

/** `<rises>`, `\<the script\>` — the minute-taker describing the room, not quoting it. */
function isStageDirection(remark: string): boolean {
    return /^\s*<[^>]{1,40}>\s*$/.test(remark.trim());
}

/**
 * `tekeya: had a medical episode, that is why she is not here today`.
 *
 * The line is typed like every other attribution, but it is Charles telling
 * the room what happened to her. First-person remarks that mention somebody
 * else (`jackson: she thinks we should wait`) do not look like this: they do
 * not announce that the named person is absent.
 */
function remarkAboutSomeoneAbsent(remark: string): boolean {
    return /\b(?:s?he|they)\b.{0,60}\b(?:not here|isn['’]?t here|are not here|absent)\b/i.test(
        remark,
    );
}

function attributionStart(line: string): boolean {
    const text = line.replace(ENUMERATOR, "").trim();
    const colon = text.indexOf(":");
    if (colon <= 0) return false;
    return !!parsePersonToken(text.slice(0, colon).trim());
}

/**
 * Every `Name: remark` on a line, not just the one it starts with.
 *
 * Hurried minutes run speakers together (`veda: … emin: we had 12 bushels`)
 * and also bury a second colon inside a remark (`cole: 4.3.3.1.2: if member…`).
 * The longest stretch of words immediately before each colon that parses as a
 * person is the speaker; a figure (`4.3.3.1.2`) or a phrase (`point of
 * information`) does not parse and is left as part of the previous remark.
 */
function harvestSpeakerAttributions(
    found: Map<string, ExtractedContributor>,
    text: string,
): void {
    const hits: { name: string; nameStart: number; remarkAt: number }[] = [];
    let from = 0;

    while (from < text.length) {
        const colonAt = text.indexOf(":", from);
        if (colonAt === -1) break;

        const before = text.slice(0, colonAt).trimEnd();
        const words = before.split(/\s+/).filter(Boolean);
        let name: string | null = null;
        for (let n = Math.min(3, words.length); n >= 1; n -= 1) {
            const candidate = words.slice(-n).join(" ");
            if (n > 1 && !/[A-Z]/.test(candidate)) {
                // `account emin:` is a sentence with a name at the end, not
                // somebody called Account Emin. A two-word name the line
                // starts with (`grace guan:`) is still a name.
                const prefix = words.slice(0, words.length - n).join(" ");
                if (prefix && !/[.!?]$/.test(prefix)) continue;
            }
            if (parsePersonToken(candidate) && looksLikePersonName(candidate)) {
                name = candidate;
                break;
            }
        }

        from = colonAt + 1;
        if (!name) continue;
        hits.push({
            name,
            nameStart: before.length - name.length,
            remarkAt: colonAt + 1,
        });
    }

    for (let i = 0; i < hits.length; i += 1) {
        const hit = hits[i]!;
        const until = i + 1 < hits.length ? hits[i + 1]!.nameStart : text.length;
        const remark = text.slice(hit.remarkAt, until).trim();
        if (!remark || !/[a-z]/.test(remark)) continue;
        recordSpeaker(found, hit.name, remark, text);
    }
}

/** The next line that still has text, skipping blanks the minute-taker left. */
function peekNonEmpty(
    lines: string[],
    from: number,
): { raw: string; line: string } | null {
    for (let j = from + 1; j < lines.length; j += 1) {
        if (!lines[j]!.trim()) continue;
        return { raw: lines[j]!, line: toPlainText(lines[j]!) };
    }
    return null;
}

/**
 * "Felix Titre" / "Chief Justice" — a name on its own line and the office
 * they hold on the next, which is how a slide introduces the people on it.
 *
 * The same fact written on one line (`Felix Titre Chief Justice`) is read
 * here too. Either way the name is a full given name and surname, so it is
 * believed outright: these are the people the document is about, not a word
 * that happened to sit in front of a colon.
 */
function harvestNamedOffice(
    found: Map<string, ExtractedContributor>,
    line: string,
    next: { line: string } | null,
    kind?: string,
): void {
    // Slides are the documents that introduce people this way. Minutes and
    // bills write the same tokens as headings ("New Business" / "NOTES") and
    // would mint a person for each pairing.
    if (kind !== "presentation") return;

    const text = line.replace(ENUMERATOR, "").trim();
    if (!text) return;

    const stacked = next?.line.replace(ENUMERATOR, "").trim() ?? "";
    if (
        stacked &&
        isOfficeLine(stacked) &&
        !isOfficeLine(text) &&
        isStandalonePersonName(text)
    ) {
        recordPerson(found, text, "reporting", `${text}\n${stacked}`, stacked);
        return;
    }

    const peeled = peelTrailingOffice(text);
    if (peeled) {
        recordPerson(found, peeled.name, "reporting", text, peeled.office);
    }
}

/** A line that is only a given name and a surname, with nothing else on it. */
function isStandalonePersonName(text: string): boolean {
    const parts = text.split(/\s+/);
    if (parts.length < 2 || parts.length > 4) return false;
    if (
        parts.some(
            (part) =>
                SPEAKER_HEADING_WORDS.has(part.toLowerCase()) ||
                SPEAKER_NOISE.has(part.toLowerCase()) ||
                PLACEHOLDER_WORDS.has(part.toLowerCase()),
        )
    ) {
        return false;
    }
    const parsed = parsePersonToken(text);
    return (
        !!parsed &&
        looksLikePersonName(parsed.name) &&
        nameKey(parsed.name) === nameKey(text)
    );
}

/**
 * The office at the end of a titled line, and the name in front.
 *
 * Slides write the office after the person ("Katherine Zhu Justice") where
 * bills write it before ("Finance Chair Peter Tarpley"). The name has to be
 * at least two words, or "Justice" would be peeled off "Student Justice" and
 * leave a given name that is really a body.
 */
function peelTrailingOffice(line: string): { name: string; office: string } | null {
    const parts = line.split(/\s+/).filter(Boolean);
    for (const length of [1, 2, 3]) {
        if (parts.length - length < 2) continue;
        const office = parts.slice(-length).join(" ");
        const name = parts.slice(0, -length).join(" ");
        if (!looksLikeOffice(office) || !isOfficeLine(office)) continue;
        if (!isPlausibleName(name) || !looksLikePersonName(name)) continue;
        return { name, office: tidyOffice(office) };
    }
    return null;
}

function harvestAttendanceTable(
    found: Map<string, ExtractedContributor>,
    line: string,
): void {
    if (!line.includes("|")) return;

    const cells = line
        .split("|")
        .map((cell) => cell.trim())
        .filter((cell) => cell && !/^:?-{3,}:?$/.test(cell));

    if (cells.length < 2) return;

    // | Name, Office | Present | Name | Absent |
    if (cells.length % 2 === 0) {
        let pairs = true;
        for (let index = 1; index < cells.length; index += 2) {
            const status = toPlainText(cells[index].replace(/<br\s*\/?>/gi, " "));
            if (!/^(?:present|excused|late|absent)\.?$/i.test(status)) {
                pairs = false;
                break;
            }
        }
        if (pairs) {
            for (let index = 0; index < cells.length; index += 2) {
                const role = statusToRole(cells[index + 1]);
                if (role) recordPerson(found, cells[index], role, toPlainText(line));
            }
            return;
        }
    }

    for (const cell of cells) {
        // Inner line breaks are how a Here: roll is typed in a table cell:
        // "Here:<br>Kai<br>Veda". Joining them with spaces is what lets the
        // first-name splitter see a roll rather than a heading and seven
        // orphan lines.
        const text = toPlainText(cell.replace(/<br\s*\/?>/gi, " "));
        if (!text) continue;
        harvestLabeledText(found, text, text);
    }
}

/** How deep a line is nested, which is how a list says what belongs to what. */
function indentOf(rawLine: string): number {
    return (/^[ \t]*/.exec(rawLine)?.[0] ?? "").replace(/\t/g, "    ").length;
}

/**
 * Read every person named by a labelled line, an attendance table, a report
 * heading, or a remark attributed to them.
 *
 * Returns at most one entry per (name, role) pair.
 */
export function extractContributors(
    markdown: string,
    title?: string,
    kind?: string,
): ExtractedContributor[] {
    const found = new Map<string, ExtractedContributor>();
    const minutes = !!kind && kind.startsWith("minutes.");
    const lines = markdown.split(/\r?\n/);

    // The report section being read, if any. Under one of these a bare name is
    // a person rather than a phrase that looks like one.
    //
    // Indentation is what bounds it. The agenda lists its reporters and stops,
    // but the minutes write down what each of them said underneath their name,
    // and a run that ended at the first line it could not read as a person
    // ended at "Increase black visibility and retention of black students on
    // campus" -- which is Oluwanifemi's report, not the end of the reports.
    let reports: { heading: number; items: number | null; group: number | null } | null = null;

    // The labelled list still being read. Bills typeset "Sponsored by:" as
    // one indented block across several lines, sometimes with a trailing
    // "and" and sometimes without; reading each line on its own drops every
    // name after the first.
    let carryingList: CarryingList | null = null;

    for (let i = 0; i < lines.length; i += 1) {
        const rawLine = lines[i]!;
        if (rawLine.includes("|")) {
            harvestAttendanceTable(found, rawLine);
            carryingList = null;
            continue;
        }

        const line = toPlainText(rawLine);
        if (!line) {
            // A blank line ends the wrapped list; a run of them ends the
            // report section, but that is handled by indent below.
            carryingList = null;
            continue;
        }
        if (line.length > 500) {
            harvestLabeledText(found, line, line);
            carryingList = null;
            continue;
        }

        const indent = indentOf(rawLine);
        if (reports && (HEADING_LINE.test(rawLine) || indent <= reports.heading)) {
            reports = null;
        }

        // Checked before the run below, because the heading that opens a
        // report section is itself nested under "Reports".
        if (REPORTS_LABEL.test(line) || REPORTS_HEADING.test(line)) {
            reports = { heading: indent, items: null, group: null };
            carryingList = null;
            continue;
        }

        // A labelled line means what its label says, in a report section as
        // much as anywhere else: the advisor under "Advisor Report:" is staff.
        const labeled = harvestLabeledText(found, line, line);
        if (labeled > 0) {
            carryingList = openContinuation(line);
            continue;
        }

        const bare = openBareLabel(line);
        if (bare) {
            carryingList = bare;
            continue;
        }

        // Wrapped continuation of a labelled list. A trailing-joiner wrap
        // ("Absentees: X, Y,") only extends one line unless that line also
        // trails off; a stacked sponsor list stays open until the first
        // line that is not a person ("Referred to the Senate…").
        if (carryingList && harvestContinuedList(found, line, carryingList)) {
            if (carryingList.mode === "trailing" && !TRAILING_JOIN.test(line)) {
                carryingList = null;
            }
            continue;
        }
        carryingList = null;

        if (harvestConfirmation(found, line)) continue;

        if (reports) {
            // The first line under the heading sets the depth its people sit
            // at. Anything deeper is one of them talking, and is left to
            // harvestSpeaker rather than ending the list — except a grouping
            // like "senators", whose nested names are still reporters.
            reports.items ??= indent;
            if (indent <= reports.items) {
                const item = line.replace(ENUMERATOR, "").trim();
                if (REPORT_GROUP.test(item)) {
                    reports.group = indent;
                    continue;
                }
                reports.group = null;
                if (!harvestReportItem(found, line)) reports = null;
                continue;
            }
            if (reports.group !== null && harvestReportItem(found, line)) {
                continue;
            }
        }

        const next = peekNonEmpty(lines, i);
        harvestNamedOffice(found, line, next, kind);
        harvestSpeaker(found, rawLine, line, next, minutes);
    }

    if (title) harvestTitleAuthor(found, title);

    return [...found.values()];
}

/**
 * A working doc often names its author only in the filename — "Jackson
 * Working Doc" — and nowhere in a labelled list. Read conservatively: the
 * name is marked onlyIfKnown, so "Jackson" becomes Jackson Morris when the
 * archive already knows him and is left alone when it does not.
 */
const TITLE_NOISE =
    /\b(working\s+docs?|notes?|drafts?|tracker|initiatives?|agenda|minutes|bylaws|constitution|bill|act|report|template)\b/gi;

function harvestTitleAuthor(
    found: Map<string, ExtractedContributor>,
    title: string,
): void {
    const cleaned = title.replace(TITLE_NOISE, " ").replace(/\s+/g, " ").trim();
    if (!cleaned) return;

    const parsed = parsePersonToken(cleaned);
    if (parsed) {
        recordPerson(found, parsed.name, "author", title, parsed.office ?? undefined, true);
        return;
    }

    const first = cleaned.split(/\s+/)[0] ?? "";
    if (isPlausibleName(first)) {
        recordPerson(found, first, "author", title, undefined, true);
    }
}

/**
 * Normalised form used to decide whether two spellings are the same person.
 * Case and punctuation vary between documents; the words do not.
 */
export function nameKey(name: string): string {
    return (
        name
            .toLowerCase()
            .normalize("NFKD")
            .replace(/[\u0300-\u036f]/g, "")
            // Separators, not noise: "Garduno-Castaneda" and
            // "Garduno Castaneda" are the same person.
            .replace(/[^a-z]+/g, " ")
            .trim()
    );
}
