import { generateJson } from "@/lib/ai";
import { bodyForOffice, type SgaBody } from "@/lib/bodies";
import { nameKey } from "@/lib/contributors";
import { prisma } from "@/lib/prisma";

/**
 * Resolving "Sumi" and "Jazz" onto people the archive already knows by a
 * full name.
 *
 * Only existing full names are eligible. Short forms in these documents are
 * used for people the archive already knows; a first name with no matching
 * full name is left as itself rather than guessed into someone new. The model
 * may only pick from that list; it never invents a person.
 *
 * When several people answer to the same first name, the document itself
 * usually settles it, and is asked before the model is:
 *
 *   1. The document names one of them in full somewhere else. Minutes open
 *      with "Treasurer - Amy Xu" and then say "Amy" for the rest of the hour.
 *   2. Only one of them sits in the body that met. Three people called Grace
 *      serve, but one is on the Executive Board.
 *   3. Only one of them is serving at all. Amy Li left; Amy Xu is Treasurer.
 *
 * Each of these is a fact about one document, so none of them is remembered
 * as a global alias -- "Amy" means a different person in the 112th session's
 * minutes, and pinning it here would rewrite history there.
 */

export const REGULAR_MIN_DOCUMENTS = 1;

export type RegularPerson = {
    id: string;
    name: string;
    nameKey: string;
    documentCount: number;
    /** Offices currently held. Empty for people who only appear in the archive. */
    positions: string[];
    /** The bodies those offices sit in. */
    bodies: SgaBody[];
};

/** What is known about the document a set of names was read from. */
export type NameContext = {
    /** The document text, for finding a candidate's full name in it. */
    text?: string;
    /** The body whose meeting it records, when it records one. */
    body?: SgaBody | null;
    /** Current-session documents may be read against who is serving now. */
    isCurrentSession?: boolean;
};

let regularsCache: RegularPerson[] | null = null;

export function resetNameResolverCache() {
    regularsCache = null;
}

export function isShortForm(name: string): boolean {
    return nameKey(name).split(" ").filter(Boolean).length === 1;
}

export function nameTokens(name: string): string[] {
    return nameKey(name).split(" ").filter(Boolean);
}

/**
 * Regulars whose full name contains the short form as a given name or surname.
 * "Grace" hits "Grace Wang"; "Sumi" hits "Sumire Sumi".
 */
export function tokenCandidates(
    short: string,
    regulars: RegularPerson[],
): RegularPerson[] {
    const key = nameKey(short);
    if (!key) return [];

    return regulars.filter((person) => nameTokens(person.name).includes(key));
}

export function givenNameCandidates(
    short: string,
    regulars: RegularPerson[],
): RegularPerson[] {
    const key = nameKey(short);
    return regulars.filter((person) => nameTokens(person.name)[0] === key);
}

export function surnameCandidates(
    short: string,
    regulars: RegularPerson[],
): RegularPerson[] {
    const key = nameKey(short);
    return regulars.filter((person) => {
        const tokens = nameTokens(person.name);
        return tokens.length >= 2 && tokens[tokens.length - 1] === key;
    });
}

/**
 * Shortest a nickname may be before it is allowed to match by shape alone.
 *
 * Four, because three-letter fragments are inside far too many given names to
 * mean anything: "Sun" opens Sunita and closes Jaesun, and picking either is a
 * coin flip dressed up as a deduction.
 */
const MIN_DIMINUTIVE = 4;

/**
 * Regulars whose given name is the short form with something on one end.
 *
 * The nicknames in these documents are mostly clipped given names -- Nora for
 * Honora, Tori for Victoria, Alex for Alexander -- and none of them can be
 * found by matching whole name tokens, so "Nora" was becoming a second person
 * standing beside the Honora Muratori she is.
 *
 * Only ends count. A fragment taken out of the middle of a name is a
 * coincidence far more often than it is a nickname, and the archive has to be
 * able to say it does not know.
 */
