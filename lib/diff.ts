/**
 * Line-level diff, for showing what an amendment actually changed.
 *
 * Hand-rolled rather than pulled from a dependency because the requirement is
 * narrow (two markdown exports, rendered read-only) and this keeps the ingest
 * pipeline dependency-free.
 */

export type DiffOp = {
    type: "equal" | "added" | "removed";
    lines: string[];
};

export type DiffResult = {
    ops: DiffOp[];
    added: number;
    removed: number;
    /**
     * True when the changed region was too large to diff precisely and the
     * result is a coarse whole-block replacement. Better to say so than to
     * spend a gigabyte on a quadratic table.
     */
    coarse: boolean;
};

/**
 * Cap on the dynamic programming table. Two documents that differ in a few
 * thousand lines stay well inside this; a wholesale rewrite falls back to the
 * coarse result.
 */
const MAX_TABLE_CELLS = 4_000_000;

function pushOp(ops: DiffOp[], type: DiffOp["type"], line: string): void {
    const last = ops[ops.length - 1];
    if (last && last.type === type) {
        last.lines.push(line);
        return;
    }
    ops.push({ type, lines: [line] });
}

export function diffLines(before: string, after: string): DiffResult {
    const beforeLines = before.split("\n");
    const afterLines = after.split("\n");

    // Identical documents are the common case on a re-sync.
    if (before === after) {
        return {
            ops: beforeLines.length ? [{ type: "equal", lines: beforeLines }] : [],
            added: 0,
            removed: 0,
            coarse: false,
        };
    }

    // Trim the shared head and tail; amendments usually touch a small middle.
    let head = 0;
    while (
        head < beforeLines.length &&
        head < afterLines.length &&
        beforeLines[head] === afterLines[head]
    ) {
        head += 1;
    }

    let tail = 0;
    while (
        tail < beforeLines.length - head &&
        tail < afterLines.length - head &&
        beforeLines[beforeLines.length - 1 - tail] ===
        afterLines[afterLines.length - 1 - tail]
    ) {
        tail += 1;
    }

    const beforeMiddle = beforeLines.slice(head, beforeLines.length - tail);
    const afterMiddle = afterLines.slice(head, afterLines.length - tail);

    const ops: DiffOp[] = [];
    if (head > 0) ops.push({ type: "equal", lines: beforeLines.slice(0, head) });

    let added = 0;
    let removed = 0;
    let coarse = false;

    if ((beforeMiddle.length + 1) * (afterMiddle.length + 1) > MAX_TABLE_CELLS) {
        coarse = true;
        if (beforeMiddle.length) ops.push({ type: "removed", lines: beforeMiddle });
        if (afterMiddle.length) ops.push({ type: "added", lines: afterMiddle });
        removed = beforeMiddle.length;
        added = afterMiddle.length;
    } else {
        // Longest common subsequence over the changed region.
        const rows = beforeMiddle.length + 1;
        const columns = afterMiddle.length + 1;
        const table = new Int32Array(rows * columns);

        for (let i = beforeMiddle.length - 1; i >= 0; i -= 1) {
            for (let j = afterMiddle.length - 1; j >= 0; j -= 1) {
                table[i * columns + j] =
                    beforeMiddle[i] === afterMiddle[j]
                        ? table[(i + 1) * columns + (j + 1)] + 1
                        : Math.max(
                            table[(i + 1) * columns + j],
                            table[i * columns + (j + 1)],
                        );
            }
        }

        let i = 0;
        let j = 0;
        while (i < beforeMiddle.length && j < afterMiddle.length) {
            if (beforeMiddle[i] === afterMiddle[j]) {
                pushOp(ops, "equal", beforeMiddle[i]);
                i += 1;
                j += 1;
            } else if (
                table[(i + 1) * columns + j] >= table[i * columns + (j + 1)]
            ) {
                pushOp(ops, "removed", beforeMiddle[i]);
                removed += 1;
                i += 1;
            } else {
                pushOp(ops, "added", afterMiddle[j]);
                added += 1;
                j += 1;
            }
        }
        while (i < beforeMiddle.length) {
            pushOp(ops, "removed", beforeMiddle[i]);
            removed += 1;
            i += 1;
        }
        while (j < afterMiddle.length) {
            pushOp(ops, "added", afterMiddle[j]);
            added += 1;
            j += 1;
        }
    }

    if (tail > 0) {
        ops.push({
            type: "equal",
            lines: beforeLines.slice(beforeLines.length - tail),
        });
    }

    return { ops, added, removed, coarse };
}

/**
 * Drop long stretches of unchanged text, keeping `context` lines either side of
 * each change, so a diff of the constitution renders as the amended passages
 * rather than the whole document.
 */
export function collapseUnchanged(
    result: DiffResult,
    context = 3,
): (DiffOp | { type: "skipped"; count: number })[] {
    const output: (DiffOp | { type: "skipped"; count: number })[] = [];

    result.ops.forEach((op, index) => {
        if (op.type !== "equal") {
            output.push(op);
            return;
        }

        const atStart = index === 0;
        const atEnd = index === result.ops.length - 1;
        const keepBefore = atStart ? 0 : context;
        const keepAfter = atEnd ? 0 : context;

        if (op.lines.length <= keepBefore + keepAfter) {
            output.push(op);
            return;
        }

        if (keepBefore > 0) {
            output.push({ type: "equal", lines: op.lines.slice(0, keepBefore) });
        }
        output.push({
            type: "skipped",
            count: op.lines.length - keepBefore - keepAfter,
        });
        if (keepAfter > 0) {
            output.push({
                type: "equal",
                lines: op.lines.slice(op.lines.length - keepAfter),
            });
        }
    });

    return output;
}
