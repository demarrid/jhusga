/**
 * Search settings shared by the server and the browser.
 *
 * Separate from lib/search.ts because the question box needs these and must
 * not pull Prisma into the client bundle to get them.
 */

/** Questions longer than this are not questions. */
export const MAX_QUESTION_CHARS = 300;

/**
 * Which sessions a question is asked of.
 *
 * The question box no longer asks the reader to pick: it searches the whole
 * archive and then keeps the documents that are in force, unless the question
 * itself is about the past. The CLI still uses these when somebody wants to
 * force one or the other.
 */
export type SearchScope = "current" | "all";

/**
 * Whether a question is about the rules now, or about how they used to be.
 *
 * "How do I get a bill passed" should only read the constitution and bylaws
 * now in force. "When is the last time the constitution was updated" has to
 * look at older editions, and at the amendments between them.
 */
export type QuestionFocus = "current" | "historical";

/**
 * Whether a question is about the rules now, or about how they used to be.
 *
 * Default is current: most people asking the archive want the constitution
 * in force, not the 112th's. A question that names a change, a comparison,
 * a crisis, or "the last time" has to look further back.
 */
export function questionFocus(question: string): QuestionFocus {
    if (
        /\b(?:when (?:was|were|did|is the last)|last time|used to|previous|prior|history of|originally|first time|constitutional crisis|crisis|compar(?:e|ing|ed)|how has|what changed|between the)\b/i.test(
            question,
        )
    ) {
        return "historical";
    }
    return "current";
}

/**
 * Whether a question is asking who holds a seat now, rather than what the
 * seat is for.
 *
 * "Who is currently in the Judiciary branch?" is answered from the contact
 * list and the attendance sheet. The constitution says how many justices
 * there are and how they are appointed; it does not name them.
 *
 * The cues are narrow on purpose. "Who can I talk to now" and "who is in
 * favor of the bill" are not roster questions, even though they contain
 * "who" and "in".
 */
export function isMembershipQuestion(question: string): boolean {
    return askedMembershipGroup(question) !== null;
}

/**
 * Which body a membership question is asking about.
 *
 * Null when the question is not about who sits somewhere. `"all"` when it is
 * about the SGA as a whole rather than one branch.
 */
export type MembershipBody =
    | "executive"
    | "senate"
    | "caucus"
    | "judiciary"
    | "cse"
    | "programming"
    | "staff"
    | "all";

const MEMBERSHIP_BODY_LABEL: Record<Exclude<MembershipBody, "all">, string> = {
    executive: "Executive Board",
    senate: "Senate",
    caucus: "Caucuses",
    judiciary: "Judiciary",
    cse: "Committee on Student Elections",
    programming: "Programming Council",
    staff: "Staff",
};

const MEMBERSHIP_BODIES: { group: Exclude<MembershipBody, "all">; pattern: RegExp }[] = [
    { group: "judiciary", pattern: /\bjudiciar|\bjustices?\b/ },
    { group: "caucus", pattern: /\bcaucus/ },
    { group: "programming", pattern: /\bprogramming\b/ },
    { group: "cse", pattern: /\bcse\b|committee on student elections|elections committee/ },
    { group: "staff", pattern: /\bstaff\b|\badvisors?\b/ },
    { group: "executive", pattern: /\bexecutive\b|\bcabinet\b|e-?board|\bexec\b/ },
    { group: "senate", pattern: /\bsenate|\bsenators?\b/ },
];

function membershipBodyFrom(asked: string): Exclude<MembershipBody, "all"> | null {
    for (const { group, pattern } of MEMBERSHIP_BODIES) {
        if (pattern.test(asked)) return group;
    }
    return null;
}

function looksLikeRosterQuestion(asked: string): boolean {
    if (/\bwho\b/.test(asked) && /\b(?:currently|sitting|serving|sits)\b/.test(asked)) {
        return true;
    }
    if (/\bwho(?:'s| is)\s+in\b/.test(asked)) return true;
    if (
        /\b(?:current|sitting|serving)\s+(?:members?|justices?|officers?|senators?|cabinet|roster|directory)\b/.test(
            asked,
        )
    ) {
        return true;
    }
    return false;
}

export function askedMembershipGroup(question: string): MembershipBody | null {
    const asked = question.toLowerCase();
    if (!looksLikeRosterQuestion(asked)) return null;

    const body = membershipBodyFrom(asked);
    if (body) return body;
    if (/\bsga\b|student government/.test(asked)) return "all";
    if (/\b(?:current|sitting|serving)\s+(?:members?|officers?|roster|directory)\b/.test(asked)) {
        return "all";
    }
    return null;
}

function officeOf(member: { positions: string[] }): string {
    return member.positions[0] ?? "";
}

function namedSeat(member: { name: string; positions: string[] }): string {
    const office = officeOf(member);
    return office ? `${member.name} (${office})` : member.name;
}

function oxford(items: string[]): string {
    if (items.length === 0) return "";
    if (items.length === 1) return items[0]!;
    if (items.length === 2) return `${items[0]} and ${items[1]}`;
    return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}

/** Past this many people, a sentence becomes a list. */
const MEMBERSHIP_BULLET_AFTER = 8;

/**
 * The people who sit in a body, as a sentence (or a list, when there are
 * many). Citation markers are attached afterwards so the chips have a space
 * in front of them.
 */
export function formatMembershipRoster(
    group: MembershipBody,
    members: { name: string; positions: string[]; group: string }[],
): string {
    if (members.length === 0) return "";

    if (group === "all") {
        const order: Exclude<MembershipBody, "all">[] = [
            "executive",
            "senate",
            "caucus",
            "judiciary",
            "cse",
            "programming",
            "staff",
        ];
        const blocks: string[] = ["The current SGA:"];
        for (const body of order) {
            const inBody = members.filter((member) => member.group === body);
            if (inBody.length === 0) continue;
            blocks.push(
                `${MEMBERSHIP_BODY_LABEL[body]}\n${inBody
                    .map((member) => `- ${namedSeat(member)}`)
                    .join("\n")}`,
            );
        }
        const leftover = members.filter((member) => member.group === "other");
        if (leftover.length > 0) {
            blocks.push(
                `Also listed\n${leftover.map((member) => `- ${namedSeat(member)}`).join("\n")}`,
            );
        }
        return blocks.join("\n\n");
    }

    const label = MEMBERSHIP_BODY_LABEL[group];
    if (members.length > MEMBERSHIP_BULLET_AFTER) {
        return `The current ${label}:\n\n${members
            .map((member) => `- ${namedSeat(member)}`)
            .join("\n")}`;
    }

    if (members.length === 1) {
        return `The current ${label} is ${namedSeat(members[0]!)}.`;
    }

    return `The current ${label} is ${oxford(members.map(namedSeat))}.`;
}

/** Put `[1][2]` after the claim, never jammed against the last digit. */
export function appendCitationMarkers(prose: string, count: number): string {
    if (count <= 0) return prose;
    const markers = Array.from({ length: count }, (_, index) => `[${index + 1}]`).join("");
    const heading = prose.match(/^([^:\n]+:)(\n[\s\S]*)$/);
    if (heading) {
        return `${heading[1]!.slice(0, -1)} ${markers}:${heading[2]}`;
    }
    return `${prose} ${markers}`;
}
