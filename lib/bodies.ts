/**
 * Which part of the SGA a document came out of, and which part an office
 * belongs to.
 *
 * Used to read a first name correctly. "Present: Sumi, Jason, Amy, Grace" in
 * an executive meeting means the Grace who sits on the Executive Board, not
 * the two other Graces who sit in the Senate -- a distinction the text itself
 * never makes, and the only thing standing between a set of minutes and the
 * wrong person's name on it.
 */

export const SGA_BODIES = [
    "executive",
    "senate",
    "judiciary",
    "cse",
    "programming",
] as const;

export type SgaBody = (typeof SGA_BODIES)[number];

/**
 * The body an office sits in.
 *
 * Order matters. The Chair of Programming is an executive officer who runs
 * the Programming Councils, and a Class President is a senator, so the more
 * specific title has to be tested before the word it contains.
 */
export function bodyForOffice(office: string): SgaBody | null {
    const name = office.toLowerCase();

    if (/justice/.test(name)) return "judiciary";
    if (/student elections|\bcse\b/.test(name)) return "cse";

    if (/chair of programming/.test(name)) return "executive";
    if (/programming council/.test(name)) return "programming";

    if (/class president|senator|president of the senate|parliamentarian/.test(name)) {
        return "senate";
    }
    // Caucus chairs sit in the Senate, which is where they are named.
    if (/caucus/.test(name)) return "senate";

    if (
        /executive board|student body|^president$|vice president|^secretary$|^treasurer$|director of/.test(
            name,
        )
    ) {
        return "executive";
    }

    return null;
}

/**
 * The body whose meeting a document records, or null when it is not a meeting
 * of one body -- a bill or a guiding document belongs to the SGA at large.
 */
export function bodyForDocument(input: {
    kind: string;
    folderPath: string;
    title: string;
}): SgaBody | null {
    switch (input.kind) {
        case "minutes.executive":
            return "executive";
        case "minutes.judicial":
            return "judiciary";
        // A committee is a committee *of the Senate*, and its minutes name
        // senators.
        case "minutes.senate":
        case "minutes.committee":
            return "senate";
        default:
            break;
    }

    const haystack = `${input.folderPath}/${input.title}`.toLowerCase();

    if (/\bexec(?:utive)?\b/.test(haystack)) return "executive";
    if (/judicial|judiciary/.test(haystack)) return "judiciary";
    if (/programming/.test(haystack)) return "programming";
    if (/senate|general body|\bgbm\b/.test(haystack)) return "senate";

    return null;
}
