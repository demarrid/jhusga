import { SESSION_NUMBER } from "@/config/session";
import { isAttendanceSheet, parseAttendanceSheet } from "@/lib/attendance";
import { nameKey } from "@/lib/contributors";
import { parseCsvLine } from "@/lib/csv";
import { resolveAffiliates } from "@/lib/names";
import { toPlainText } from "@/lib/markdown";
import { canonicalOffices } from "@/lib/offices";
import { prisma } from "@/lib/prisma";

/**
 * Turning the current session's contact list into a directory.
 *
 * Membership is the current-session email / contact list — not the roster
 * spreadsheet, which is often leftover from elections and still names people
 * who have since left. Offices come from recent minutes first (the GBM
 * officer block), then from the roster only for people already on the list.
 * Every office and email keeps the passage it was read from, so a stale
 * claim is inspectable.
 *
 * The email list is a Google Doc whose table export jams every name into one
 * cell and every address into another, so names and emails are paired by the
 * JHU local-part convention (ssumi2 → Sumire Sumi) rather than by row. Group
 * inboxes are taken only from current-session documents that actually tell
 * the reader to write to that address.
 */

export const DIRECTORY_GROUPS = [
    "executive",
    "senate",
    "caucus",
    "judiciary",
    "cse",
    "programming",
    "staff",
    "other",
] as const;

export type DirectoryGroup = (typeof DIRECTORY_GROUPS)[number];

export type DirectoryCitation = {
    documentId: string;
    documentTitle: string;
    quote: string;
};

export type DirectoryMember = {
    name: string;
    email: string | null;
    positions: string[];
    group: DirectoryGroup;
    /** Senate class / constituency, when the office names one. */
    subgroup?: string | null;
    /** Standing committees sat on, from the attendance sheet. */
    committees?: string[];
    emailSource?: DirectoryCitation | null;
    positionSources?: (DirectoryCitation | null)[];
    /** Where the committee list was read from. */
    committeeSource?: DirectoryCitation | null;
};

export type GroupInbox = {
    email: string;
    label: string;
    evidence: string;
    documentId: string;
    documentTitle: string;
};

export type DirectorySource = {
    id: string;
    title: string;
};

export type DirectoryDocument = {
    id: string;
    title: string;
    content: string;
    kind?: string;
    folderPath?: string;
    driveModifiedTime?: Date | string | null;
};

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

const SECTION_HEADERS: Record<string, DirectoryGroup> = {
    exec: "executive",
    executive: "executive",
    senators: "senate",
    senate: "senate",
    programming: "programming",
    "programming council": "programming",
    staff: "staff",
    advisors: "staff",
    advisor: "staff",
};

const CLASS_YEAR = /^20\d{2}$/;

export function isDirectoryDocument(input: {
    title: string;
    kind?: string;
    folderPath?: string;
}): boolean {
    if (input.kind === "directory") return true;
    const haystack = `${input.folderPath ?? ""} ${input.title}`.toLowerCase();
    return /roster|email list|contact list|directory/.test(haystack);
}

const CLASS_SUBGROUPS = [
    "Senior Class",
    "Junior Class",
    "Sophomore Class",
    "Freshman Class",
] as const;

const SENATE_SUBGROUPS = [
    "Officers",
    ...CLASS_SUBGROUPS,
    "KSAS",
    "WSE",
    "RSO",
] as const;

function classSubgroup(haystack: string): string | null {
    if (/senior class/i.test(haystack)) return "Senior Class";
    if (/junior class/i.test(haystack)) return "Junior Class";
    if (/sophomore class/i.test(haystack)) return "Sophomore Class";
    if (/freshman class|first-?year class/i.test(haystack)) return "Freshman Class";
    return null;
}

export function directorySubgroup(
    group: DirectoryGroup,
    positions: string[],
): string | null {
    const haystack = positions.join(" ");
    if (group === "senate") {
        const year = classSubgroup(haystack);
        if (year) return year;
        if (/\bksas\b/i.test(haystack)) return "KSAS";
        if (/\bwse\b/i.test(haystack)) return "WSE";
        if (/\brso\b/i.test(haystack)) return "RSO";
        if (/president of the senate/i.test(haystack)) return "Officers";
    }
    // Programming runs one council per class, and the councils are the only
    // structure the section has.
    if (group === "programming") return classSubgroup(haystack);
    return null;
}

function subgroupOrder(group: DirectoryGroup): readonly string[] {
    if (group === "senate") return SENATE_SUBGROUPS;
    if (group === "programming") return CLASS_SUBGROUPS;
    return [];
}

/**
 * A subgroup only means something inside the group that defines it. The Chair
 * of Programming also sits on the Junior Class council; she belongs under
 * Executive, not under a "Junior Class" heading there.
 */
function validSubgroup(
    group: DirectoryGroup,
    subgroup: string | null | undefined,
): string | null {
    if (!subgroup) return null;
    return subgroupOrder(group).includes(subgroup) ? subgroup : null;
}

