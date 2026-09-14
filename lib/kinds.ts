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
    "judicial.writ_of_certiorari",
    "judicial.writ_of_mandamus",
    "judicial.writ",
    "judicial.advisory_opinion",
    "judicial.opinion",
    "judicial.order",
    "judicial.complaint",
    "judicial.other",
    "attendance",
    "directory",
    "tracker",
    "presentation",
    "template",
    "newsletter.article",
    "unknown",
] as const;

export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

export function isDocumentKind(value: string): value is DocumentKind {
    return (DOCUMENT_KINDS as readonly string[]).includes(value);
}

/**
 * Kinds the rule below would misname.
 *
 * "Newsletter / Article" reads as a newsletter the SGA sends out, which is the
 * one thing this kind is not. The paper spells its own name with the hyphen.
 */
const KIND_LABELS: Partial<Record<DocumentKind, string>> = {
    "newsletter.article": "News-Letter article",
    "judicial.writ_of_certiorari": "Judiciary / Writ of certiorari",
    "judicial.writ_of_mandamus": "Judiciary / Writ of mandamus",
    "judicial.advisory_opinion": "Judiciary / Advisory opinion",
    presentation: "Presentation",
    template: "Template",
};

/** "bill.bylaws_amendment" -> "Bill / Bylaws amendment". */
export function documentKindLabel(kind: string): string {
    if (isDocumentKind(kind) && KIND_LABELS[kind]) return KIND_LABELS[kind];

    return kind
        .split(".")
        .map((part) => part.replace(/_/g, " "))
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(" / ");
}

/**
 * Kinds that are *about* the SGA rather than *by* it.
 *
 * Everything else in the archive is a document somebody with a seat wrote,
 * filed, or put in front of the Senate, and the whole pipeline is built on that
 * assumption: a document can be cited as evidence of what the SGA did, its
 * title can be rewritten into the SGA's house style, its text can be diffed
 * against last session's copy of itself, and a change to it is a change the SGA
 * made and might need reviewing.
 *
 * None of that holds for a News-Letter article. It is a published, immutable
 * secondary source written by people the SGA has no authority over, and reading
 * it as an SGA record would let the archive attribute a reporter's
 * characterisation to the body it was reporting on. So the passes that assume
 * authorship refuse these kinds outright rather than being taught to handle
 * them: see `meetingFor`, `canonicalTitle`, and the corpus passes in
 * lib/sync.ts.
 */
export const SECONDARY_KINDS: DocumentKind[] = ["newsletter.article"];

export function isSecondaryKind(kind: string | null | undefined): boolean {
    return (SECONDARY_KINDS as readonly string[]).includes(kind ?? "");
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
    "judicial.writ_of_certiorari",
    "judicial.writ_of_mandamus",
    "judicial.writ",
    "judicial.advisory_opinion",
    "judicial.opinion",
    "judicial.order",
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
    if (/judicial|judiciary/.test(text)) return "minutes.judicial";
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
    content?: string;
    /** The name the site shows, when it has already been rewritten. */
    displayTitle?: string;
    mimeType?: string;
}): DocumentKind {
    const name = input.name.toLowerCase();
    const shown = (input.displayTitle ?? "").toLowerCase();
    const path = input.folderPath.toLowerCase();
    // The Drive filename and the house title both count: "Copy of Senate GBM
    // #15" is still a Senate agenda once recordTitles has said so, and a
    // Google Slides file is a presentation even when it is titled "Updates".
    const titled = `${name} ${shown}`.replace(/\s+/g, " ").trim();
    const haystack = `${path}/${titled}`;

    if (/attendance/.test(haystack)) return "attendance";
    if (/roster|email list|contact list|contact sheet|directory/.test(haystack)) return "directory";

    // A bill template is not a bill. Checked before the legislation rules so
    // "SGA Bill Template" does not become one.
    if (/\btemplate\b/.test(titled)) return "template";

    // Briefing slides and update decks a group brings to a meeting. Checked
    // before minutes so "Committee Update Presentation" is not a meeting.
    if (isPresentation(input.mimeType, titled, path)) return "presentation";

    // Constitution and bylaws, whether the adopted text or an amendment to it.
    // The filename wins over the folder: a bylaws file sitting in a folder
    // that also holds the constitution is still the bylaws.
    const amends = /amendment|amend\b|resolution/.test(titled);
    if (/bylaw/.test(titled) && !/constitution/.test(titled)) {
        return amends ? "bill.bylaws_amendment" : "guiding.bylaws";
    }
    if (/constitution/.test(titled) || (/constitution/.test(path) && !/bylaw/.test(titled))) {
        return amends ? "bill.constitution_amendment" : "guiding.constitution";
    }
    if (/bylaw/.test(haystack)) {
        return amends ? "bill.bylaws_amendment" : "guiding.bylaws";
    }
    const judicial = classifyJudicial(titled, haystack, input.content);
    if (judicial) return judicial;

    if (/senate rules|standing rules|\brules bill\b/.test(haystack)) return "bill.senate_rules";
    if (/funding|budget|appropriation/.test(haystack)) return "bill.funding";
    // A bill, act, or resolution that does not say which kind of bill it is.
    // "The Accountability Act" and "Student Government Resolution regarding
    // ICE" are legislation; leaving them unknown hid them from the type
    // filter next to the funding bills they were read with.
    if (/\bbill\b|\bact\b|\bresolution\b/.test(titled) && !/template/.test(titled)) {
        return "bill.other";
    }

    if (/tracksheet|initiative tracker/.test(haystack)) return "tracker";

    if (looksLikeMinutes(titled, path, haystack)) {
        // The filename first: a senator's own minutes of a Senate meeting,
        // filed in the folder of the committee they sit on, are the Senate's
        // minutes and not that committee's. Only a filename saying nothing
        // about which body met falls back to where the file is kept.
        return minutesKind(titled) ?? minutesKind(haystack) ?? "unknown";
    }

    if (/guiding document/.test(path)) return "guiding.other";

    return "unknown";
}

