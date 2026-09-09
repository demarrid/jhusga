/**
 * Cleaning up Google Docs' markdown export.
 *
 * The export represents every inline image as a reference (`![][image1]`) and
 * appends the image itself as a base64 definition at the end of the file.
 * Across the SGA archive those definitions are the overwhelming majority of all
 * stored text: they bloat the database, they are shipped to the model verbatim
 * on every generation, and the leftover `![]()` markers surface as gibberish in
 * document descriptions.
 *
 * None of it is content, so it is stripped at ingest. Everything else is left
 * exactly as exported, because citation offsets index into the stored string.
 */

/** `[image1]: <data:image/png;base64,...>` at the foot of the export. */
const IMAGE_DEFINITION = /^\s*\[[^\]\n]+\]:\s*<data:[^>]*>[ \t]*$/gm;

/** `![alt](url)` and `![alt][ref]`, including the empty `![]()` case. */
const INLINE_IMAGE = /!\[[^\]\n]*\](?:\([^)\n]*\)|\[[^\]\n]*\])/g;

/**
 * Leftovers after an image marker is half-stripped, or a strikethrough wrapped
 * around an empty link: `[]()`, `~[]()`, `[][image1]`.
 */
const EMPTY_BRACKET_LINK = /~?\[\](?:\([^)\n]*\)|\[[^\]\n]*\])?/g;

/** Bare `[image1]` refs that survive after their definition is removed. */
const BARE_IMAGE_REF = /\[image\d+\]/gi;

/** `[text](url)` -> `text`. */
const INLINE_LINK = /\[([^\]\n]*)\]\([^)\n]*\)/g;

/** `[text][ref]` -> `text`. */
const REFERENCE_LINK = /\[([^\]\n]*)\]\[[^\]\n]*\]/g;

/** Any remaining link-reference definition line. */
const LINK_DEFINITION = /^\s*\[[^\]\n]+\]:\s*\S.*$/gm;

/**
 * Remove image payloads from an export, preserving everything else verbatim.
 *
 * Safe to apply before hashing: it is deterministic, so an unchanged document
 * still produces an unchanged hash.
 */
export function sanitizeExport(markdown: string): string {
    return (
        markdown
            .replace(IMAGE_DEFINITION, "")
            .replace(INLINE_IMAGE, "")
            .replace(EMPTY_BRACKET_LINK, "")
            .replace(BARE_IMAGE_REF, "")
            // An image on its own line leaves trailing spaces behind.
            .replace(/[ \t]+$/gm, "")
            // ...and often an empty paragraph where the image used to be.
            .replace(/\n{3,}/g, "\n\n")
            .trim()
    );
}

/**
 * Flatten markdown to readable prose, for descriptions and search.
 *
 * Lossy by design -- never use this for anything a citation anchors into.
 */
export function toPlainText(markdown: string): string {
    return markdown
        .replace(IMAGE_DEFINITION, "")
        .replace(INLINE_IMAGE, "")
        .replace(EMPTY_BRACKET_LINK, "")
        .replace(BARE_IMAGE_REF, "")
        .replace(INLINE_LINK, "$1")
        .replace(REFERENCE_LINK, "$1")
        .replace(LINK_DEFINITION, "")
        // Table pipes and rules read as noise once the layout is gone.
        .replace(/^\s*\|?[\s:|-]{4,}\|?\s*$/gm, " ")
        .replace(/\|/g, " ")
        .replace(/^\s*>\s?/gm, "")
        .replace(/^\s*[-*+]\s+/gm, "")
        .replace(/^\s*\d+[.)]\s+/gm, "")
        // Not anchored: Docs nests headings inside list items, so a line can
        // arrive as "1. ## Call to Order" and the marker is only mid-string
        // once the list numbering above has been stripped.
        .replace(/#{1,6}\s+/g, "")
        .replace(/[*_`~]/g, "")
        // Google Docs escapes punctuation aggressively: `SECTION 1\.`
        .replace(/\\([^A-Za-z0-9])/g, "$1")
        // Runs of brackets are left over from that escaping, never content.
        .replace(/[[\]]{2,}/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

/**
 * Listing copy that is leftover chrome, not a description of the document.
 *
 * Google Docs minutes often open with a Zoom link, a calendar embed, or an
 * attendance table whose header row flattens to "Attendance Absent Excused
 * Present Faculty". Showing that as the blurb is how `![]()` and `Join Zoom
 * Meeting` ended up on /documents.
 */
export function isNoiseDescription(plain: string): boolean {
    const text = plain.trim();
    if (text.length < 8) return true;
    if (/^join zoom\b/i.test(text)) return true;
    if (/zoom\.us/i.test(text)) return true;
    if (/^meeting minutes:?$/i.test(text)) return true;
    if (/^(discussion|agenda items|committee members|attendance):?$/i.test(text)) {
        return true;
    }
    if (
        /^absentees?:/i.test(text) &&
        !/[A-Z][a-z]{2,}/.test(text.replace(/absentees?|excused|unexcused|present/gi, ""))
    ) {
        return true;
    }
    if (/^call to order and attendance/i.test(text)) return true;
    if (/^call to order\b/i.test(text) && /\(\d+\s*min\)/i.test(text)) return true;
    if (/^tab \d+$/i.test(text)) return true;
    if (
        /\b(PDT|MDT|CDT|EDT|EST|PST|GMT)\b/.test(text) &&
        /\b(join zoom|am|pm)\b/i.test(text)
    ) {
        return true;
    }
    if (
        /^(attendance|absent|present|excused|faculty|here)\b/i.test(text) &&
        text.length < 220
    ) {
        return true;
    }
    // Flattened attendance tables: "Name Present Name Absent Name Present".
    if ((text.match(/\b(Present|Absent|Excused)\b/g) ?? []).length >= 3) {
        return true;
    }
    return false;
}

/**
 * The first paragraph worth showing in a listing.
 *
 * Headings are skipped in favour of real prose, but fall back to a heading when
 * a document is nothing but headings and tables -- a bare title still beats an
 * empty cell.
 */
export function deriveDescription(markdown: string, limit = 300): string {
    const blocks = sanitizeExport(markdown)
        .split(/\n\s*\n/)
        .map((block) => block.trim())
        .filter(Boolean);

    const usable = (block: string) => {
        const plain = toPlainText(block);
        return plain.length > 0 && !isNoiseDescription(plain);
    };

    const prose = blocks.find((block) => !block.startsWith("#") && usable(block));
    const fallback = blocks.find((block) => usable(block));

    const plain = toPlainText(prose ?? fallback ?? "");
    if (plain.length <= limit) return plain;

    // Prefer a word boundary over cutting mid-word.
    const cut = plain.slice(0, limit - 3);
    const lastSpace = cut.lastIndexOf(" ");
    return `${(lastSpace > limit * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}...`;
}