export function diminutiveCandidates(
    short: string,
    regulars: RegularPerson[],
): RegularPerson[] {
    const key = nameKey(short);
    if (key.length < MIN_DIMINUTIVE) return [];

    return regulars.filter((person) => {
        const given = nameTokens(person.name)[0];
        if (!given || given === key || given.length <= key.length) return false;
        return given.startsWith(key) || given.endsWith(key);
    });
}

/**
 * Shortest a name may be before one letter out of place can be called a slip.
 *
 * Five, because the roster already holds four-letter names a single edit apart
 * -- Ryan and Ryann are two people who both serve -- and below that almost
 * every given name is one letter from another one.
 */
const MIN_TYPO_LENGTH = 5;

/** Whether one insertion, deletion, or substitution turns `a` into `b`. */
function withinOneEdit(a: string, b: string): boolean {
    if (a === b) return false;

    const [short, long] = a.length <= b.length ? [a, b] : [b, a];
    if (long.length - short.length > 1) return false;

    let seen = 0;
    let edited = false;

    for (let at = 0; at < long.length; at += 1) {
        if (short[seen] === long[at]) {
            seen += 1;
            continue;
        }
        if (edited) return false;
        edited = true;
        // A substitution consumes a character from both; an insertion only
        // consumes one from the longer.
        if (short.length === long.length) seen += 1;
    }

    return true;
}

/**
 * Regulars whose name holds this word with a single letter wrong.
 *
 * These documents are typed in a hurry during a meeting and the archive is
 * full of the result -- Demari for Demarri, Srigori for Srigouri, Vishnue for
 * Vishnu, Caityln for Caitlyn. Each one was becoming a second person standing
 * beside the senator they are, and the person filter offered both.
 *
 * The last thing tried, after everyone actually named this has been ruled out,
 * and only ever when exactly one person is that close: two senators a letter
 * apart is a coin flip, and the archive has to be able to say it does not
 * know. Recorded as a deduction, so it expires the moment the roster grows
 * someone who really is spelled this way.
 */
export function misspellingCandidates(
    short: string,
    regulars: RegularPerson[],
): RegularPerson[] {
    const key = nameKey(short);
    if (key.length < MIN_TYPO_LENGTH) return [];

    return regulars.filter((person) =>
        nameTokens(person.name).some(
            (token) => token.length >= MIN_TYPO_LENGTH && withinOneEdit(key, token),
        ),
    );
}

export async function loadRegulars(): Promise<RegularPerson[]> {
    if (regularsCache) return regularsCache;

    const affiliates = await prisma.hopkinsAffiliate.findMany({
        select: {
            id: true,
            name: true,
            nameKey: true,
            contributions: { select: { documentId: true } },
            hopkinsRelationships: {
                where: { endedAt: null, hopkinsCategory: { type: "position" } },
                select: { hopkinsCategory: { select: { name: true } } },
            },
        },
    });

    regularsCache = affiliates
        .map((person) => {
            const positions = person.hopkinsRelationships.map(
                (row) => row.hopkinsCategory.name,
            );
            return {
                id: person.id,
                name: person.name,
                nameKey: person.nameKey,
                documentCount: new Set(person.contributions.map((row) => row.documentId))
                    .size,
                positions,
                bodies: [
                    ...new Set(
                        positions
                            .map(bodyForOffice)
                            .filter((body): body is SgaBody => body !== null),
                    ),
                ],
            };
        })
        .filter(
            (person) =>
                nameTokens(person.name).length >= 2 &&
                // Someone holding a seat this session is a candidate even
                // before a document has named them: the Student Body
                // President is exactly who "Jason" means, and he cannot earn
                // his first mention until his first mention resolves.
                (person.documentCount >= REGULAR_MIN_DOCUMENTS ||
                    person.positions.length > 0),
        )
        .sort((a, b) => b.documentCount - a.documentCount);

    return regularsCache;
}

/** Whether a candidate's full name is written out in the document. */
export function namedInFull(text: string, person: RegularPerson): boolean {
    const tokens = nameTokens(person.name);
    if (tokens.length < 2) return false;

    // Matched on the normalised text so that "Amy  Xu", "Amy Xu," and
    // "*Amy Xu*" all count, and so a surname alone never does.
    const haystack = ` ${nameKey(text)} `;
    return haystack.includes(` ${tokens.join(" ")} `);
}

