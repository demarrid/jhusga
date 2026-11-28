import { extractContributors, nameKey, type ContributorRole } from "@/lib/contributors";
import { diminutiveCandidates, givenNameCandidates, isShortForm, nameTokens, surnameCandidates, type RegularPerson } from "@/lib/names";

/** Contributor rows written by `npm run people -- --short`. A later full extraction does not delete them. */
export const SHORT_SOURCE = "short";

const NEAR_MS = 120 * 24 * 60 * 60 * 1000;

/** Titles that, written right before a one-word name, make it a surname. "Dean" is also a given name. */
const TITLE_BEFORE_NAME = String.raw`(?:senators?|sen|secretary|sec|treasurer|president|pres|vice\s+president|vp|chair|provost|dr|professor|prof|director|mr|ms|mrs)`;

/** University titles. A one-word name after one is an administrator's surname. */
const UNIVERSITY_TITLE_BEFORE_NAME = String.raw`(?:deans?|(?:vice\s+)?provosts?|dr|professors?|prof|directors?|chancellors?)`;

/**
 * Formal given names a common short one stands for. Only real nicknames: a
 * fragment that merely opens another name ("Sam" in Samira, "Ash" in Ashley
 * Pennington) is no evidence the two were confused.
 */
const NICKNAMES: Record<string, string[]> = {
    sam: ["samuel", "samantha"], tim: ["timothy"], alex: ["alexander", "alexandra", "alexis"],
    ben: ["benjamin"], dan: ["daniel", "danielle"], matt: ["matthew"], mike: ["michael"],
    nick: ["nicholas", "nicole"], chris: ["christopher", "christina", "christine"], will: ["william"],
    kate: ["katherine", "kathryn", "katharine"], katie: ["katherine", "kathryn", "katharine"],
    liz: ["elizabeth"], jen: ["jennifer"], jenn: ["jennifer"], jon: ["jonathan"], josh: ["joshua"],
    andy: ["andrew"], tom: ["thomas"], joe: ["joseph"], dave: ["david"], rob: ["robert"],
    ed: ["edward"], max: ["maxwell", "maximilian"], zach: ["zachary"], jake: ["jacob"],
    abby: ["abigail"], becca: ["rebecca"], maddie: ["madeline", "madison", "madelynn"],
};

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Words the AI pass has handed back as a one-word person that, in SGA
 * documents, are almost always something else: "Bill for national voter
 * registration day" is legislation, not Bill Cosby.
 */
const DISCOVERED_NOUNS = new Set(["bill", "act", "senate", "hopkins", "johns"]);

/**
 * Whether a full name in the archive is somebody a short name may be linked
 * to. Rows like "President Stone Meng", "Dr. N", "Buse K" and "Shawn (MP)"
 * are earlier misreadings, and linking more mentions to them only spreads the
 * misreading.
 */
export function isLinkableFullName(name: string): boolean {
    if (/[()]/.test(name)) return false;
    const key = nameKey(name);
    if (key === "johns hopkins") return false;
    // "kai isaac" is a lowercase roll ("Kai, Isaac") read as one person.
    if (name === name.toLowerCase()) return false;
    const tokens = name.trim().split(/\s+/);
    if (/^(?:president|senator|dr|mrs?|ms|prof|professor|secretary|treasurer|vp)\.?$/i.test(tokens[0] ?? "")) return false;
    return !/^[A-Za-z]\.?$/.test(tokens.at(-1) ?? "");
}

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
    /**
     * Whether any line naming them puts a university title near their
     * surname: "University Provost, Sunil Kumar", "Dean ... -- T. E.
     * Schlesinger". Only such a person answers to "Provost Kumar".
     */
    universityTitled?: boolean;
    /** Whether every line naming them only mentions them: no attendance, speech, office or work. */
    onlyMentioned?: boolean;
};

