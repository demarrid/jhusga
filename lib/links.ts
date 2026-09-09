/**
 * The links SGA documents already contain, turned into navigation.
 *
 * An agenda is mostly a list of links: to the bill being read, to the
 * guidelines being adopted, to last meeting's minutes. Those links point at
 * Google Docs URLs, and the file ID inside each one is the same key `sync`
 * reconciles documents on -- so a link whose target has been ingested can be
 * rewritten as a link into this site, and read backwards as "which meetings
 * discussed this bill".
 *
 * Nothing here guesses. A reference exists only when the author actually typed
 * the link and the target is a document we hold.
 */

/**
 * Drive file IDs are long enough that a shorter match is something else -- a
 * fragment, a tab id -- rather than a document.
 */
const FILE_ID = "[a-zA-Z0-9_-]{16,}";

/** `/d/<id>/edit`, covering docs, sheets, slides and `/u/0/d/` variants. */
const PATH_ID = new RegExp(`/d/(${FILE_ID})`);

/** `drive.google.com/open?id=<id>`. */
const QUERY_ID = new RegExp(`[?&]id=(${FILE_ID})`);

/** A Google URL, stopping before markdown's own punctuation. */
const DRIVE_URL = /https?:\/\/(?:docs|drive)\.google\.com\/[^\s)>\]"'`]+/g;

/**
 * Drive lives on two hosts and nothing else here is Drive.
 *
 * The `id=` form below is not unique to Google: the Microsoft Forms links the
 * SGA uses for committee placements carry an `id` query parameter too, and
 * reading a Drive file ID out of one invents a document that was never linked.
 */
const DRIVE_HOST = /^https?:\/\/(?:docs|drive)\.google\.com\//i;

/** `[label](url)`, so a reference can be labelled the way the author wrote it. */
const MARKDOWN_LINK = /\[([^\]\n]*)\]\(([^)\n]+)\)/g;

export type DriveLink = {
    /** The Drive file ID the link points at. */
    fileId: string;
    /** The author's link text, or "" for a bare URL. */
    text: string;
    /** Where it first appears, so references list in reading order. */
    offset: number;
};

/**
 * Google Docs escapes punctuation on export, so the same URL shows up as both
 * `.../1_X1Phk...` and `.../1\_X1Phk...`. Undo that before reading the ID out,
 * or half the links in the archive silently fail to resolve.
 */
function unescapeUrl(url: string): string {
    return url.replace(/\\([^A-Za-z0-9])/g, "$1");
}

function fileIdFrom(url: string): string | null {
    const cleaned = unescapeUrl(url);
    if (!DRIVE_HOST.test(cleaned)) return null;

    // Folder links are deliberately not matched: a folder is never a document.
    return PATH_ID.exec(cleaned)?.[1] ?? QUERY_ID.exec(cleaned)?.[1] ?? null;
}

/**
 * Every distinct Drive document linked from this markdown, in reading order.
 *
 * A target linked several times collapses to one entry, keeping the first
 * position and the first non-empty label -- an agenda that links the same bill
 * from two items is still one reference.
 */
export function extractDriveLinks(markdown: string): DriveLink[] {
    const byFileId = new Map<string, DriveLink>();

    const record = (fileId: string, text: string, offset: number) => {
        const existing = byFileId.get(fileId);
        if (!existing) {
            byFileId.set(fileId, { fileId, text: text.trim(), offset });
            return;
        }
        if (!existing.text && text.trim()) existing.text = text.trim();
    };

    for (const match of markdown.matchAll(MARKDOWN_LINK)) {
        const fileId = fileIdFrom(match[2]);
        if (fileId) record(fileId, match[1], match.index ?? 0);
    }

    // Bare URLs the author pasted without making them a link.
    for (const match of markdown.matchAll(DRIVE_URL)) {
        const fileId = fileIdFrom(match[0]);
        if (fileId) record(fileId, "", match.index ?? 0);
    }

    return [...byFileId.values()].sort((a, b) => a.offset - b.offset);
}

export type ReferenceEdge = {
    fromDocumentId: string;
    toDocumentId: string;
    ordinal: number;
    anchorText: string;
};

/**
 * Resolve every document's links against the set of documents we hold.
 *
 * Whole-corpus rather than per-document because resolution is not stable in
 * isolation: an agenda linking a bill that has not been ingested yet has a
 * dangling link, and that same link resolves the moment the bill appears. A
 * full rebuild each sync is cheap and always correct.
 *
 * Self-links are dropped. Minutes routinely link to their own Drive file, and
 * "this document references itself" is noise.
 */
export function resolveReferences(
    documents: { id: string; driveFileId: string; content: string }[],
): ReferenceEdge[] {
    const byFileId = new Map(documents.map((document) => [document.driveFileId, document.id]));
    const edges: ReferenceEdge[] = [];

    for (const document of documents) {
        let ordinal = 0;
        for (const link of extractDriveLinks(document.content)) {
            const toDocumentId = byFileId.get(link.fileId);
            if (!toDocumentId || toDocumentId === document.id) continue;

            edges.push({
                fromDocumentId: document.id,
                toDocumentId,
                ordinal,
                anchorText: link.text.slice(0, 300),
            });
            ordinal += 1;
        }
    }

    return edges;
}