/**
 * Briefing materials a group uses when it presents: Google Slides, a file
 * named as a presentation or deck, or a committee's update doc linked from
 * an agenda.
 */
function isPresentation(mimeType: string | undefined, titled: string, path = ""): boolean {
    if (mimeType && /presentation/i.test(mimeType)) return true;
    if (/\b(?:presentation|slides|deck|briefing)\b/.test(titled)) return true;
    if (/\b(?:committee|council|caucus) updates?\b/.test(titled)) return true;
    // Update docs a group files next to the agenda it presents from.
    if (/\bupdates?\b/.test(titled) && /agenda/.test(path)) return true;
    return false;
}

/**
 * Whether this is a meeting record, including files the SGA never titled
 * "minutes" or "agenda" -- "Senate GBM #15", "Exec Minutes 4/1", a committee
 * file sitting in a Minutes folder.
 */
function looksLikeMinutes(titled: string, path: string, haystack: string): boolean {
    if (/minutes|agenda|\bmins\b|\bgbm\b|general body/.test(titled)) return true;
    if (/meeting/.test(titled) && /committees\//i.test(path)) return true;
    if (/meeting/.test(titled) && (minutesKind(titled) !== null || minutesKind(haystack) !== null)) {
        return true;
    }
    return false;
}

/**
 * Filings of the Judiciary, which the Senate's taxonomy never covered.
 *
 * Distinguished from judicial *minutes*, which fall through and are classified
 * below: a writ of certiorari is an instrument, not a record of who was in the
 * room.
 */
function classifyJudicial(name: string, haystack: string, content?: string): DocumentKind | null {
    if (/minutes|agenda/.test(name)) return null;

    const judicialFolder = /judicial|judiciary/.test(haystack);
    const body = (content ?? "").slice(0, 4_000).toLowerCase();
    const namedOrFiled = (pattern: RegExp) =>
        pattern.test(name) || (judicialFolder && pattern.test(body));

    if (namedOrFiled(/advisory opinion/)) return "judicial.advisory_opinion";

    // An opinion *on* a petition for certiorari is still an opinion. The
    // caption of Morris v. SGA says "CERTIORARI TO THE ... JUDICIARY";
    // reading that as the writ itself would hide every published decision
    // in the Opinions folder.
    if (/opinion|decision/.test(name) || /\bopinions?\b/.test(haystack)) {
        return "judicial.opinion";
    }

    if (namedOrFiled(/writ of certiorari|\bcertiorari\b/)) {
        return "judicial.writ_of_certiorari";
    }
    if (namedOrFiled(/writ of mandamus|\bmandamus\b/)) {
        return "judicial.writ_of_mandamus";
    }

    if (!judicialFolder && !/\bwrit\b/.test(name)) return null;
    if (/\border\b/.test(name)) return "judicial.order";
    if (/complaint|petition/.test(name)) return "judicial.complaint";
    if (/\bwrit\b/.test(name)) return "judicial.writ";
    if (judicialFolder) return "judicial.other";
    return null;
}
