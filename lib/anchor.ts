/**
 * Locating quoted passages inside a document.
 *
 * Character offsets cannot be the source of truth for a citation: every
 * re-export shifts them, and an amendment inserted near the top of the
 * constitution would silently slide every highlight below it. So the quote text
 * is authoritative and offsets are recomputed from it after each sync.
 *
 * Matching has to tolerate the gap between what a model emits and what the
 * markdown export contains -- Google Docs uses curly quotes and non-breaking
 * spaces, wraps emphasis in markdown markers, and rewraps lines.
 */

import { cellBreakAt } from "@/lib/markdown";

export type Anchor = { startOffset: number; endOffset: number };

/** Characters folded to an ASCII equivalent before matching. Strictly 1:1. */
const CHARACTER_FOLDS: Record<string, string> = {
    "\u2018": "'",
    "\u2019": "'",
    "\u201A": "'",
    "\u201C": '"',
    "\u201D": '"',
    "\u201E": '"',
    "\u2013": "-",
    "\u2014": "-",
    "\u2212": "-",
    "\u00A0": " ",
    "\u2026": ".",
};

/** Markdown syntax dropped entirely, so a quote matches across **emphasis**. */
const IGNORED_CHARACTERS = new Set(["*", "_", "`", "#", "\\"]);

export type NormalizedText = {
    /** Folded, lowercased, whitespace-collapsed text. */
    text: string;
    /** map[i] is the index in the original string of normalized character i. */
    map: number[];
};

/**
 * The projection two pieces of text are compared in.
 *
 * Exported for lib/cells.ts, which has to line an export up against the same
 * document as Google served it in another format, and wants the same tolerance
 * for markers and curly quotes that a citation gets.
 */
export function normalizeForMatch(input: string): NormalizedText {
    const characters: string[] = [];
    const map: number[] = [];
    let pendingSpace = false;

    for (let index = 0; index < input.length; index += 1) {
        const raw = input[index];

        // A restored cell break stands for a line the author typed, so a quote
        // reads across it exactly as it reads across a newline.
        const breakWidth = cellBreakAt(input, index);
        if (breakWidth > 0) {
            pendingSpace = characters.length > 0;
            index += breakWidth - 1;
            continue;
        }

        const folded = CHARACTER_FOLDS[raw] ?? raw;

        if (IGNORED_CHARACTERS.has(folded)) continue;

        if (/\s/.test(folded)) {
            // Collapse any whitespace run to a single space, and never lead with one.
            pendingSpace = characters.length > 0;
            continue;
        }

        if (pendingSpace) {
            characters.push(" ");
            map.push(index);
            pendingSpace = false;
        }

        const lowered = folded.toLowerCase();
        // Guard the rare case where lowercasing changes length, which would
        // desynchronise the offset map.
        characters.push(lowered.length === 1 ? lowered : folded);
        map.push(index);
    }

    return { text: characters.join(""), map };
}

/**
 * Below this length, a quote that occurs more than once is treated as
 * unresolvable rather than pinned to its first occurrence. A long quote that
 * repeats verbatim is almost always a genuinely duplicated clause, where the
 * first occurrence is a reasonable target; a short one is usually a fragment
 * like "shall" that would highlight an arbitrary spot.
 */
const MIN_AMBIGUOUS_QUOTE_LENGTH = 40;

/** First occurrence, or null if absent or ambiguously short. */
function locateUnambiguous(
    haystack: string,
    needle: string,
): number | null {
    const first = haystack.indexOf(needle);
    if (first === -1) return null;

    if (needle.length >= MIN_AMBIGUOUS_QUOTE_LENGTH) return first;

    return haystack.indexOf(needle, first + 1) === -1 ? first : null;
}

/**
 * Find `quote` in `content`, returning offsets into the original `content`.
 *
 * Returns null when the passage is no longer present -- the signal that a
 * citation has been amended away -- or when it is too ambiguous to place.
 */
export function findQuote(content: string, quote: string): Anchor | null {
    if (!content || !quote.trim()) return null;

    // Fast path: an untouched verbatim quote.
    const exact = locateUnambiguous(content, quote);
    if (exact !== null) {
        return { startOffset: exact, endOffset: exact + quote.length };
    }
    // A quote present but ambiguous in the raw text stays ambiguous once
    // normalized, so there is nothing to gain from the slower path.
    if (content.includes(quote)) return null;

    const haystack = normalizeForMatch(content);
    const needle = normalizeForMatch(quote);
    if (!needle.text) return null;

    const found = locateUnambiguous(haystack.text, needle.text);
    if (found === null) return null;

    return {
        startOffset: haystack.map[found],
        endOffset: haystack.map[found + needle.text.length - 1] + 1,
    };
}

/**
 * A citation's resolved position, as stored. Null offsets mean the passage was
 * amended away and the annotation is orphaned; lib/render skips those.
 */
export type AnnotationSpan = {
    id: string;
    startOffset: number | null;
    endOffset: number | null;
};
