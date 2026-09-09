/**
 * Checks the archive machinery: which session a folder introduces, how titles
 * collapse into a lineage, and whether the diff is correct.
 */

import { archiveSessionFor } from "../lib/drive";
import { collapseUnchanged, diffLines } from "../lib/diff";
import { lineageKeyFor } from "../lib/lineage";

let failures = 0;
function check(label: string, condition: boolean, detail?: unknown) {
    if (condition) {
        console.log(`  ok   ${label}`);
    } else {
        failures += 1;
        console.log(`  FAIL ${label}`, detail ?? "");
    }
}

console.log("archiveSessionFor");
check(
    "reads the session out of an archive folder name",
    archiveSessionFor("113th SGA Master Folder 2025-2026") === 113,
    archiveSessionFor("113th SGA Master Folder 2025-2026"),
);
check(
    "handles a single-digit ordinal",
    archiveSessionFor("1st SGA Master Folder 1913-1914") === 1,
);
check(
    "ignores an ordinary folder",
    archiveSessionFor("Guiding Documents") === null,
);
check(
    "ignores a folder that merely mentions the SGA",
    archiveSessionFor("SGA Senate Minutes") === null,
);

console.log("\nlineageKeyFor");

// The whole point: the same document across sessions must collapse together.
const current = lineageKeyFor("SGA Constitution", "a");
const prior = lineageKeyFor("113th SGA Constitution 2025-2026", "b");
check("this session's and last session's constitution share a lineage", current === prior, {
    current,
    prior,
});
check(
    "a budget with an academic year collapses across sessions",
    lineageKeyFor("SGA Budget 2025-2026", "a") ===
    lineageKeyFor("SGA Budget 2026-2027", "b"),
);
check(
    "bylaws do not collapse into the constitution",
    lineageKeyFor("SGA Bylaws", "a") !== lineageKeyFor("SGA Constitution", "b"),
);

// Dated one-offs must stay distinct, or every meeting's minutes would be
// treated as versions of a single document.
check(
    "minutes from different dates stay distinct",
    lineageKeyFor("Senate Minutes 2025-10-14", "a") !==
    lineageKeyFor("Senate Minutes 2026-10-14", "b"),
    {
        a: lineageKeyFor("Senate Minutes 2025-10-14", "a"),
        b: lineageKeyFor("Senate Minutes 2026-10-14", "b"),
    },
);
check(
    "a full date is not mistaken for an academic year and stripped",
    lineageKeyFor("Senate Minutes 2025-10-14", "a").includes("2025-10-14"),
    lineageKeyFor("Senate Minutes 2025-10-14", "a"),
);
check(
    "an untitled document falls back to its own id",
    lineageKeyFor("2026", "file-xyz") === "untitled:file-xyz",
    lineageKeyFor("2026", "file-xyz"),
);
check(
    "a copy collapses onto the original",
    lineageKeyFor("Copy of SGA Constitution", "a") ===
    lineageKeyFor("SGA Constitution", "b"),
);

console.log("\ndiffLines");

const before = ["one", "two", "three", "four", "five"].join("\n");
const after = ["one", "two", "THREE", "four", "five", "six"].join("\n");
const diff = diffLines(before, after);

check("counts the added lines", diff.added === 2, diff.added);
check("counts the removed lines", diff.removed === 1, diff.removed);
check("is not coarse for a small diff", diff.coarse === false);
check(
    "reconstructs the before side from equal + removed",
    diff.ops
        .filter((op) => op.type !== "added")
        .flatMap((op) => op.lines)
        .join("\n") === before,
);
check(
    "reconstructs the after side from equal + added",
    diff.ops
        .filter((op) => op.type !== "removed")
        .flatMap((op) => op.lines)
        .join("\n") === after,
);

const identical = diffLines(before, before);
check(
    "identical documents report no changes",
    identical.added === 0 && identical.removed === 0,
    identical,
);

// A realistic amendment: one clause reworded in a long document.
const longBefore = Array.from({ length: 500 }, (_, i) => `clause ${i}`).join("\n");
const longAfter = longBefore.replace("clause 250", "clause 250, as amended");
const longDiff = diffLines(longBefore, longAfter);
check(
    "a single reworded clause is an isolated change",
    longDiff.added === 1 && longDiff.removed === 1,
    { added: longDiff.added, removed: longDiff.removed },
);

const collapsed = collapseUnchanged(longDiff, 3);
check(
    "unchanged bulk is collapsed away",
    collapsed.some((op) => op.type === "skipped"),
);
check(
    "every change survives collapsing",
    collapsed.flatMap((op) =>
        op.type === "added" || op.type === "removed" ? op.lines : [],
    ).length === 2,
);
check(
    "collapsed output is far shorter than the document",
    collapsed.flatMap((op) => (op.type === "skipped" ? [] : op.lines)).length < 20,
);

console.log(failures === 0 ? "\nall checks passed" : `\n${failures} failure(s)`);
process.exitCode = failures === 0 ? 0 : 1;
