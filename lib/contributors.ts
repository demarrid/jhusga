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
 * colon.
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
    return parts.every((part) => /^[A-Z][A-Za-z'’.-]*$/.test(part));
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

    const key = `${nameKey(parsed.name)}::${role}`;
    if (found.has(key)) return true;

    found.set(key, {
        name: parsed.name,
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

function harvestLabeledText(
    found: Map<string, ExtractedContributor>,
    text: string,
    evidence: string,
): number {
    let recorded = 0;

    for (const segment of labeledSegments(text)) {
        let carried = "";
        for (const candidate of splitPeople(segment.names, segment.firstNames)) {
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

    const titled = OFFICE_HOLDER.exec(item);
    if (titled) {
        const [, office, candidate] = titled;
        if (!looksLikeOffice(office!)) return false;
        return recordPerson(found, candidate!, "reporting", line, office!);
    }

    return recordPerson(found, item, "reporting", line);
}

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

/** "Kai: do absences need to be supplemented with a reason (Yes)". */
const SPEAKER_LINE = /^([^:]{2,40}?)\s*:\s*(\S.*)$/;

/**
 * Somebody named as speaking, which in a set of minutes is often the only
 * record that they were in the room at all.
 *
 * The Senate's minutes leave the attendance roll blank -- "Present" with
 * nothing after it -- and then name a dozen people down the page as they say
 * things. A parser that reads only labelled lists comes back from a full
 * meeting with two excused absences and nobody present.
 *
 * The shape is far too loose to be trusted on its own: "Venue: Levering
 * (Free)", "Timeline: no specific date was mentioned" and "Article I: Bill of
 * Rights" are the same handful of tokens as a senator making a point, and
 * across this archive there are five hundred distinct words in front of that
 * colon. So what is found here is marked `onlyIfKnown` and is thrown away
 * unless the name turns out to be somebody the archive already holds a full
 * name for. That is what lets this be generous about the shape and still not
 * seat a senator called Timeline.
 */
function harvestSpeaker(
    found: Map<string, ExtractedContributor>,
    rawLine: string,
    line: string,
): void {
    if (!LIST_ITEM.test(rawLine)) return;

    const said = SPEAKER_LINE.exec(line.replace(ENUMERATOR, "").trim());
    if (!said) return;

    const [, speaker, remark] = said;

    // A heading introducing people is not one of them: "Cabinet Reports:" and
    // "Opposed: Jackson, damari" both run longer than anybody is named.
    if (speaker!.split(/\s+/).length > 3) return;

    // What was said, rather than a figure or a link the line is filed under.
    if (!/[a-z]/.test(remark!)) return;

    recordPerson(found, speaker!, "interlocutor", line, undefined, true);
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
            if (!statusToRole(cells[index])) {
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
        if (cell.length > 240) continue;
        harvestLabeledText(found, toPlainText(cell), toPlainText(line));
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
export function extractContributors(markdown: string): ExtractedContributor[] {
    const found = new Map<string, ExtractedContributor>();

    // The report section being read, if any. Under one of these a bare name is
    // a person rather than a phrase that looks like one.
    //
    // Indentation is what bounds it. The agenda lists its reporters and stops,
    // but the minutes write down what each of them said underneath their name,
    // and a run that ended at the first line it could not read as a person
    // ended at "Increase black visibility and retention of black students on
    // campus" -- which is Oluwanifemi's report, not the end of the reports.
    let reports: { heading: number; items: number | null } | null = null;

    for (const rawLine of markdown.split(/\r?\n/)) {
        if (rawLine.includes("|")) {
            harvestAttendanceTable(found, rawLine);
            continue;
        }

        const line = toPlainText(rawLine);
        if (!line || line.length > 500) continue;

        const indent = indentOf(rawLine);
        if (reports && (HEADING_LINE.test(rawLine) || indent <= reports.heading)) {
            reports = null;
        }

        // Checked before the run below, because the heading that opens a
        // report section is itself nested under "Reports".
        if (REPORTS_LABEL.test(line) || REPORTS_HEADING.test(line)) {
            reports = { heading: indent, items: null };
            continue;
        }

        // A labelled line means what its label says, in a report section as
        // much as anywhere else: the advisor under "Advisor Report:" is staff.
        if (harvestLabeledText(found, line, line) > 0) continue;

        if (harvestConfirmation(found, line)) continue;

        if (reports) {
            // The first line under the heading sets the depth its people sit
            // at. Anything deeper is one of them talking, and is left to
            // harvestSpeaker rather than ending the list.
            reports.items ??= indent;
            if (indent <= reports.items) {
                if (!harvestReportItem(found, line)) reports = null;
                continue;
            }
        }

        harvestSpeaker(found, rawLine, line);
    }

    return [...found.values()];
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