/** Whether `evidence` puts a university title within a few words of `surname`, on either side. */
export function hasUniversityTitleNear(evidence: string, surname: string): boolean {
    const words = nameKey(evidence).split(" ");
    const key = nameKey(surname);
    if (!key) return false;
    const title = new RegExp(String.raw`^${UNIVERSITY_TITLE_BEFORE_NAME}$`, "i");
    return words.some((word, at) => word === key &&
        words.slice(Math.max(0, at - 8), at + 4).some((near) => title.test(near)));
}

export type ShortNameMention = { name: string; evidence: string; role: ContributorRole };

export type ShortNameContext = {
    asOf?: Date | null;
    sessionNumber?: number | null;
    text: string;
    evidence: string;
    /**
     * People already credited on the meeting's other records -- its agenda,
     * a second set of minutes -- used only when nothing else separates two
     * people in office. Executive Meeting #11 was minuted
     * twice; the copy with a roll call names Grace Guan, and the "Grace:"
     * speaking in the other copy is her rather than another Grace in office.
     */
    meetingPeople?: ReadonlySet<string>;
};

export function textHasFullName(text: string, name: string): boolean {
    const tokens = nameKey(name).split(" ").filter(Boolean);
    if (tokens.length < 2) return false;
    return ` ${nameKey(text)} `.includes(` ${tokens.join(" ")} `);
}

/** Words after a full name that make it the name of something named after them. */
const NAMESAKE = /^(?:undergraduate|research|fellowships?|fellows?|programs?|awards?|scholarships?|scholars?|prizes?|halls?|centers?|centres?|buildings?|library|house|rooms?|lectures?|professorships?|chairs?|institutes?|schools?|foundations?|funds?)$/;

/**
 * Whether the text names the person themself, not only something named after
 * them. Johns Hopkins runs a Woodrow Wilson Undergraduate Research
 * Fellowship, so his full name is in documents from every year, and read as
 * him being around it made "Dean Wilson" and "Deans: Wilson, Ruzika" into the
 * twenty-eighth president.
 */