function subgroupRank(group: DirectoryGroup, subgroup: string | null): number {
    const order = subgroupOrder(group);
    const index = order.indexOf(subgroup ?? "");
    return index === -1 ? order.length : index;
}

function seatRank(positions: string[]): number {
    const joined = positions.join(" ");
    if (/class president/i.test(joined)) return 0;
    const numbered = /\b(?:senator\s*)?(\d+)\b/i.exec(joined);
    if (numbered) return Number(numbered[1]);
    return 50;
}

export function membersByGroup<
    T extends { group: DirectoryGroup; subgroup?: string | null; name: string; positions: string[] },
>(
    members: T[],
): {
    group: DirectoryGroup;
    label: string;
    subgroups: { key: string | null; label: string | null; members: T[] }[];
}[] {
    return DIRECTORY_GROUPS.map((group) => {
        const inGroup = members.filter((member) => member.group === group);
        const subgroupOf = (member: T): string =>
            validSubgroup(group, member.subgroup) ??
            directorySubgroup(group, member.positions) ??
            "";

        const keys = [...new Set(inGroup.map(subgroupOf))];
        keys.sort((a, b) => {
            const rank =
                subgroupRank(group, a || null) - subgroupRank(group, b || null);
            if (rank !== 0) return rank;
            return a.localeCompare(b);
        });

        return {
            group,
            label: directoryGroupLabel(group),
            subgroups: keys.map((key) => ({
                key: key || null,
                label: key || null,
                members: inGroup
                    .filter((member) => subgroupOf(member) === key)
                    .sort((a, b) => {
                        const seat = seatRank(a.positions) - seatRank(b.positions);
                        if (seat !== 0) return seat;
                        return a.name.localeCompare(b.name);
                    }),
            })),
        };
    }).filter((section) => section.subgroups.some((sub) => sub.members.length > 0));
}

export function directoryGroupLabel(group: DirectoryGroup): string {
    switch (group) {
        case "executive":
            return "Executive";
        case "senate":
            return "Senate";
        case "caucus":
            return "Caucuses";
        case "judiciary":
            return "Judiciary";
        case "cse":
            return "Committee on Student Elections";
        case "programming":
            return "Programming Council";
        case "staff":
            return "Staff";
        case "other":
            return "Also listed";
    }
}

function titleCaseName(parts: string[]): string {
    return parts
        .map((part) => part.trim())
        .filter(Boolean)
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
}

const GENERATIONAL = /^(?:III|II|IV|Jr|Sr)\.?$/i;
const NOT_A_NAME = /^(?:programming|council|senate|exec|executive|staff|name|email|role|members?)$/i;

