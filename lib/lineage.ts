/**
 * Grouping the same document across sessions.
 *
 * The 113th and 114th both have a constitution, and comparing them is the
 * point of keeping the archive. Their Drive file IDs differ and their titles
 * usually carry a session ordinal or academic year, so the join key has to be
 * the title with those markers stripped.
 *
 * Dates are deliberately *kept*: "Senate Minutes 2025-10-14" and
 * "Senate Minutes 2026-10-14" are different meetings, not two versions of one
 * document, and collapsing them would be wrong.
 */

/** Full dates, which identify a one-off document rather than a recurring one. */
const DATE_PATTERN = /\b\d{4}-\d{1,2}-\d{1,2}\b|\b\d{1,2}[/.]\d{1,2}[/.]\d{2,4}\b/g;

/** "113th", "1st". */
const SESSION_ORDINAL_PATTERN = /\b\d{1,3}(?:st|nd|rd|th)\b/g;

/** "2025-2026", "2025-26", "2025 to 2026". */
const ACADEMIC_YEAR_PATTERN =
    /\b(?:19|20)\d{2}\s*(?:[-–—]|to)\s*(?:(?:19|20)?\d{2})\b/g;

const STANDALONE_YEAR_PATTERN = /\b(?:19|20)\d{2}\b/g;

/** Noise that varies between copies of the same document. */
const NOISE_PATTERN =
    /\b(?:sga|jhu|johns hopkins|copy of|final|draft|revised|updated|version|v\d+)\b/g;

/**
 * Derive the lineage key for a document title.
 *
 * `fallback` (normally the Drive file ID) is used when nothing meaningful
 * survives normalisation, so untitled documents each get their own lineage
 * rather than all collapsing into one.
 */
export function lineageKeyFor(title: string, fallback: string): string {
    const lowered = title.toLowerCase();

    // Pull dates out before stripping year ranges, so "2025-10-14" is not
    // mistaken for an academic year and removed.
    const dates = lowered.match(DATE_PATTERN) ?? [];

    const normalized = lowered
        .replace(DATE_PATTERN, " ")
        .replace(SESSION_ORDINAL_PATTERN, " ")
        .replace(ACADEMIC_YEAR_PATTERN, " ")
        .replace(STANDALONE_YEAR_PATTERN, " ")
        .replace(NOISE_PATTERN, " ")
        // Drop file extensions and punctuation.
        .replace(/\.(docx?|pdf|txt|md)\b/g, " ")
        .replace(/[^a-z0-9]+/g, " ")
        .trim()
        .replace(/\s+/g, " ");

    const withDates = [normalized, ...dates.map((date) => date.trim())]
        .filter(Boolean)
        .join(" ");

    return withDates || `untitled:${fallback}`;
}