export type Narrowing = {
    person: RegularPerson;
    /** Why this candidate was chosen, for the alias source and for logs. */
    reason: "holds_the_office" | "named_in_full" | "serving_in_body" | "serving_now";
};

/** Office names compared the way nameKey compares people. */
function officeKey(office: string): string {
    return office.toLowerCase().replace(/[^a-z]+/g, " ").trim();
}

/**
 * Narrow several people who answer to one short name down to one, using what
 * the document itself says. Returns null when the document does not settle it,
 * which is the point: a coin flip here is a false claim about who was there.
 */
export function narrowByDocument(
    candidates: RegularPerson[],
    context: NameContext,
    /** An office the line named alongside them, e.g. "Chair of Programming". */
    office?: string | null,
): Narrowing | null {
    if (candidates.length === 0) return null;

    const only = <T>(rows: T[]): T | null => (rows.length === 1 ? rows[0]! : null);

    // The line said which seat they hold, and one of the candidates holds it.
    // Stronger than anything below, because it is about this mention rather
    // than about the document: "Chair of Programming - Grace" is the Chair of
    // Programming whoever else in the room is also called Grace -- and these
    // minutes go on to introduce a Grace Yang who is not her.
    //
    // Only for the session now sitting, for the same reason as the tests
    // below: who holds which seat is not known for any other.
    if (office && context.isCurrentSession) {
        const wanted = officeKey(office);
        const holder = only(
            candidates.filter((person) =>
                person.positions.some((held) => officeKey(held) === wanted),
            ),
        );
        if (holder) return { person: holder, reason: "holds_the_office" };
    }

    if (context.text) {
        const written = only(
            candidates.filter((person) => namedInFull(context.text!, person)),
        );
        if (written) return { person: written, reason: "named_in_full" };
    }

    // Who is serving is only known for the current session, so an archived
    // document is never read against today's officers.
    if (!context.isCurrentSession) return null;

    if (context.body) {
        const seated = only(
            candidates.filter((person) => person.bodies.includes(context.body!)),
        );
        if (seated) return { person: seated, reason: "serving_in_body" };
    }

    const serving = only(candidates.filter((person) => person.positions.length > 0));
    return serving ? { person: serving, reason: "serving_now" } : null;
}

async function rememberAlias(
    alias: string,
    affiliateId: string,
    source: string,
): Promise<void> {
    const key = nameKey(alias);
    if (!key) return;

    await prisma.hopkinsAlias.upsert({
        where: { aliasKey: key },
        create: {
            alias,
            aliasKey: key,
            hopkinsAffiliateId: affiliateId,
            source,
        },
        update: { hopkinsAffiliateId: affiliateId, source },
    });
}

/**
 * Move every mention of `fromId` onto `intoId` and drop the leftover row.
 *
 * Used when "Sumi" was created as its own person and later recognised as
 * Sumire Sumi. Verified identities (email or a login) are never deleted.
 */
export async function mergeAffiliate(
    fromId: string,
    intoId: string,
): Promise<void> {
    if (fromId === intoId) return;

    const from = await prisma.hopkinsAffiliate.findUnique({
        where: { id: fromId },
        select: {
            name: true,
            email: true,
            userId: true,
            contributions: {
                select: { id: true, documentId: true, role: true },
            },
            hopkinsRelationships: {
                select: { id: true, hopkinsCategoryId: true, startedAt: true },
            },
        },
    });
    if (!from) return;

    for (const row of from.contributions) {
        const clash = await prisma.documentContributor.findUnique({
            where: {
                documentId_hopkinsAffiliateId_role: {
                    documentId: row.documentId,
                    hopkinsAffiliateId: intoId,
                    role: row.role,
                },
            },
            select: { id: true },
        });

        if (clash) {
            await prisma.documentContributor.delete({ where: { id: row.id } });
        } else {
            await prisma.documentContributor.update({
                where: { id: row.id },
                data: { hopkinsAffiliateId: intoId },
            });
        }
    }

    for (const row of from.hopkinsRelationships) {
        const clash = await prisma.hopkinsRelationship.findFirst({
            where: {
                hopkinsAffiliateId: intoId,
                hopkinsCategoryId: row.hopkinsCategoryId,
                startedAt: row.startedAt,
            },
            select: { id: true },
        });
        if (clash) {
            await prisma.hopkinsRelationship.delete({ where: { id: row.id } });
        } else {
            await prisma.hopkinsRelationship.update({
                where: { id: row.id },
                data: { hopkinsAffiliateId: intoId },
            });
        }
    }

    await rememberAlias(from.name, intoId, "merge");

    if (!from.email && !from.userId) {
        await prisma.hopkinsAffiliate.delete({ where: { id: fromId } });
    }
}