function isNameToken(token: string): boolean {
    if (GENERATIONAL.test(token)) return true;
    if (NOT_A_NAME.test(token)) return false;
    return /^[A-Z][A-Za-z'’.-]*$/.test(token) && token !== token.toUpperCase();
}

/**
 * Pull Title-Case names out of a jammed cell ("Sumire Sumi Honora Muratori").
 *
 * Every 2-to-4-token window is a candidate, because the export has no
 * separators. Pairing then keeps the window that actually matches an email.
 */
export function extractWrittenNames(text: string): string[] {
    const tokens = toPlainText(text)
        .replace(EMAIL_RE, " ")
        .split(/\s+/)
        .filter(Boolean);

    const names: string[] = [];
    const seen = new Set<string>();

    for (let start = 0; start < tokens.length; start += 1) {
        if (!isNameToken(tokens[start]!)) continue;

        for (let length = 2; length <= 4; length += 1) {
            const parts = tokens.slice(start, start + length);
            if (parts.length < length) continue;
            if (!parts.every((token) => isNameToken(token))) continue;

            const name = titleCaseName(parts);
            const key = nameKey(name);
            if (seen.has(key)) continue;
            seen.add(key);
            names.push(name);
        }
    }

    return names;
}

export function extractEmails(text: string): string[] {
    const found = text.match(EMAIL_RE) ?? [];
    const unique: string[] = [];
    const seen = new Set<string>();
    for (const raw of found) {
        const email = raw.toLowerCase();
        if (seen.has(email)) continue;
        seen.add(email);
        unique.push(email);
    }
    return unique;
}

function localStem(email: string): string {
    return (email.split("@")[0] ?? "").toLowerCase().replace(/[^a-z]/g, "");
}

/**
 * How well a JHU local-part matches a written name. 3 is initial+surname
 * exact (ssumi2 / Sumire Sumi); 0 is no overlap.
 */
export function emailNameScore(name: string, email: string): number {
    const tokens = nameKey(name).split(" ").filter(Boolean);
    if (tokens.length === 0) return 0;

    const stem = localStem(email);
    if (stem.length < 2) return 0;

    const given = tokens[0]!;
    const surname = tokens[tokens.length - 1]!;
    const initialSurname = `${given[0]}${surname}`;

    if (stem === initialSurname) return 3;
    if (stem.startsWith(initialSurname) || initialSurname.startsWith(stem)) {
        if (Math.min(stem.length, initialSurname.length) >= 4) return 3;
    }

    if (stem[0] === given[0]) {
        const rest = stem.slice(1);
        if (rest.length >= 3 && (surname.startsWith(rest) || rest.startsWith(surname.slice(0, 5)))) {
            return 2;
        }
        for (const token of tokens.slice(1)) {
            if (token.length >= 4 && rest.startsWith(token.slice(0, 5))) return 2;
        }
    }

    if (tokens.some((token) => token.length >= 4 && stem.includes(token))) return 1;
    if (tokens.some((token) => token.length >= 4 && token.includes(stem))) return 1;

    return 0;
}

export function pairNamesToEmails(
    names: string[],
    emails: string[],
): { name: string; email: string }[] {
    const shorterFirst = [...names].sort(
        (a, b) => nameKey(a).split(" ").length - nameKey(b).split(" ").length,
    );
    const remainingNames = shorterFirst;
    const pairs: { name: string; email: string }[] = [];
    const usedEmails = new Set<string>();

    const tryThreshold = (minimum: number) => {
        for (const email of emails) {
            if (usedEmails.has(email)) continue;

            const scored = remainingNames
                .map((name, index) => ({
                    name,
                    index,
                    score: emailNameScore(name, email),
                    tokens: nameKey(name).split(" ").length,
                }))
                .filter((row) => row.score >= minimum)
                .sort((a, b) => b.score - a.score || a.tokens - b.tokens);

            if (scored.length === 0) continue;
            if (
                scored.length > 1 &&
                scored[0]!.score === scored[1]!.score &&
                scored[0]!.tokens === scored[1]!.tokens
            ) {
                continue;
            }

            const winner = scored[0]!;
            pairs.push({ name: winner.name, email });
            remainingNames.splice(winner.index, 1);
            usedEmails.add(email);
        }
    };

    tryThreshold(3);
    tryThreshold(2);
    tryThreshold(1);

    return pairs;
}

type MutableMember = {
    name: string;
    email: string | null;
    positions: string[];
    group: DirectoryGroup;
    subgroup: string | null;
    committees: string[];
    emailSource: DirectoryCitation | null;
    positionSources: (DirectoryCitation | null)[];
    committeeSource: DirectoryCitation | null;
    /** Minutes named this person in the current officer block. */
    authoritative: boolean;
};

function blankMember(
    input: Pick<MutableMember, "name" | "email" | "group"> &
        Partial<Pick<MutableMember, "positions" | "emailSource" | "authoritative">>,
): MutableMember {
    const positions = input.positions ?? [];
    return {
        name: input.name.trim(),
        email: input.email?.toLowerCase() ?? null,
        positions,
        group: input.group,
        subgroup: directorySubgroup(input.group, positions),
        committees: [],
        emailSource: input.emailSource ?? null,
        positionSources: positions.map(() => null),
        committeeSource: null,
        authoritative: input.authoritative ?? false,
    };
}

function publishedMember(member: MutableMember): DirectoryMember {
    // A subgroup read from the attendance sheet stands: it says "RSO" or
    // "Freshman Class" outright, where a seat title only sometimes implies one.
    member.subgroup =
        validSubgroup(member.group, member.subgroup) ??
        directorySubgroup(member.group, member.positions);
    return {
        name: member.name,
        email: member.email,
        positions: member.positions,
        group: member.group,
        subgroup: member.subgroup,
        committees: member.committees,
        emailSource: member.emailSource,
        positionSources: member.positionSources,
        committeeSource: member.committeeSource,
    };
}

function groupRank(group: DirectoryGroup): number {
    return DIRECTORY_GROUPS.indexOf(group);
}

function preferGroup(current: DirectoryGroup, incoming: DirectoryGroup): DirectoryGroup {
    return groupRank(incoming) < groupRank(current) ? incoming : current;
}

function isRealPersonName(name: string): boolean {
    const key = nameKey(name);
    const tokens = key.split(" ").filter(Boolean);
    if (tokens.length < 2) return false;
    if (tokens.some((token) => /^(name|email|role|exec|senators?|programming|council)$/.test(token))) {
        return false;
    }
    return true;
}

function upsertMember(
    byKey: Map<string, MutableMember>,
    input: {
        name: string;
        email?: string | null;
        position?: string | null;
        group: DirectoryGroup;
        /** Standalone staff lines win over a guessed Programming Council tag. */
        forceGroup?: boolean;
    },
): void {
    const key = nameKey(input.name);
    if (!key || !isRealPersonName(input.name)) return;

    const existing = byKey.get(key);
    if (!existing) {
        const created = blankMember({
            name: input.name,
            email: input.email ?? null,
            group: input.group,
            positions: input.position ? [input.position] : [],
        });
        byKey.set(key, created);
        return;
    }

    if (input.email && !existing.email) existing.email = input.email.toLowerCase();
    if (input.position && !existing.positions.includes(input.position)) {
        const covered = existing.positions.findIndex(
            (held) => held.includes(input.position!) || input.position!.includes(held),
        );
        if (covered === -1) {
            existing.positions.push(input.position);
            existing.positionSources.push(null);
        } else if (
            input.position.includes(existing.positions[covered]!) &&
            input.position.length > existing.positions[covered]!.length
        ) {
            existing.positions[covered] = input.position;
        }
    }
    existing.group = input.forceGroup
        ? input.group
        : preferGroup(existing.group, input.group);
    existing.subgroup =
        existing.subgroup ?? directorySubgroup(existing.group, existing.positions);

    // Prefer the longer / more complete spelling ("Kayla Marie Gonzalez").
    if (input.name.trim().length > existing.name.length) existing.name = input.name.trim();
}

function groupForOffice(office: string, section: DirectoryGroup): DirectoryGroup {
    if (/caucus/i.test(office)) return "caucus";
    if (CLASS_YEAR.test(office.trim())) return "programming";
    if (/staff|advisor|adviser|faculty|admin/i.test(office)) return "staff";
    return section;
}

export function parseRosterCsv(csv: string): DirectoryMember[] {
    const byKey = new Map<string, MutableMember>();
    let section: DirectoryGroup = "other";

    for (const rawLine of csv.split(/\r?\n/)) {
        const cells = parseCsvLine(rawLine);
        if (cells.every((cell) => !cell)) continue;

        const first = cells[0] ?? "";
        const last = cells[1] ?? "";
        const office = cells[2] ?? "";
        const header = nameKey(first);

        if (!last && !office && header) {
            if (header === "name") continue;
            section = SECTION_HEADERS[header] ?? section;
            continue;
        }

        const name = titleCaseName([first, last]);
        if (!name || nameKey(name).split(" ").length < 2) continue;

        // The roster is the one source that numbers seats and jams two offices
        // into a cell, so it is where the spellings are reconciled.
        const positions = CLASS_YEAR.test(office)
            ? ["Programming Council"]
            : canonicalOffices(office);
        const group = groupForOffice(office, section);

        if (positions.length === 0) {
            upsertMember(byKey, { name, position: null, group });
            continue;
        }

        for (const position of positions) {
            upsertMember(byKey, { name, position, group });
        }
    }

    return [...byKey.values()];
}

export function parseEmailList(markdown: string): DirectoryMember[] {
    const byKey = new Map<string, MutableMember>();
    const names = extractWrittenNames(markdown);
    const emails = extractEmails(markdown);

    const header = markdown.search(/programming\s+council/i);
    const programmingNames = new Set(
        header === -1 ? [] : extractWrittenNames(markdown.slice(header)).map((name) => nameKey(name)),
    );

    for (const pair of pairNamesToEmails(names, emails)) {
        upsertMember(byKey, {
            name: pair.name,
            email: pair.email,
            group: programmingNames.has(nameKey(pair.name)) ? "programming" : "other",
        });
    }

    // "Jessica Snell\njsnell11@jh.edu" — a name on its own line, address next.
    // toPlainText collapses newlines, so this reads the raw markdown lines.
    const lines = markdown
        .split(/\n+/)
        .map((line) => toPlainText(line).trim())
        .filter(Boolean);
    for (let index = 0; index < lines.length - 1; index += 1) {
        const nameLine = lines[index]!;
        const emailLine = extractEmails(lines[index + 1]!)[0];
        if (!emailLine) continue;
        if (extractWrittenNames(nameLine).length !== 1 && nameKey(nameLine).split(" ").length < 2) {
            continue;
        }
        const name =
            extractWrittenNames(nameLine).find((candidate) => nameKey(candidate) === nameKey(nameLine)) ??
            nameLine;
        if (nameKey(name).split(" ").length < 2) continue;
        upsertMember(byKey, { name, email: emailLine, group: "staff", forceGroup: true });
    }

    return [...byKey.values()];
}

export function parseDirectoryDocument(input: {
    title: string;
    content: string;
}): DirectoryMember[] {
    const title = input.title.toLowerCase();
    if (/roster/.test(title) || /^name,/im.test(input.content)) {
        return parseRosterCsv(input.content);
    }
    if (/email list|contact list/.test(title)) {
        return parseEmailList(input.content);
    }
    if (extractEmails(input.content).length > 0) {
        return parseEmailList(input.content);
    }
    return [];
}

export function assignLeftoverEmails(
    members: DirectoryMember[],
    emails: string[],
): void {
    const used = new Set(
        members.map((member) => member.email).filter((email): email is string => Boolean(email)),
    );

    for (const email of emails) {
        if (used.has(email)) continue;

        const scored = members
            .filter((member) => !member.email)
            .map((member) => ({ member, score: emailNameScore(member.name, email) }))
            .filter((row) => row.score >= 2)
            .sort((a, b) => b.score - a.score);

        if (scored.length === 0) continue;
        if (scored.length > 1 && scored[0]!.score === scored[1]!.score) continue;

        scored[0]!.member.email = email;
        used.add(email);
    }
}

function preferStructuredName(member: MutableMember, incoming: string): void {
    const next = incoming.trim();
    if (!next) return;
    const incomingTokens = nameKey(next).split(" ").filter(Boolean).length;
    const currentTokens = nameKey(member.name).split(" ").filter(Boolean).length;
    if (incomingTokens >= currentTokens) member.name = next;
}

function findCurrentMember(
    current: Map<string, MutableMember>,
    incoming: { name: string; email?: string | null },
): MutableMember | null {
    const exact = current.get(nameKey(incoming.name));
    if (exact) return exact;

    if (incoming.email) {
        const byEmail = [...current.values()].find(
            (member) => member.email === incoming.email,
        );
        if (byEmail) return byEmail;

        const scored = [...current.values()]
            .map((member) => ({
                member,
                score: emailNameScore(member.name, incoming.email!),
            }))
            .filter((row) => row.score >= 2)
            .sort((a, b) => b.score - a.score);

        if (
            scored.length === 1 ||
            (scored.length > 1 && scored[0]!.score > scored[1]!.score)
        ) {
            return scored[0]!.member;
        }
    }

    const close = [...current.values()].filter((member) =>
        namesLikelySame(member.name, incoming.name),
    );
    if (close.length === 1) return close[0]!;

    return null;
}

function namesLikelySame(left: string, right: string): boolean {
    const a = nameKey(left).split(" ").filter(Boolean);
    const b = nameKey(right).split(" ").filter(Boolean);
    if (a.length < 2 || b.length < 2) return false;

    const givenClose =
        a[0] === b[0] ||
        (Math.min(a[0]!.length, b[0]!.length) >= 4 &&
            (a[0]!.startsWith(b[0]!) || b[0]!.startsWith(a[0]!)));
    if (!givenClose) return false;

    const surnameA = a[a.length - 1]!;
    const surnameB = b[b.length - 1]!;
    if (surnameA === surnameB) return true;
    if (surnameA.startsWith(surnameB) || surnameB.startsWith(surnameA)) return true;

    // One typo in a long surname, and only there. The SGA has a Grace Wang, a
    // Grace Yang and a Grace Guan; any looser and they become one person.
    const shortest = Math.min(surnameA.length, surnameB.length);
    return shortest >= 6 && editDistance(surnameA, surnameB) <= 1;
}

function editDistance(left: string, right: string): number {
    if (left === right) return 0;
    const rows = left.length + 1;
    const cols = right.length + 1;
    const grid: number[][] = Array.from({ length: rows }, (_, row) =>
        Array.from({ length: cols }, (__, col) => (row === 0 ? col : col === 0 ? row : 0)),
    );
    for (let row = 1; row < rows; row += 1) {
        for (let col = 1; col < cols; col += 1) {
            const cost = left[row - 1] === right[col - 1] ? 0 : 1;
            grid[row]![col] = Math.min(
                grid[row - 1]![col]! + 1,
                grid[row]![col - 1]! + 1,
                grid[row - 1]![col - 1]! + cost,
            );
        }
    }
    return grid[left.length]![right.length]!;
}

/**
 * The email / contact list is the roll. Roster rows only attach offices onto
 * people already listed — a name that appears only on an old roster is dropped.
 */
export function mergeDirectoryMembers(lists: DirectoryMember[][]): DirectoryMember[] {
    const current = new Map<string, MutableMember>();
    const offices: DirectoryMember[] = [];

    for (const list of lists) {
        for (const member of list) {
            if (member.positions.length > 0) {
                offices.push(member);
            } else {
                upsertMember(current, {
                    name: member.name,
                    email: member.email,
                    group: member.group,
                    forceGroup: member.group === "staff",
                });
            }
        }
    }

    for (const member of offices) {
        const match = findCurrentMember(current, member);
        if (!match) continue;

        preferStructuredName(match, member.name);
        if (member.email && !match.email) match.email = member.email;
        for (const position of member.positions) {
            addPosition(match, position, null, member.group);
        }
    }

    return [...current.values()]
        .map(publishedMember)
        .sort((a, b) => {
            const group = groupRank(a.group) - groupRank(b.group);
            if (group !== 0) return group;
            return a.name.localeCompare(b.name);
        });
}

function isSgaInbox(email: string): boolean {
    const [local = "", domain = ""] = email.toLowerCase().split("@");
    if (!/(?:jh\.edu|jhu\.edu)$/.test(domain)) return false;
    if (/^(sga|senate|judicial)([-_.]|$)/.test(local)) return true;
    return /sga|senate|judicial|programmingcouncil|sgaprogramming/.test(local);
}

function looksLikeInstruction(text: string): boolean {
    return /email|e-mail|contact|write to|reach|inbox|mailto|send\b.{0,40}\bto\b/i.test(
        text,
    );
}

export function extractGroupInboxes(
    documents: { id: string; title: string; content: string }[],
): GroupInbox[] {
    const found = new Map<string, GroupInbox>();

    for (const document of documents) {
        const text = document.content;
        for (const match of text.matchAll(EMAIL_RE)) {
            const email = match[0].toLowerCase();
            if (!isSgaInbox(email)) continue;

            const index = match.index ?? 0;
            const context = toPlainText(text.slice(Math.max(0, index - 160), index + 160));
            if (!looksLikeInstruction(context) && !/mailto:/i.test(match[0])) continue;

            if (!found.has(email)) {
                found.set(email, {
                    email,
                    label: inboxLabel(email),
                    evidence: context.replace(/\s+/g, " ").trim().slice(0, 240),
                    documentId: document.id,
                    documentTitle: document.title,
                });
            }
        }
    }

    return [...found.values()].sort((a, b) => a.email.localeCompare(b.email));
}

function inboxLabel(email: string): string {
    const local = email.split("@")[0] ?? "";
    if (local === "sga") return "SGA";
    return local
        .split(/[-_.]/)
        .filter(Boolean)
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(" ");
}

export function isDirectorySheetName(name: string): boolean {
    return /roster|email list|contact list|directory/i.test(name);
}

const EXEC_OFFICES = [
    "President of the Senate",
    "Chair of Programming",
    "Vice President",
    "President",
    "Secretary",
    "Treasurer",
] as const;

const OFFICER_LINE = new RegExp(
    String.raw`(^|\n)\s*(?:#{1,6}\s*)?(?:\d+\.\s*)?(?:Student\s+Body\s+)?(${EXEC_OFFICES.map((office) => office.replace(/ /g, String.raw`\s+`)).join("|")})\s*[-–—:]\s*\*?([A-Z][A-Za-z'’.-]+(?:\s+[A-Z][A-Za-z'’.-]+){0,3})\*?`,
    "gi",
);

const OFFICER_PLACEHOLDER = /^(?:name|tbd|n\/?a|none|insert|student|senator)$/i;

/**
 * A seat in the Senate, which the roster is the least trustworthy source for:
 * its rows are left over from the election, so a seat it claims yields to the
 * attendance sheet and to minutes.
 *
 * Matched on the word rather than on the school, so that it holds for both the
 * canonical "WSE Senator" and the "WSE 1" the roster used to be recorded as.
 */
function isSenateSeat(office: string): boolean {
    return /\bsenator\b|class president|\b(?:ksas|wse|rso)\s*\d+/i.test(office);
}

function isExecOffice(office: string): boolean {
    return EXEC_OFFICES.some(
        (title) => nameKey(title) === nameKey(office.replace(/\s+/g, " ").trim()),
    );
}

export function isOfficerMinutes(input: {
    title: string;
    kind?: string;
}): boolean {
    if (/template/i.test(input.title)) return false;
    if (input.kind?.startsWith("minutes")) return true;
    return /minutes|gbm/i.test(input.title);
}

/**
 * GBM / exec minutes write the current slate as "Treasurer - Amy Xu".
 * Templates that still say "Treasurer - Name" are ignored.
 */
export function extractOfficerAssignments(
    content: string,
): { office: string; name: string; quote: string }[] {
    const text = content.replace(/\\-/g, "-");
    const found: { office: string; name: string; quote: string }[] = [];
    const seen = new Set<string>();

    for (const match of text.matchAll(OFFICER_LINE)) {
        const office = match[2]!.replace(/\s+/g, " ").trim();
        const name = match[3]!.replace(/\s+/g, " ").trim();
        if (OFFICER_PLACEHOLDER.test(name) || nameKey(name).split(" ").length < 2) {
            continue;
        }

        const key = nameKey(office);
        if (seen.has(key)) continue;
        seen.add(key);

        const canonical =
            EXEC_OFFICES.find((title) => nameKey(title) === key) ?? office;
        found.push({
            office: canonical,
            name,
            quote: toPlainText(match[0]).replace(/\s+/g, " ").trim(),
        });
    }

    return found;
}

function citationFrom(
    document: DirectoryDocument,
    quote: string,
): DirectoryCitation {
    return {
        documentId: document.id,
        documentTitle: document.title,
        quote: toPlainText(quote).replace(/\s+/g, " ").trim().slice(0, 240),
    };
}

function modifiedAt(document: DirectoryDocument): number {
    if (!document.driveModifiedTime) return 0;
    return new Date(document.driveModifiedTime).getTime();
}

function officerGroup(office: string): DirectoryGroup {
    return office === "President of the Senate" ? "senate" : "executive";
}

/**
 * Clear out seats an older document claimed, now that minutes have named the
 * current holder of an office.
 *
 * Seats read from the attendance sheet are kept: it is maintained weekly, and
 * a senator who is also Treasurer holds both, unlike a roster row left over
 * from the election.
 */
function dropSupersededOffices(
    member: MutableMember,
    attendanceDocumentId: string | null,
): void {
    const kept: { title: string; source: DirectoryCitation | null }[] = [];
    for (const [index, title] of member.positions.entries()) {
        const source = member.positionSources[index] ?? null;
        const fromAttendance =
            attendanceDocumentId !== null && source?.documentId === attendanceDocumentId;

        // "Executive Board" is all the attendance sheet can say; once minutes
        // name the actual office, listing both is just noise.
        if (nameKey(title) === nameKey("Executive Board")) continue;
        if (!fromAttendance && (isSenateSeat(title) || isExecOffice(title))) continue;
        kept.push({ title, source });
    }
    member.positions = kept.map((row) => row.title);
    member.positionSources = kept.map((row) => row.source);
}

function addPosition(
    member: MutableMember,
    title: string,
    source: DirectoryCitation | null,
    group: DirectoryGroup,
): void {
    const index = member.positions.findIndex(
        (held) => held.toLowerCase() === title.toLowerCase(),
    );
    if (index === -1) {
        member.positions.push(title);
        member.positionSources.push(source);
    } else if (source) {
        member.positions[index] = title;
        member.positionSources[index] = source;
    }
    member.group = preferGroup(member.group, group);
    member.subgroup =
        member.subgroup ?? directorySubgroup(member.group, member.positions);
}

function rosterEvidence(person: DirectoryMember): string {
    const office = person.positions[0] ?? "";
    return `${person.name}, ${office}`.replace(/\s+/g, " ").trim();
}

/**
 * Current-session contact roll, with offices from recent minutes first and
 * the roster only as a chipped fallback for people still on the list.
 */
export function buildSessionDirectory(documents: DirectoryDocument[]): {
    members: DirectoryMember[];
    sources: DirectorySource[];
} {
    const directoryDocs = documents.filter(isDirectoryDocument);
    const emailDocs = directoryDocs.filter((document) => {
        const title = document.title.toLowerCase();
        if (/roster/.test(title)) return false;
        return /email list|contact list/.test(title) || extractEmails(document.content).length > 0;
    });
    const rosterDocs = directoryDocs.filter((document) => {
        const title = document.title.toLowerCase();
        return /roster/.test(title) || /^name,/im.test(document.content);
    });

    const current = new Map<string, MutableMember>();

    for (const document of emailDocs) {
        for (const person of parseEmailList(document.content)) {
            upsertMember(current, {
                name: person.name,
                email: person.email,
                group: person.group,
                forceGroup: person.group === "staff",
            });
            const member = current.get(nameKey(person.name));
            if (member?.email && !member.emailSource) {
                member.emailSource = citationFrom(
                    document,
                    `${person.name} ${person.email}`,
                );
            }
        }
    }

    // The attendance sheet, which is the only document that says what seat
    // each member holds. It runs before the officer block so that a senator
    // named in both is one person, and before the roster so that a stale
    // roster row cannot claim a seat the sheet has already filled.
    const attendanceDocs = documents
        .filter(isAttendanceSheet)
        .sort((a, b) => modifiedAt(b) - modifiedAt(a))
        .slice(0, 1);

    for (const document of attendanceDocs) {
        for (const seated of parseAttendanceSheet(document.content)) {
            const source = citationFrom(document, seated.evidence);
            const match = findCurrentMember(current, { name: seated.name });
            const member =
                match ??
                blankMember({ name: seated.name, email: null, group: seated.group });

            if (!match) current.set(nameKey(member.name), member);

            preferStructuredName(member, seated.name);
            member.subgroup = seated.subgroup ?? member.subgroup;
            addPosition(member, seated.position, source, seated.group);

            for (const committee of seated.committees) {
                if (!member.committees.includes(committee)) {
                    member.committees.push(committee);
                }
            }
            if (seated.committees.length > 0) member.committeeSource = source;
        }
    }

    const officerDocs = documents
        .filter(isOfficerMinutes)
        .sort((a, b) => modifiedAt(b) - modifiedAt(a));
    const officeTaken = new Set<string>();

    for (const document of officerDocs) {
        for (const row of extractOfficerAssignments(document.content)) {
            const officeKey = nameKey(row.office);
            if (officeTaken.has(officeKey)) continue;
            officeTaken.add(officeKey);

            const source = citationFrom(document, row.quote);
            const match = findCurrentMember(current, { name: row.name });
            const member =
                match ??
                blankMember({
                    name: row.name,
                    email: null,
                    group: officerGroup(row.office),
                    authoritative: true,
                });

            if (!match) current.set(nameKey(member.name), member);

            if (row.name.trim().length > member.name.length) {
                member.name = row.name.trim();
            }
            dropSupersededOffices(member, attendanceDocs[0]?.id ?? null);
            addPosition(member, row.office, source, officerGroup(row.office));
            member.authoritative = true;
        }
    }

    for (const document of rosterDocs) {
        for (const person of parseRosterCsv(document.content)) {
            const member = findCurrentMember(current, person);
            if (!member) continue;

            preferStructuredName(member, person.name);

            for (const position of person.positions) {
                if (member.authoritative && (isSenateSeat(position) || isExecOffice(position))) {
                    continue;
                }
                addPosition(
                    member,
                    position,
                    citationFrom(document, rosterEvidence({ ...person, positions: [position] })),
                    person.group,
                );
            }
        }
    }

    assignLeftoverEmails(
        [...current.values()],
        emailDocs.flatMap((document) => extractEmails(document.content)),
    );
    for (const member of current.values()) {
        if (member.email && !member.emailSource && emailDocs[0]) {
            member.emailSource = citationFrom(
                emailDocs[0],
                `${member.name} ${member.email}`,
            );
        }
    }

    const sources = [...emailDocs, ...attendanceDocs, ...rosterDocs, ...officerDocs.filter((document) =>
        extractOfficerAssignments(document.content).length > 0,
    )].filter(
        (document, index, all) => all.findIndex((other) => other.id === document.id) === index,
    );

    return {
        members: [...current.values()].map(publishedMember).sort((a, b) => {
            const group = groupRank(a.group) - groupRank(b.group);
            if (group !== 0) return group;
            const sub =
                subgroupRank(a.group, a.subgroup ?? null) -
                subgroupRank(b.group, b.subgroup ?? null);
            if (sub !== 0) return sub;
            const seat = seatRank(a.positions) - seatRank(b.positions);
            if (seat !== 0) return seat;
            return a.name.localeCompare(b.name);
        }),
        sources: sources.map((document) => ({
            id: document.id,
            title: document.title,
        })),
    };
}

/**
 * Write emails and roster offices onto affiliates so other pages can use them.
 * The contact page itself re-reads the source documents.
 */
export async function recordDirectory(
    session: number = SESSION_NUMBER,
): Promise<{ members: number; emails: number; offices: number }> {
    const documents = await prisma.document.findMany({
        where: { sessionNumber: session },
        select: {
            id: true,
            title: true,
            content: true,
            kind: true,
            folderPath: true,
            driveModifiedTime: true,
        },
    });

    const { members } = buildSessionDirectory(documents);

    const affiliateIds = await resolveAffiliates(
        members.map((member) => ({
            name: member.name,
            evidence: member.positions.join(", ") || member.email || member.name,
        })),
    );

    let emails = 0;
    let offices = 0;
    const keep: { affiliateId: string; categoryId: string }[] = [];

    for (const [index, member] of members.entries()) {
        const affiliateId = affiliateIds[index]!;

        if (member.email) {
            const clash = await prisma.hopkinsAffiliate.findFirst({
                where: { email: member.email, NOT: { id: affiliateId } },
                select: { id: true },
            });
            if (!clash) {
                await prisma.hopkinsAffiliate.update({
                    where: { id: affiliateId },
                    data: { email: member.email },
                });
                emails += 1;
            }
        }

        for (const office of member.positions) {
            const category = await prisma.hopkinsCategory.upsert({
                where: { type_name: { type: "position", name: office } },
                create: { type: "position", name: office },
                update: {},
                select: { id: true },
            });

            const held = await prisma.hopkinsRelationship.findFirst({
                where: {
                    hopkinsAffiliateId: affiliateId,
                    hopkinsCategoryId: category.id,
                    endedAt: null,
                },
                select: { id: true },
            });

            if (!held) {
                await prisma.hopkinsRelationship.create({
                    data: {
                        hopkinsAffiliateId: affiliateId,
                        hopkinsCategoryId: category.id,
                    },
                });
            }

            keep.push({ affiliateId, categoryId: category.id });
            offices += 1;
        }
    }

    const open = await prisma.hopkinsRelationship.findMany({
        where: { endedAt: null, hopkinsCategory: { type: "position" } },
        select: { id: true, hopkinsAffiliateId: true, hopkinsCategoryId: true },
    });

    const keepKeys = new Set(keep.map((row) => `${row.affiliateId}:${row.categoryId}`));
    const stale = open.filter(
        (row) => !keepKeys.has(`${row.hopkinsAffiliateId}:${row.hopkinsCategoryId}`),
    );
    if (stale.length > 0) {
        await prisma.hopkinsRelationship.updateMany({
            where: { id: { in: stale.map((row) => row.id) } },
            data: { endedAt: new Date() },
        });
    }

    return { members: members.length, emails, offices };
}
