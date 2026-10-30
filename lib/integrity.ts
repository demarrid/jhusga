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

    // A file edit is not itself evidence of passage. Store it for the
    // post-sync amendment review, which checks archived passage evidence and
    // replays authorized changes against the published text.
    if (isGoverning(input.kind)) {
        return {
            ...verdict,
            publish: false,
            reason:
                `${preamble}${openDoor ? "the" : "The"} source edit is awaiting verification against an amendment adopted in a Senate meeting ` +
                `(${diff.added} line${diff.added === 1 ? "" : "s"} added, ` +
                `${diff.removed} removed) — ratified.`,
        };
    }

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

const GOVERNING_PATTERN = /^guiding\./;

/**
 * Whether a change to this kind has to be adopted in a meeting rather than
 * merely watched for destruction.
 */
export function isGoverning(kind: string): boolean {
    return GOVERNING_PATTERN.test(kind);
}

/**
 * A marker embedded in `heldReason` so the reader-facing notice and the
 * review script can tell "held pending ratification" apart from "held for
 * possible destruction". Not shown to the reader.
 */
export const RATIFICATION_MARKER = " — ratified.";

/**
 * How to describe a held document to a reader, as opposed to a reviewer.
 *
 * Governing changes await source-backed amendment verification. Other
 * changes retain the ordinary size-screening notice.
 */
export function heldNotice(reason: string): string {
    if (reason.endsWith(RATIFICATION_MARKER)) {
        // Do not repeat legacy stored claims that an edit was not ratified or
        // that the baseline was verified adopted. Only the diff count is known.
        const counts = /\(\d+ lines? added, \d+ removed\)/.exec(reason)?.[0];
        return `The source file changed${counts ? ` ${counts}` : ""}. This revision is awaiting verification against an adopted amendment. You are reading the previously published version.`;
    }
    return `The source file has changed substantially since this text was last checked — ${reason} You are reading the last checked version. The change is stored and awaiting review.`;
}
