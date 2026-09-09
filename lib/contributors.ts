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

/** Human label for a role, for listings and filters. */
export function contributorRoleLabel(role: string): string {
    switch (role) {
        case "introducer":
            return "Introduced";
        case "sponsor":
            return "Sponsored";
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
    { pattern: /^here$/i, role: "present", firstNames: true },
];

/**
 * Parenthetical text that names an office rather than annotating attendance.
 * "(CE Chair)" is a role; "(leaving early)" is not.
 */
const OFFICE_WORDS =
    /\b(chair|president|vice|secretary|treasurer|senator|director|specialist|coordinator|advisor|adviser|dean|officer|representative|liaison|justice|parliamentarian)\b/i;

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
]);

/**
 * Titles written in front of a name: "Chair Angela Xiong", "Senators Daarian
 * Rouhani". The title is an office the person holds, not part of what they are
 * called, so it is peeled off and recorded separately -- otherwise the same
 * person becomes two people the moment a document drops their title.
 */
const LEADING_TITLE =
    /^(?:(vice[-\s]?chair|co[-\s]?chair|chairs?|vice[-\s]?president|president|secretary|treasurer|senators?|justices?|parliamentarian|dr|prof|professor|mr|ms|mrs)\.?\s+)/i;

/** Canonical spelling of a stripped title. */
function normaliseTitle(raw: string): string {
    const cleaned = raw.toLowerCase().replace(/[-\s]+/g, " ").replace(/s$/, "");
    return cleaned
        .split(" ")
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(" ");
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
 * Handles "Chair Angela Xiong", "Jackson Morris (CE Chair)", and
 * "Shreemann Patel, Chair".
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

    const titled = LEADING_TITLE.exec(working);
    working = working.replace(LEADING_TITLE, "").trim();

    if (!isPlausibleName(working)) return null;

    const parenIsOffice = parenthetical ? OFFICE_WORDS.test(parenthetical) : false;

    return {
        name: working,
        office: parenIsOffice
            ? parenthetical
            : commaOffice
                ? commaOffice
                : titled
                    ? normaliseTitle(titled[1])
                    : null,
        note: parenthetical && !parenIsOffice ? parenthetical : null,
    };
}

function recordPerson(
    found: Map<string, ExtractedContributor>,
    candidate: string,
    role: ContributorRole,
    evidence: string,
): void {
    const parsed = parsePersonToken(candidate);
    if (!parsed) return;

    const key = `${nameKey(parsed.name)}::${role}`;
    if (found.has(key)) return;

    found.set(key, {
        name: parsed.name,
        role,
        office: parsed.office,
        note: parsed.note,
        evidence: evidence.slice(0, 300),
    });
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
): void {
    for (const segment of labeledSegments(text)) {
        for (const candidate of splitPeople(segment.names, segment.firstNames)) {
            recordPerson(found, candidate, segment.role, evidence);
        }
    }
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

/**
 * Read every person named by a labelled line or attendance table.
 *
 * Returns at most one entry per (name, role) pair.
 */
export function extractContributors(markdown: string): ExtractedContributor[] {
    const found = new Map<string, ExtractedContributor>();

    for (const rawLine of markdown.split(/\r?\n/)) {
        if (rawLine.includes("|")) {
            harvestAttendanceTable(found, rawLine);
            continue;
        }

        const line = toPlainText(rawLine);
        if (!line || line.length > 500) continue;
        harvestLabeledText(found, line, line);
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
