/**
 * Document taxonomy.
 *
 * Stored on Document.kind as a plain string rather than a Postgres enum: the
 * taxonomy grows as the SGA adds document types, and adding one should not
 * require a schema migration. The tuple below is the canonical list, and the
 * type guard keeps application code honest about it.
 */
export const DOCUMENT_KINDS = [
    "minutes.executive",
    "minutes.senate",
    "minutes.committee",
    "minutes.judicial",
    "bill.senate_rules",
    "bill.funding",
    "bill.bylaws_amendment",
    "bill.constitution_amendment",
    "bill.other",
    "guiding.constitution",
    "guiding.bylaws",
    "guiding.other",
    "attendance",
    "directory",
    "tracker",
    "unknown",
] as const;

export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

export function isDocumentKind(value: string): value is DocumentKind {
    return (DOCUMENT_KINDS as readonly string[]).includes(value);
}

/** "bill.bylaws_amendment" -> "Bill / Bylaws amendment". */
export function documentKindLabel(kind: string): string {
    return kind
        .split(".")
        .map((part) => part.replace(/_/g, " "))
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(" / ");
}

/**
 * Kinds that carry binding rules. Interpretations of how the SGA is *currently*
 * structured should be grounded in these, never in meeting minutes, which
 * record discussion rather than adopted text.
 */
export const AUTHORITATIVE_KINDS: DocumentKind[] = [
    "guiding.constitution",
    "guiding.bylaws",
    "guiding.other",
    "bill.constitution_amendment",
    "bill.bylaws_amendment",
    "bill.senate_rules",
];

/**
 * Kinds worth comparing across sessions.
 *
 * Each session adopts its own constitution and bylaws, so the diff between two
 * sessions' copies *is* the amendment record, and is the reason the archive
 * keeps prior sessions at all. Nothing else gains from the comparison: the
 * documents that otherwise share a lineage key are bill templates, link
 * indexes, and meeting agendas sitting beside the copy somebody made of them,
 * where a line-by-line diff answers a question nobody asked.
 */
export const COMPARABLE_KINDS: DocumentKind[] = [
    "guiding.constitution",
    "guiding.bylaws",
    "guiding.other",
];

export function isComparableKind(kind: string): boolean {
    return (COMPARABLE_KINDS as readonly string[]).includes(kind);
}

/**
 * Whose meeting a string says it was, or null if it says nothing.
 *
 * Ordered most specific first, so a committee -- which is a committee of the
 * Senate, and whose minutes routinely mention it -- is not read as the Senate.
 */
function minutesKind(text: string): DocumentKind | null {
    if (/exec/.test(text)) return "minutes.executive";
    if (/judicial/.test(text)) return "minutes.judicial";
    if (/committee|commitee/.test(text)) return "minutes.committee";
    if (/senate|general sga|general body|\bgbm\b/.test(text)) return "minutes.senate";
    return null;
}

/**
 * Best-effort classification from a document's Drive folder path and title.
 *
 * Deliberately conservative: anything unrecognised stays "unknown" rather than
 * being guessed into an authoritative kind, since that would let an arbitrary
 * document be cited as binding rules.
 */
export function classifyDocument(input: {
    name: string;
    folderPath: string;
}): DocumentKind {
    const name = input.name.toLowerCase();
    const path = input.folderPath.toLowerCase();
    const haystack = `${path}/${name}`;

    if (/attendance/.test(haystack)) return "attendance";
    if (/roster|email list|contact list|directory/.test(haystack)) return "directory";

    // Constitution and bylaws, whether the adopted text or an amendment to it.
    const amends = /amendment|amend\b|resolution/.test(name);
    if (/constitution/.test(haystack)) {
        return amends ? "bill.constitution_amendment" : "guiding.constitution";
    }
    if (/bylaw/.test(haystack)) {
        return amends ? "bill.bylaws_amendment" : "guiding.bylaws";
    }
    if (/senate rules|standing rules|\brules bill\b/.test(haystack)) return "bill.senate_rules";
    if (/funding|budget|appropriation/.test(haystack)) return "bill.funding";
    // A bill or act that does not say which kind of bill it is. "The
    // Accountability Act" and "CLeRPA" are legislation; leaving them unknown
    // hid them from the type filter next to the funding bills they were
    // read with.
    if (/\bbill\b|\bact\b/.test(name) && !/template/.test(name)) return "bill.other";

    if (/tracksheet|initiative tracker/.test(haystack)) return "tracker";

    if (/minutes|agenda/.test(name) || (/meeting/.test(name) && /committees\//i.test(path))) {
        // The filename first: a senator's own minutes of a Senate meeting,
        // filed in the folder of the committee they sit on, are the Senate's
        // minutes and not that committee's. Only a filename saying nothing
        // about which body met falls back to where the file is kept.
        return minutesKind(name) ?? minutesKind(haystack) ?? "unknown";
    }

    if (/guiding document/.test(path)) return "guiding.other";

    return "unknown";
}
