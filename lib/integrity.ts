import { HOLD_PURE_ADDITIONS, thresholdsFor } from "@/config/integrity";
import { diffLines } from "@/lib/diff";

/**
 * Deciding whether a change to a source document can be published unread.
 *
 * The archive has no control over the documents it reads. They live in Google
 * Drive, they are shared by whoever created them, and some of them are open to
 * anyone holding the link. Before this existed, a stranger who deleted half the
 * constitution would have had that published within a day, every citation
 * re-anchored onto the remains, and the passages that no longer existed quietly
 * marked orphaned -- the machinery for handling amendments would have processed
 * the vandalism perfectly.
 *
 * The distinction this module draws is not vandalism versus amendment, which
 * cannot be made from the text. It is "small enough to be routine" versus
 * "large enough that somebody should look". The second case is held: stored,
 * not published, and shown on the page as awaiting review.
 *
 * Pure text in, verdict out. lib/sync.ts acts on it.
 */

export type ChangeVerdict = {
    publish: boolean;
    /** Why, in the words the review queue and the page banner will use. */
    reason: string;
    removedLines: number;
    addedLines: number;
};

const PUBLISH: ChangeVerdict = {
    publish: true,
    reason: "",
    removedLines: 0,
    addedLines: 0,
};

export function assessChange(input: {
    kind: string;
    anyoneCanEdit: boolean | null;
    /** The text currently published. Empty for a document being ingested. */
    before: string;
    after: string;
}): ChangeVerdict {
    // Nothing to protect yet. A document's first version is what it is.
    if (!input.before.trim()) return PUBLISH;
    if (input.before === input.after) return PUBLISH;

    const diff = diffLines(input.before, input.after);
    const beforeLines = input.before.split("\n").length;

    const verdict = {
        publish: true,
        reason: "",
        removedLines: diff.removed,
        addedLines: diff.added,
    };

    const thresholds = thresholdsFor(input);

    // An open door is worth saying out loud even when the change is innocuous,
    // because it is the reason the thresholds are as tight as they are.
    const openDoor = input.anyoneCanEdit === true;
    const preamble = openDoor
        ? "This file is shared so that anyone with the link can edit it, and "
        : "";

    if (diff.removed === 0 && !HOLD_PURE_ADDITIONS) {
        return verdict;
    }

    if (diff.removed < thresholds.minimumRemovedLines) {
        return verdict;
    }

    const removedFraction = diff.removed / Math.max(beforeLines, 1);
    if (removedFraction >= thresholds.removedLineFraction) {
        return {
            ...verdict,
            publish: false,
            reason: `${preamble}${percent(removedFraction)} of its lines were removed (${diff.removed} of ${beforeLines}).`,
        };
    }

    const remainingFraction = input.after.length / Math.max(input.before.length, 1);
    if (remainingFraction < thresholds.remainingLengthFraction) {
        return {
            ...verdict,
            publish: false,
            reason: `${preamble}it shrank to ${percent(remainingFraction)} of its previous length.`,
        };
    }

    return verdict;
}

function percent(fraction: number): string {
    return `${Math.round(fraction * 100)}%`;
}

/**
 * How to describe a held document to a reader, as opposed to a reviewer.
 *
 * Deliberately does not say "vandalism": the overwhelmingly likely explanation
 * is that somebody rewrote a document legitimately and nobody has confirmed it
 * yet, and accusing an officer of vandalism in public would be worse than the
 * risk this whole mechanism exists to manage.
 */
export function heldNotice(reason: string): string {
    return `The source file has changed substantially since this text was last checked — ${reason} You are reading the last checked version. The change is stored and awaiting review.`;
}