/** Alias sources that were a deduction, and can therefore be out of date. */
const DERIVED_SOURCES = [
    "unique_given",
    "unique_surname",
    "diminutive",
    "misspelling",
    "model",
];

/**
 * Drop aliases the archive has outgrown.
 *
 * "Srika" was recorded as Srigouri Oruganty back when she was the only person
 * whose name began that way; the 114th session then seated Srika Popuri, and
 * every later document would have credited the wrong person. "Grace" meant
 * Grace Wang when she was the only Grace and now means one of three.
 *
 * Only deductions are pruned. A merge is a statement that two rows were one
 * person, and a manual correction is somebody's considered decision; neither
 * expires because the roster grew.
 */
export async function pruneStaleAliases(): Promise<number> {
    const regulars = await loadRegulars();
    const aliases = await prisma.hopkinsAlias.findMany({
        where: { source: { in: DERIVED_SOURCES } },
        select: { id: true, alias: true, hopkinsAffiliateId: true },
    });

    const stale: string[] = [];

    for (const alias of aliases) {
        const candidates = tokenCandidates(alias.alias, regulars);

        if (candidates.length === 0) {
            // No full name contains this word, so it is a clipped one ("Nora",
            // "Kemi") or a mistyped one ("Demari"), and both expire the same
            // way: only while exactly one person's name still answers to it.
            // A nickname nothing answers to ("Jazz") is a name of its own and
            // cannot be contradicted.
            const answering = [
                ...diminutiveCandidates(alias.alias, regulars),
                ...misspellingCandidates(alias.alias, regulars),
            ];
            const distinct = [...new Map(answering.map((p) => [p.id, p])).values()];
            if (distinct.length === 0) continue;
            if (distinct.length === 1 && distinct[0]!.id === alias.hopkinsAffiliateId) {
                continue;
            }
            stale.push(alias.id);
            continue;
        }

        const stillUnique =
            candidates.length === 1 && candidates[0]!.id === alias.hopkinsAffiliateId;
        if (!stillUnique) stale.push(alias.id);
    }

    if (stale.length > 0) {
        await prisma.hopkinsAlias.deleteMany({ where: { id: { in: stale } } });
    }

    return stale.length;
}

/** Whether two adjacent letters were swapped: Rasamsetty for Rasmasetty. */
function transposed(a: string, b: string): boolean {
    if (a.length !== b.length) return false;

    const differ: number[] = [];
    for (let at = 0; at < a.length; at += 1) {
        if (a[at] === b[at]) continue;
        differ.push(at);
        if (differ.length > 2) return false;
    }

    const [first, second] = differ;
    return (
        differ.length === 2 &&
        second === first! + 1 &&
        a[first!] === b[second!] &&
        a[second!] === b[first!]
    );
}

/**
 * Whether one name is the other mistyped: a letter doubled, dropped, swapped
 * with its neighbour, or struck wrong in the middle of a word.
 *
 * A substitution at the *start* of a word does not count, because that is
 * where two different names differ rather than where one name is typed badly.
 * Grace Yang and Grace Wang both sat in the 114th; so did Kiana and Diana.
 */
export function looksMistyped(a: string, b: string): boolean {
    if (a === b) return false;
    if (a.length !== b.length) return withinOneEdit(a, b);
    if (transposed(a, b)) return true;

    let struck = -1;
    for (let at = 0; at < a.length; at += 1) {
        if (a[at] === b[at]) continue;
        if (struck !== -1) return false;
        struck = at;
    }

    return struck > 0 && a[struck - 1] !== " ";
}

