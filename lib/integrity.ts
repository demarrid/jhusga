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

    // Guiding documents are amended in a Senate meeting, not by a quiet edit
    // to the Drive file. Nothing in the file itself can prove that a meeting
    // adopted the change, so any change -- addition, removal, or reword, at
    // any size -- is held until somebody with a copy of the minutes clears
    // it. The site keeps serving the last ratified text. See the "ratified"
    // marker below: the review script checks for it and treats a hold in
    // this mode as "confirm this was adopted" rather than "confirm this is
    // not vandalism".
    if (isGoverning(input.kind)) {
        return {
            ...verdict,
            publish: false,
            reason:
                `${preamble}the constitution and bylaws are amended by a bill passed in a Senate meeting, ` +
                `and this edit to the source file has not been ratified in one yet ` +
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
 * Two shapes. A governing document is held because the edit to the Drive file
 * has no meeting behind it yet, and the notice says so: the reader is looking
 * at the last ratified text on purpose, not because the archive suspects
 * vandalism. Everything else is held because the change was large enough for
 * someone to look, and the notice keeps the older phrasing — deliberately not
 * saying "vandalism", since the overwhelmingly likely explanation is that
 * somebody rewrote the document and nobody has confirmed it yet.
 */
export function heldNotice(reason: string): string {
    if (reason.endsWith(RATIFICATION_MARKER)) {
        const trimmed = reason.slice(0, -RATIFICATION_MARKER.length);
        return `${trimmed} You are reading the text last adopted by the Senate; the edit is stored and will appear here once a meeting record confirms it.`;
    }
    return `The source file has changed substantially since this text was last checked — ${reason} You are reading the last checked version. The change is stored and awaiting review.`;
}
