import { extractContributors, nameKey, type ContributorRole } from "@/lib/contributors";
import { diminutiveCandidates, givenNameCandidates, isShortForm, surnameCandidates, type RegularPerson } from "@/lib/names";

/** Contributor rows written by `npm run people -- --short`. A later full extraction does not delete them. */
export const SHORT_SOURCE = "short";

const NEAR_MS = 120 * 24 * 60 * 60 * 1000;

const CLASS_LABEL = /^(?:fresh(?:m[ae]n)?|soph(?:omores?)?|juniors?|seniors?)\s*[:\-–—]/i;

const CONTEXT_STOP = new Set([
    "about", "after", "again", "being", "class", "committee", "council", "executive",
    "first", "hopkins", "introduced", "meeting", "minutes", "other", "present",
    "president", "report", "senate", "senator", "sponsored", "student", "their",
    "there", "these", "those", "under", "which", "while", "would",
]);

export type ShortNameSeat = { startedAt: Date | null; endedAt: Date | null };

export type ShortNameAppearance = {
    sessionNumber: number | null;
    datedAt: Date | null;
    evidence: string;
};

export type ShortNamePerson = {
    id: string;
    name: string;
    seats: ShortNameSeat[];
    appearances: ShortNameAppearance[];
};

export type ShortNameMention = { name: string; evidence: string; role: ContributorRole };

export type ShortNameContext = {
    asOf?: Date | null;
    sessionNumber?: number | null;
    text: string;
    evidence: string;
};

export function textHasFullName(text: string, name: string): boolean {
    const tokens = nameKey(name).split(" ").filter(Boolean);
    if (tokens.length < 2) return false;
    return ` ${nameKey(text)} `.includes(` ${tokens.join(" ")} `);
}

/** A dated seat covers `asOf`. A null start never does. */
export function seatCovers(seat: ShortNameSeat, asOf: Date): boolean {
    if (!seat.startedAt || seat.startedAt > asOf) return false;
    return !seat.endedAt || seat.endedAt > asOf;
}

/**
 * "Soph:" beside Freshmen and Juniors is the sophomore class report, not a person.
 * One label is not enough: a real nickname can sit on its own line.
 */
export function isClassReportLabel(name: string, text: string): boolean {
    const key = nameKey(name);
    if (!/^(?:fresh(?:m[ae]n)?|soph(?:omores?)?|juniors?|seniors?)$/.test(key)) return false;
    const labels = new Set(
        text.split(/\r?\n/).map((line) => CLASS_LABEL.exec(line.trim())?.[0] ?? "").filter(Boolean)
            .map((label) => nameKey(label.split(/[:\-–—]/)[0] ?? "")),
    );
    return labels.size >= 2;
}

function plainLine(line: string): string {
    return line
        .replace(/[\u200b-\u200d\ufeff]/g, "")
        .replace(/^\s*(?:[-*+]|\d+[.)])\s+/, "")
        .replace(/^#+\s+/, "")
        .trim();
}

/** "Peabuddies - Sophia" and "Art Gives - Ashley, Kamil". A remark after a speaker dash is not this. */
export function groupShortNames(line: string): { name: string; evidence: string }[] {
    const text = plainLine(line);
    const match = /^(.+?)\s+[-–—]\s+([A-Z][A-Za-z'’-]+(?:\s*,\s*[A-Z][A-Za-z'’-]+)*)$/.exec(text);
    if (!match) return [];
    return match[2]!.split(/\s*,\s*/).map((name) => name.trim()).filter((name) => isShortForm(name))
        .map((name) => ({ name, evidence: text }));
}

export function shortNameMentions(content: string, title?: string, kind?: string): ShortNameMention[] {
    const found = new Map<string, ShortNameMention>();
    const text = content.replace(/[\u200b-\u200d\ufeff]/g, "");
    for (const person of extractContributors(text, title, kind)) {
        if (!isShortForm(person.name)) continue;
        found.set(`${nameKey(person.name)}\n${person.evidence}`, person);
    }
    for (const raw of text.split(/\r?\n/)) {
        for (const person of groupShortNames(raw)) {
            const key = `${nameKey(person.name)}\n${person.evidence}`;
            if (!found.has(key)) found.set(key, { ...person, role: "mentioned" });
        }
    }
    return [...found.values()];
}

function asRegular(person: ShortNamePerson): RegularPerson {
    return {
        id: person.id,
        name: person.name,
        nameKey: nameKey(person.name),
        documentCount: person.appearances.length,
        positions: [],
        bodies: [],
    };
}

function contextTokens(text: string, name: string): Set<string> {
    const own = new Set(nameKey(name).split(" ").filter(Boolean));
    return new Set(nameKey(text).split(" ").filter((word) => word.length >= 5 && !CONTEXT_STOP.has(word) && !own.has(word)));
}

function appearanceNear(row: ShortNameAppearance, context: ShortNameContext): boolean {
    if (context.sessionNumber != null && row.sessionNumber === context.sessionNumber) return true;
    if (context.asOf && row.datedAt && Math.abs(row.datedAt.getTime() - context.asOf.getTime()) <= NEAR_MS) return true;
    return false;
}

function plausible(person: ShortNamePerson, context: ShortNameContext): boolean {
    if (textHasFullName(context.text, person.name)) return true;
    if (context.asOf && person.seats.some((seat) => seatCovers(seat, context.asOf!))) return true;
    return person.appearances.some((row) => appearanceNear(row, context) && textHasFullName(row.evidence, person.name));
}

/**
 * Match one short name to a full name that the document's date can support.
 *
 * A later officeholder is not a candidate. When several people were around,
 * a shared distinctive word in their full-name evidence can settle it
 * ("Peabuddies" on this line and on an earlier "Sophia Lou"). Otherwise the
 * name stays unresolved.
 */
export function matchShortName(
    name: string,
    people: ShortNamePerson[],
    context: ShortNameContext,
): ShortNamePerson | null {
    if (!isShortForm(name) || isClassReportLabel(name, context.text)) return null;
    const regulars = people.map(asRegular);
    const given = givenNameCandidates(name, regulars);
    const surnames = surnameCandidates(name, regulars);
    const named = [...new Map([...given, ...surnames].map((person) => [person.id, person])).values()];
    const pool = named.length > 0 ? named : diminutiveCandidates(name, regulars);
    const byId = new Map(people.map((person) => [person.id, person]));
    const eligible = pool.map((person) => byId.get(person.id)!).filter((person) => plausible(person, context));
    if (eligible.length === 1) return eligible[0]!;
    if (eligible.length < 2) return null;

    const tokens = contextTokens(context.evidence, name);
    const shared = eligible.filter((person) => person.appearances.some((row) =>
        appearanceNear(row, context) && textHasFullName(row.evidence, person.name) &&
        [...tokens].some((token) => nameKey(row.evidence).split(" ").includes(token))));
    return shared.length === 1 ? shared[0]! : null;
}