export type PersonMerge = {
    keptId: string;
    keptName: string;
    /** Names folded onto it, each now an alias rather than a row of its own. */
    foldedNames: string[];
    /** Documents behind the kept spelling, which is why it was the one kept. */
    documents: number;
};

/**
 * Fold rows that are one typo apart onto the spelling the archive uses most.
 *
 * Distinct from the short-form rule above, which never creates a row it was
 * unsure of. These are rows that already exist, both written out in full:
 * Shreemann and Shreeman Patel, Katherine and Katherin Zhu, Caraline and
 * Caroline Sommer. Each pair is one senator appearing twice in the person
 * filter, splitting their own record between two entries.
 *
 * Whole names are compared, not words, because a word is far too little to go
 * on -- Andrew Gao and Andrei Espelien differ by a letter and are two people
 * who served together, as do Brandon Benjamin and Branden Ngo. For the same
 * reason a row with no surname is left alone entirely: Ryan and Ryann are two
 * senators, and a bare given name has nothing to corroborate it.
 *
 * Refused outright when both rows carry an email or a login, because an
 * address is the one identity here that was verified rather than read, and two
 * of them are two people however alike the names look.
 */
export async function mergePeopleOneTypoApart(): Promise<PersonMerge[]> {
    const people = await prisma.hopkinsAffiliate.findMany({
        select: {
            id: true,
            name: true,
            nameKey: true,
            email: true,
            userId: true,
            description: true,
            _count: { select: { contributions: true } },
        },
    });

    // Everyone reachable from everyone else by single typos, so that a name
    // written three ways settles into one row rather than two.
    const group = new Map<string, string>();
    const findRoot = (id: string): string => {
        let root = id;
        while (group.get(root) !== root) root = group.get(root)!;
        return root;
    };
    for (const person of people) group.set(person.id, person.id);

    for (let i = 0; i < people.length; i += 1) {
        for (let j = i + 1; j < people.length; j += 1) {
            const left = people[i]!;
            const right = people[j]!;
            if (!left.nameKey.includes(" ") || !right.nameKey.includes(" ")) continue;
            if (!looksMistyped(left.nameKey, right.nameKey)) continue;
            if (left.email && right.email && left.email !== right.email) continue;
            if (left.userId && right.userId) continue;
            group.set(findRoot(left.id), findRoot(right.id));
        }
    }

    const clusters = new Map<string, typeof people>();
    for (const person of people) {
        const root = findRoot(person.id);
        clusters.set(root, [...(clusters.get(root) ?? []), person]);
    }

    const merged: PersonMerge[] = [];

    for (const cluster of clusters.values()) {
        if (cluster.length < 2) continue;

        const ranked = [...cluster].sort(
            (a, b) =>
                b._count.contributions - a._count.contributions ||
                b.name.length - a.name.length,
        );

        // The spelling the archive uses most, but only if every other spelling
        // is a single typo of *it*. Caraline Sommer sits one typo from both
        // Caroline Sommer and Caraline Sommers while those two are two apart,
        // so the centre of the cluster is not always the busiest name in it.
        const kept = ranked.find((candidate) =>
            cluster.every(
                (other) =>
                    other.id === candidate.id ||
                    looksMistyped(candidate.nameKey, other.nameKey),
            ),
        );
        if (!kept) continue;

        const folded = cluster.filter((person) => person.id !== kept.id);

        for (const loser of folded) {
            await prisma.$transaction(async (tx) => {
                const held = await tx.documentContributor.findMany({
                    where: { hopkinsAffiliateId: loser.id },
                    select: { id: true, documentId: true, role: true },
                });
                for (const row of held) {
                    const clash = await tx.documentContributor.findUnique({
                        where: {
                            documentId_hopkinsAffiliateId_role: {
                                documentId: row.documentId,
                                hopkinsAffiliateId: kept.id,
                                role: row.role,
                            },
                        },
                        select: { id: true },
                    });
                    if (clash) {
                        await tx.documentContributor.delete({ where: { id: row.id } });
                    } else {
                        await tx.documentContributor.update({
                            where: { id: row.id },
                            data: { hopkinsAffiliateId: kept.id },
                        });
                    }
                }

                const seats = await tx.hopkinsRelationship.findMany({
                    where: { hopkinsAffiliateId: loser.id },
                    select: { id: true, hopkinsCategoryId: true, startedAt: true },
                });
                for (const seat of seats) {
                    // findFirst rather than the compound key, which a null
                    // startedAt -- a seat with no recorded term -- cannot use.
                    const clash = await tx.hopkinsRelationship.findFirst({
                        where: {
                            hopkinsAffiliateId: kept.id,
                            hopkinsCategoryId: seat.hopkinsCategoryId,
                            startedAt: seat.startedAt,
                        },
                        select: { id: true },
                    });
                    if (clash) {
                        await tx.hopkinsRelationship.delete({ where: { id: seat.id } });
                    } else {
                        await tx.hopkinsRelationship.update({
                            where: { id: seat.id },
                            data: { hopkinsAffiliateId: kept.id },
                        });
                    }
                }

                for (const move of [
                    tx.hopkinsAlias.updateMany({
                        where: { hopkinsAffiliateId: loser.id },
                        data: { hopkinsAffiliateId: kept.id },
                    }),
                    tx.forumSession.updateMany({
                        where: { hopkinsAffiliateId: loser.id },
                        data: { hopkinsAffiliateId: kept.id },
                    }),
                    tx.forumPost.updateMany({
                        where: { authorAffiliateId: loser.id },
                        data: { authorAffiliateId: kept.id },
                    }),
                    tx.forumReply.updateMany({
                        where: { authorAffiliateId: loser.id },
                        data: { authorAffiliateId: kept.id },
                    }),
                ]) {
                    await move;
                }

                await tx.hopkinsAffiliate.delete({ where: { id: loser.id } });

                // Whatever the kept row was missing and the folded one had.
                // Only once the folded row is gone: an email is unique across
                // the table, so the two cannot both hold it even in passing.
                await tx.hopkinsAffiliate.update({
                    where: { id: kept.id },
                    data: {
                        email: kept.email ?? loser.email,
                        userId: kept.userId ?? loser.userId,
                        description: kept.description || loser.description,
                    },
                });

                // So the spelling resolves here next time rather than digging
                // the row back out of the next document that uses it.
                await tx.hopkinsAlias.upsert({
                    where: { aliasKey: loser.nameKey },
                    create: {
                        alias: loser.name,
                        aliasKey: loser.nameKey,
                        hopkinsAffiliateId: kept.id,
                        source: "merge",
                    },
                    update: { hopkinsAffiliateId: kept.id, source: "merge" },
                });
            });
        }

        merged.push({
            keptId: kept.id,
            keptName: kept.name,
            foldedNames: folded.map((person) => person.name),
            documents: kept._count.contributions,
        });
    }

    if (merged.length > 0) resetNameResolverCache();
    return merged;
}

