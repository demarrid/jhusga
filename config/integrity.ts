/**
 * When a published change is flagged as possibly destructive.
 *
 * The archive reads Google Docs the SGA owns. Most are shared read-only, but
 * some are open to anyone with the link. Nothing stops somebody from opening
 * a set of minutes and deleting half of it.
 *
 * Guiding documents are held until an adopted amendment accounts for the edit
 * (lib/governing-review.ts), so these thresholds do not apply to them. Every
 * other change is published, and one that crosses these thresholds is shown
 * with a notice pointing at the version before it. Working documents are
 * never flagged.
 */

/** Kinds where the text is the rules, and losing any of it is an event. */
const AUTHORITATIVE = /^(guiding\.|bill\.)/;

export type HoldThresholds = {
    /** Flag when this fraction of the previous lines disappeared. */
    removedLineFraction: number;
    /** Flag when the document shrank to less than this fraction of its size. */
    remainingLengthFraction: number;
    /** Never flag a change smaller than this many lines; typo fixes are fine. */
    minimumRemovedLines: number;
};

/**
 * A minute set gets edited after the meeting and an agenda gets rewritten the
 * morning of, so ordinary documents are given room. A bill is not: changes to
 * it arrive as a new copy, not as a quiet deletion.
 */
const ORDINARY: HoldThresholds = {
    removedLineFraction: 0.4,
    remainingLengthFraction: 0.55,
    minimumRemovedLines: 12,
};

const GOVERNING: HoldThresholds = {
    removedLineFraction: 0.15,
    remainingLengthFraction: 0.85,
    minimumRemovedLines: 5,
};

export function thresholdsFor(kind: string): HoldThresholds {
    if (AUTHORITATIVE.test(kind)) return GOVERNING;
    return ORDINARY;
}
