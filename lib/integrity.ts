import { thresholdsFor } from "@/config/integrity";
import { diffLines, type DiffResult } from "@/lib/diff";
import { isCosmeticChange } from "@/lib/cosmetic-changes";

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
 * Only guiding documents are held: stored, not published, and shown on the
 * page as awaiting verification. Everything else publishes. A change large
 * enough that it might be vandalism is not held, but the page points the
 * reader at the version before it (see `largeRemoval`).
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
    /** The text currently published. Empty for a document being ingested. */
    before: string;
    after: string;
}): ChangeVerdict {
    // Nothing to protect yet. A document's first version is what it is.
    if (!input.before.trim()) return PUBLISH;
    if (input.before === input.after) return PUBLISH;

    const diff = diffLines(input.before, input.after);

    const verdict = {
        publish: true,
        reason: "",
        removedLines: diff.removed,
        addedLines: diff.added,
    };

    // A file edit is not itself evidence of passage. Store it for the
    // post-sync amendment review, which checks archived passage evidence and
    // replays authorized changes against the published text.
    if (isGoverning(input.kind)) {
        if (isCosmeticChange(input.before, input.after)) return verdict;
        return {
            ...verdict,
            publish: false,
            reason:
                `The source edit is awaiting verification against an amendment adopted in a Senate meeting ` +
                `(${diff.added} line${diff.added === 1 ? "" : "s"} added, ` +
                `${diff.removed} removed) — ratified.`,
        };
    }

    return verdict;
}

/**
 * Why a published version looks destructive next to the one before it, or
 * null when it does not.
 *
 * Guiding documents are held instead, and working documents are drafts that
 * are expected to be gutted and rewritten, so neither is measured.
 */
export function largeRemoval(input: {
    kind: string;
    before: string;
    after: string;
    diff?: DiffResult;
}): string | null {
    if (isGoverning(input.kind) || input.kind.startsWith("working.")) return null;
    if (!input.before.trim() || input.before === input.after) return null;

    const diff = input.diff ?? diffLines(input.before, input.after);
    if (diff.removed === 0) return null;

    const thresholds = thresholdsFor(input.kind);
    if (diff.removed < thresholds.minimumRemovedLines) return null;

    const beforeLines = input.before.split("\n").length;
    const removedFraction = diff.removed / Math.max(beforeLines, 1);
    if (removedFraction >= thresholds.removedLineFraction) {
        return `${percent(removedFraction)} of its lines were removed (${diff.removed} of ${beforeLines}).`;
    }

    const remainingFraction = input.after.length / Math.max(input.before.length, 1);
    if (remainingFraction < thresholds.remainingLengthFraction) {
        return `It shrank to ${percent(remainingFraction)} of its previous length.`;
    }

    return null;
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
 * Governing changes await source-backed amendment verification. Anything
 * else still held was held by size screening, which the next sync releases.
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