async function askModelToPick(
    mentions: { name: string; evidence: string }[],
    regulars: RegularPerson[],
    context: NameContext = {},
): Promise<Map<string, string>> {
    const picked = new Map<string, string>();
    if (mentions.length === 0 || regulars.length === 0) return picked;

    try {
        console.log(
            `resolving ${mentions.length} short name${mentions.length === 1 ? "" : "s"} against ${regulars.length} regulars: ${mentions.map((m) => m.name).join(", ")}`,
        );
        const { value } = await generateJson<{
            matches?: { name?: string; affiliateId?: string | null }[];
        }>({
            system: `You map first names and nicknames used in Johns Hopkins SGA documents onto people who already exist.

Rules:
- You may only pick an affiliateId from the provided list. Never invent a person or an id.
- Only match when it is the same person (Sumi → Sumire Sumi, Jazz → Jazzlyn, Grace → Grace Wang).
- If two listed people could fit (Amy Li vs Amy Xu), use the evidence line and the office each holds to pick, or return affiliateId null if it is unclear.
- People are named in the meetings of the body they serve in: an executive meeting names the Executive Board, a Senate meeting names senators.
- Never pick someone just because they are the most frequent.

Reply with a single JSON object:
{"matches": [{"name": string, "affiliateId": string | null}]}`,
            user: [
                context.body ? `This document records a meeting of: ${context.body}` : "",
                "Known people:",
                ...regulars.map((person) => {
                    const office =
                        person.positions.length > 0
                            ? `, currently ${person.positions.join(" / ")}`
                            : "";
                    return `- ${person.id}  ${person.name}  (${person.documentCount} documents${office})`;
                }),
                "",
                "Names to resolve:",
                ...mentions.map(
                    (mention) =>
                        `- "${mention.name}"  evidence: ${mention.evidence.slice(0, 200)}`,
                ),
            ]
                .filter(Boolean)
                .join("\n"),
            maxTokens: 800,
        });

        const allowed = new Set(regulars.map((person) => person.id));
        for (const match of value.matches ?? []) {
            const written = match.name?.trim();
            const id = match.affiliateId?.trim();
            if (!written || !id || !allowed.has(id)) continue;
            picked.set(nameKey(written), id);
        }
    } catch {
        // Leave unresolved; the short form stays a short form.
    }

    return picked;
}