export function textNamesPerson(text: string, name: string): boolean {
    const tokens = nameKey(name).split(" ").filter(Boolean);
    if (tokens.length < 2) return false;
    const words = nameKey(text).split(" ");
    for (let at = 0; at + tokens.length <= words.length; at += 1) {
        if (!tokens.every((token, offset) => words[at + offset] === token)) continue;
        if (!NAMESAKE.test(words[at + tokens.length] ?? "")) return true;
    }
    return false;
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

/**
 * Every one-word name in a document, for matching against full names.
 *
 * `discovered` is the document's cached AI people pass. The resolver refuses
 * a bare surname from it unless the person held a dated seat, and most
 * senators before the rosters were kept hold none, so "Senator Bannister -
 * motion to sign the letter" reached nobody: the parser does not read an
 * unbulleted dash remark, and this linker only read the parser. Its evidence
 * is an exact quote, already checked against the text when it was cached.
 */
export function shortNameMentions(
    content: string,
    title?: string,
    kind?: string,
    discovered: readonly ShortNameMention[] = [],
): ShortNameMention[] {
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
    // The parser's reading of a name wins: it says why the line names them.
    const parsed = new Set([...found.values()].map((person) => `${nameKey(person.name)}\n${person.role}`));
    for (const person of discovered) {
        if (!isShortForm(person.name) || !person.evidence.trim()) continue;
        const token = nameKey(person.name);
        // "N", "B": an initial is not enough to name anybody.
        if (token.length < 2 || DISCOVERED_NOUNS.has(token)) continue;
        // "Wernert v. Green" is a case citation, not President Green.
        if (new RegExp(String.raw`\bv\.?\s+${escapeRegExp(person.name)}\b|\b${escapeRegExp(person.name)}\s+v\.\s`, "i").test(person.evidence)) continue;
        if (parsed.has(`${token}\n${person.role}`)) continue;
        const key = `${token}\n${person.evidence}`;
        if (!found.has(key)) found.set(key, { name: person.name, evidence: person.evidence, role: person.role });
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
    if (textNamesPerson(context.text, person.name)) return true;
    // Woodrow Wilson is quoted in a 2018 student constitution, which is no
    // reason "Dean Wilson" that year is him. Someone the archive only ever
    // mentions is only matched where this document names them in full.
    if (person.onlyMentioned) return false;
    if (context.asOf && person.seats.some((seat) => seatCovers(seat, context.asOf!))) return true;
    return person.appearances.some((row) => appearanceNear(row, context) && textNamesPerson(row.evidence, person.name));
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
    // "Hopkins community celebrates Diwali" is the university, not Carla
    // Hopkins; "email Kim, kim@bethesdagreen.org" is a contact outside it.
    if (/^(?:hopkins|johns)$/.test(nameKey(name))) return null;
    if (new RegExp(String.raw`\b${escapeRegExp(name)}[\w.+-]*@`, "i").test(context.evidence)) return null;
    const regulars = people.map(asRegular);
    const key = nameKey(name);
    // "Secretary Kim", "President Chien": a title in front makes the name a
    // surname, so Kim Hewitt is no candidate for the secretary.
    const titled = new RegExp(String.raw`\b${TITLE_BEFORE_NAME}\.?\s+${escapeRegExp(name)}\b`, "i").test(context.evidence);
    // "Dean Wilson", "Provost Kumar": an administrator's surname. Only someone
    // the archive has written in full under such a title is a candidate --
    // "Provost Sunil Kumar" -- or the only Wilson in full nearby is Woodrow.
    const university = new RegExp(String.raw`\b${UNIVERSITY_TITLE_BEFORE_NAME}\.?\s+${escapeRegExp(name)}\b`, "i").test(context.evidence);
    const byId = new Map(people.map((person) => [person.id, person]));
    const fits = (pool: RegularPerson[]) => pool.map((person) => byId.get(person.id)!).filter((person) =>
        plausible(person, context) && (!university || person.universityTitled === true));
    const surnames = surnameCandidates(name, regulars);
    // A title prefers the surname, but "Senator Grace" is the minutes calling
    // Grace Guan by her first name: with no surname to match, the given name
    // still counts.
    const titledSurnames = titled || university ? fits(surnames) : [];
    const given = university || titledSurnames.length ? [] : givenNameCandidates(name, regulars);
    const named = [...new Map([...given, ...surnames].map((person) => [person.id, person])).values()];
    // "Jazz" is also the last word of an act called "NOT 2 COOL JAZZ". A
    // name that nobody around at the time carries falls back to nicknames.
    const direct = fits(named);
    // "Sam" is Sam Schatmeyer only if no Samuel was around too: Samuel Mollin
    // went by Sam in the same minutes. A formal given name the short one is
    // the usual nickname of makes it ambiguous -- unless the two share a
    // surname, when they are one person written two ways (Tim and Timothy
    // Huang).
    const formal = NICKNAMES[key] ?? [];
    const surnamesOf = new Set(direct.map((person) => nameTokens(person.name).at(-1)));
    const rivals = direct.length > 0 && !titledSurnames.length && formal.length
        ? fits(regulars.filter((person) => {
            const tokens = nameTokens(person.name);
            return formal.includes(tokens[0] ?? "") && !surnamesOf.has(tokens.at(-1));
        }))
        : [];
    const eligible = direct.length > 0
        ? [...new Map([...direct, ...rivals].map((person) => [person.id, person])).values()]
        : titledSurnames.length || university ? [] : fits(diminutiveCandidates(name, regulars));
    if (eligible.length === 1) return eligible[0]!;
    if (eligible.length < 2) return null;

    const tokens = contextTokens(context.evidence, name);
    const shared = eligible.filter((person) => person.appearances.some((row) =>
        appearanceNear(row, context) && textHasFullName(row.evidence, person.name) &&
        [...tokens].some((token) => nameKey(row.evidence).split(" ").includes(token))));
    if (shared.length === 1) return shared[0]!;

    const atMeeting = eligible.filter((person) => context.meetingPeople?.has(person.id));
    return atMeeting.length === 1 ? atMeeting[0]! : null;
}
