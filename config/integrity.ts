/**
 * When a change to a source document is published, and when it is held back.
 *
 * The archive reads Google Docs the SGA owns. Most are shared read-only, but
 * some are open to anyone with the link, and a few of those are governing
 * documents. Nothing stops somebody from opening the constitution and deleting
 * Article IV, and until now the next sync would have published that and
 * re-anchored every citation onto it.
 *
 * So a change that looks destructive is not published. The revision is still
 * stored -- history stays append-only -- but the site keeps serving the last
 * text a human accepted, and says on the page that it is doing so. The bias is
 * deliberate: a held change costs somebody five minutes with `npm run review`,
 * and an unheld one costs the site its only claim to being worth reading.
 */

/** Kinds where the text is the rules, and losing any of it is an event. */
const AUTHORITATIVE = /^(guiding\.|bill\.)/;

export type HoldThresholds = {
    /** Hold when this fraction of the previous lines disappeared. */
    removedLineFraction: number;
    /** Hold when the document shrank to less than this fraction of its size. */
    remainingLengthFraction: number;
    /** Never hold a change smaller than this many lines; typo fixes are fine. */
    minimumRemovedLines: number;
};

/**
 * A minute set gets edited after the meeting and an agenda gets rewritten the
 * morning of, so ordinary documents are given room. A constitution is not:
 * amendments to it arrive as a bill and a new copy, not as a quiet deletion.
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

/**
 * A file anyone with the link can edit gets the tightest treatment there is,
 * whatever it contains. The threat is not that the document is important; it
 * is that the door is open.
 */
const WORLD_EDITABLE: HoldThresholds = {
    removedLineFraction: 0.05,
    minimumRemovedLines: 3,
    remainingLengthFraction: 0.95,
};

export function thresholdsFor(input: {
    kind: string;
    anyoneCanEdit: boolean | null;
}): HoldThresholds {
    if (input.anyoneCanEdit === true) return WORLD_EDITABLE;
    if (AUTHORITATIVE.test(input.kind)) return GOVERNING;
    return ORDINARY;
}

/**
 * Additions are not held.
 *
 * Vandalism that only adds text is possible, and the model screening does not
 * apply to Drive. But holding every append would hold every set of minutes
 * ever taken, and the review queue only works if it is short enough that
 * somebody reads it.
 */
export const HOLD_PURE_ADDITIONS = false;