type Pending = {
    index: number;
    name: string;
    evidence: string;
    exactId: string | null;
    onlyIfKnown: boolean;
    pool: RegularPerson[];
};

/** A name as some document wrote it, and the line it was written on. */
export type NameMention = {
    name: string;
    evidence: string;
    /**
     * Do not create anybody for this name: answer with null instead.
     *
     * For names read from a shape loose enough that an unrecognised one is far
     * more likely to be a heading than a person -- the word in front of the
     * colon on a line of minutes. See harvestSpeaker in lib/contributors.ts.
     */
    onlyIfKnown?: boolean;
    /** An office the same line gave them, which can settle a shared name. */
    office?: string | null;
};

/**
 * Resolve many written names at once so a minutes roll costs at most one
 * model call, not one per nickname.
 *
 * Null only ever comes back for a mention that asked for it.
 */
export async function resolveAffiliates(
    mentions: NameMention[],
    context: NameContext = {},
): Promise<(string | null)[]> {
    const regulars = await loadRegulars();
    const ids: (string | null)[] = mentions.map(() => null);
    const pending: Pending[] = [];

    for (const [index, mention] of mentions.entries()) {
        const key = nameKey(mention.name);

        const aliased = await prisma.hopkinsAlias.findUnique({
            where: { aliasKey: key },
            select: { hopkinsAffiliateId: true },
        });
        if (aliased) {
            ids[index] = aliased.hopkinsAffiliateId;
            continue;
        }

        const exact = await prisma.hopkinsAffiliate.findUnique({
            where: { nameKey: key },
            select: { id: true, name: true },
        });

        if (exact && !isShortForm(mention.name)) {
            ids[index] = exact.id;
            continue;
        }

        if (isShortForm(mention.name)) {
            const given = givenNameCandidates(mention.name, regulars);
            const surname = surnameCandidates(mention.name, regulars);
            // Shape is the last resort, so it is only consulted once nobody
            // has turned out to actually be named this.
            const clipped =
                given.length + surname.length === 0
                    ? diminutiveCandidates(mention.name, regulars)
                    : [];
            // Later still than shape: a name is only a misspelling once
            // nobody is named it and nothing clips to it.
            const misspelled =
                given.length + surname.length + clipped.length === 0
                    ? misspellingCandidates(mention.name, regulars)
                    : [];

            let resolved: { id: string; source: string } | null = null;

            if (given.length === 1 && surname.length === 0) {
                resolved = { id: given[0].id, source: "unique_given" };
            } else if (surname.length === 1 && given.length === 0) {
                resolved = { id: surname[0].id, source: "unique_surname" };
            } else if (
                given.length === 1 &&
                surname.length === 1 &&
                given[0].id === surname[0].id
            ) {
                resolved = { id: given[0].id, source: "unique_given" };
            } else if (clipped.length === 1) {
                // Nobody is named this, so a clipped given name is the
                // remaining reading -- and exactly one name clips to it.
                resolved = { id: clipped[0].id, source: "diminutive" };
            } else if (misspelled.length === 1) {
                // Nobody is named this and nothing clips to it, so a slip of
                // the keyboard is what is left -- and one name is a letter off.
                resolved = { id: misspelled[0].id, source: "misspelling" };
            }

            if (resolved) {
                await rememberAlias(mention.name, resolved.id, resolved.source);
                if (exact && exact.id !== resolved.id) {
                    await mergeAffiliate(exact.id, resolved.id);
                }
                ids[index] = resolved.id;
                continue;
            }

            const candidates = [...given, ...surname, ...clipped, ...misspelled];

            // Nobody is named this and nothing clips to it, so there is no one
            // for the model to pick and nothing to be gained by asking: the
            // caller wanted a person the archive already knows, and this is
            // not one. Answering here is also what stops every "Venue:" and
            // "Timeline:" in the archive from costing a model call.
            if (candidates.length === 0 && mention.onlyIfKnown) continue;

            const pool =
                candidates.length > 0
                    ? [...new Map(candidates.map((person) => [person.id, person])).values()]
                    : regulars;

            // Several people answer to this name; ask the document which one.
            // The answer holds for this document only, so no alias is written:
            // "Amy" is Amy Xu here and Amy Li in the minutes of two sessions
            // ago, and one global mapping cannot be right in both.
            if (candidates.length > 1) {
                const narrowed = narrowByDocument(pool, context, mention.office);
                if (narrowed) {
                    ids[index] = narrowed.person.id;
                    continue;
                }
            }

            pending.push({
                index,
                name: mention.name,
                evidence: mention.evidence,
                exactId: exact?.id ?? null,
                onlyIfKnown: Boolean(mention.onlyIfKnown),
                pool,
            });
            continue;
        }

        if (exact) {
            ids[index] = exact.id;
            continue;
        }

        if (mention.onlyIfKnown) continue;

        const created = await prisma.hopkinsAffiliate.create({
            data: { name: mention.name, nameKey: key },
            select: { id: true },
        });
        ids[index] = created.id;
    }

    if (pending.length > 0) {
        const pool = [
            ...new Map(pending.flatMap((item) => item.pool).map((person) => [person.id, person])).values(),
        ];
        const picked = await askModelToPick(
            pending.map((item) => ({ name: item.name, evidence: item.evidence })),
            pool,
            context,
        );

        for (const item of pending) {
            const id = picked.get(nameKey(item.name));
            if (id) {
                // "Jazz" has no token overlap with anyone else, so the mapping
                // is safe to reuse. "Amy" matches two full names; remembering
                // it would pin every later minutes roll to the wrong Amy, and
                // so would a fragment two given names both clip to.
                const globallyUnique =
                    tokenCandidates(item.name, regulars).length === 0 &&
                    diminutiveCandidates(item.name, regulars).length <= 1 &&
                    misspellingCandidates(item.name, regulars).length <= 1;
                if (globallyUnique) {
                    await rememberAlias(item.name, id, "model");
                    if (item.exactId && item.exactId !== id) {
                        await mergeAffiliate(item.exactId, id);
                    }
                }
                ids[item.index] = id;
                continue;
            }

            // A short form that is its own row -- an "Amy" the archive has
            // never managed to attach to an Amy -- is not somebody it knows,
            // so it cannot corroborate a name read off a remark.
            if (item.exactId && !item.onlyIfKnown) {
                ids[item.index] = item.exactId;
                continue;
            }

            if (item.onlyIfKnown) continue;

            const created = await prisma.hopkinsAffiliate.create({
                data: { name: item.name, nameKey: nameKey(item.name) },
                select: { id: true },
            });
            ids[item.index] = created.id;
        }
    }

    return ids.map((id, index) => {
        if (id || mentions[index]?.onlyIfKnown) return id;
        throw new Error(`Failed to resolve "${mentions[index]?.name}"`);
    });
}

export async function resolveAffiliate(
    name: string,
    evidence = "",
): Promise<string> {
    const [id] = await resolveAffiliates([{ name, evidence }]);
    // Never null: resolveAffiliates only declines for a mention that asked it
    // to, and this one does not.
    return id!;
}
