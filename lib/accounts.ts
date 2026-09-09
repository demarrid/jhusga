/**
 * Guessing which person a Drive account belongs to.
 *
 * Almost every file in the master folder is owned by a personal Google account
 * rather than a university one -- `honorarose123@gmail.com`,
 * `perez23alan04@gmail.com`, `xuamy05@gmail.com` -- because officers create
 * documents from whatever account they were signed into. That address is the
 * only trace of who set a document up, and it is useless to a reader as-is.
 *
 * The handles are not arbitrary, though. They are overwhelmingly the person's
 * own name with digits stuck on and the two halves in either order, so a
 * conservative matcher recovers most of them. JHED-style addresses
 * (`spate249@jh.edu`) are the same problem in a different shape.
 *
 * Two rules keep this honest:
 *
 * 1. Only people the archive already knows are candidates. A handle is never
 *    allowed to invent a person, because a Drive account is not evidence that
 *    someone is in the SGA.
 * 2. A match must be unambiguous. If two known people score equally well, the
 *    account is left unresolved rather than assigned to the likelier one.
 *
 * The resulting link is always shown as provenance ("this account created the
 * file"), never as authorship -- see the schema comment on Document.
 */

import { nameKey } from "@/lib/contributors";

/** Name suffixes, which are not surnames. */
const SUFFIX = /^(?:i{1,3}|iv|v|jr|sr)$/;

/**
 * Shared inboxes and role accounts. These belong to the organisation, so
 * matching them onto whichever officer has a similar name would be wrong.
 */
const ROLE_ACCOUNT = /^(?:jhusga|sga|hopkins|jhu|info|admin|contact|noreply|no-reply)/i;

/**
 * Below this, a handle has too little signal to match anything: `th9435`
 * reduces to "th", which is a prefix of far too many names.
 */
const MIN_STEM_LENGTH = 4;

/**
 * The weakest score that may still be accepted, and only when unique. At 2 the
 * evidence is "the handle opens with this person's given name", which is
 * enough for `honorarose123` when exactly one Honora is known and not enough
 * for anything when two are.
 */
export const MIN_ACCOUNT_SCORE = 2;

/** The letters of an account handle: `perez23alan04@gmail.com` -> "perezalan". */
export function accountStem(account: string): string {
    return (account.split("@")[0] ?? "").toLowerCase().replace(/[^a-z]/g, "");
}

/** True for an address that belongs to the SGA rather than to a person. */
export function isRoleAccount(account: string): boolean {
    return ROLE_ACCOUNT.test(account.split("@")[0] ?? "");
}

function nameParts(name: string): { tokens: string[]; given: string; surname: string } | null {
    const tokens = nameKey(name).split(" ").filter(Boolean);
    if (tokens.length === 0) return null;

    const meaningful = tokens.filter((token) => !SUFFIX.test(token));
    if (meaningful.length === 0) return null;

    return {
        tokens: meaningful,
        given: meaningful[0]!,
        surname: meaningful[meaningful.length - 1]!,
    };
}

function sharedPrefix(a: string, b: string): boolean {
    return a.startsWith(b) || b.startsWith(a);
}

/**
 * How strongly an account handle looks like a person's name, 0 to 4.
 *
 * 4 is the whole name in either order (`jacksonmorris21`, `xuamy05`); 3 is a
 * JHED initial-plus-surname (`spate249`) or the whole name truncated; 2 is a
 * handle that opens with a distinctive given name (`honorarose123`); 1 is a
 * surname appearing somewhere inside. 0 is no usable overlap.
 */
export function accountNameScore(name: string, account: string): number {
    const stem = accountStem(account);
    if (stem.length < MIN_STEM_LENGTH) return 0;

    const parts = nameParts(name);
    if (!parts) return 0;

    const { tokens, given, surname } = parts;
    const full = tokens.join("");

    if (tokens.length >= 2) {
        const forward = `${given}${surname}`;
        const reversed = `${surname}${given}`;

        if (stem === forward || stem === reversed || stem === full) return 4;

        // "tanishatanejatt" for Tanisha Taneja, or a handle cut short.
        for (const form of [forward, reversed, full]) {
            if (sharedPrefix(stem, form) && Math.min(stem.length, form.length) >= 6) {
                return 3;
            }
        }

        const initialSurname = `${given[0]}${surname}`;
        if (stem === initialSurname) return 3;
        // "jmorr119" for Jackson Morris.
        if (sharedPrefix(stem, initialSurname) && Math.min(stem.length, initialSurname.length) >= 5) {
            return 3;
        }

        // A shortened or extended given name in front of the full surname:
        // "sri.oruganty" for Srigouri Oruganty, "zaymirza0526" for Zaynab
        // Mirza, "kairktmartin" for Kai Martin. The whole surname has to be
        // there, which is what stops this from matching on a given name alone.
        if (surname.length >= 4 && stem.endsWith(surname)) {
            const rest = stem.slice(0, -surname.length);
            if (rest.length >= 3 && sharedPrefix(rest, given)) return 3;
        }
    }

    // A handle built on the given name plus something else entirely -- a
    // middle name, a word. Only distinctive given names qualify.
    if (given.length >= 5 && stem.startsWith(given)) return 2;
    if (surname.length >= 5 && stem.startsWith(surname)) return 2;

    if (surname.length >= 5 && stem.includes(surname)) return 1;

    return 0;
}

export type AccountCandidate = { id: string; name: string };

export type AccountMatch<T extends AccountCandidate> = {
    person: T;
    score: number;
    /** What justified the link, kept as the contributor row's evidence. */
    evidence: string;
};

/**
 * Resolve one Drive account onto a known person, or null.
 *
 * The display name is tried first: Drive sometimes carries a real name
 * ("Tyler Turner") rather than the handle, and an exact name is better
 * evidence than any amount of handle arithmetic.
 */
export function matchAccount<T extends AccountCandidate>(
    account: { email?: string | null; displayName?: string | null },
    people: T[],
): AccountMatch<T> | null {
    const email = account.email?.trim().toLowerCase() ?? "";
    const displayName = account.displayName?.trim() ?? "";

    if (email && isRoleAccount(email)) return null;

    if (displayName) {
        const key = nameKey(displayName);
        if (key.split(" ").filter(Boolean).length >= 2) {
            const named = people.filter((person) => nameKey(person.name) === key);
            if (named.length === 1) {
                return {
                    person: named[0]!,
                    score: 5,
                    evidence: `Drive account ${email || displayName} (${displayName})`,
                };
            }
        }
    }

    if (!email) return null;

    const scored = people
        .map((person) => ({ person, score: accountNameScore(person.name, email) }))
        .filter((row) => row.score >= MIN_ACCOUNT_SCORE)
        .sort((a, b) => b.score - a.score);

    if (scored.length === 0) return null;

    // Two people the handle fits equally well means the handle does not
    // identify either of them.
    if (scored.length > 1 && scored[1]!.score === scored[0]!.score) return null;

    return {
        person: scored[0]!.person,
        score: scored[0]!.score,
        evidence: `Drive account ${email}`,
    };
}
