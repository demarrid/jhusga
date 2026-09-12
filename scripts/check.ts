/**
 * Runs every assertion suite and reports all of them.
 *
 * `npm run check` used to be the suites chained with `&&`, which made the first
 * failure the last thing that ran. That is the wrong trade for this repository.
 * The suites are independent -- each one asserts against a different area, and
 * none of them leaves state another reads -- so stopping at the first failure
 * buys nothing and costs the report. It cost it twice over in one afternoon:
 * three suites that could not load a module hid the six chained after them, and
 * `when.check.ts` failed on a locale assumption of its own, which hid the
 * database suite behind what everyone took to be a fact about the machine.
 * It was not one -- see the note on the day format in `when.check.ts` -- and
 * the running of every suite is what made it possible to find that out.
 *
 * So every suite runs, and the summary at the end names the ones that failed.
 * Failure is still failure: a non-zero exit from any suite is a non-zero exit
 * from this script, and a suite that crashes before it can count assertions is
 * reported as loudly as one that counts them and finds a problem. Nothing here
 * knows which failures are expected, because a runner that did would be a
 * runner that could hide a real one.
 *
 * Pass suite names to run a subset: `npm run check -- anchor summarize`.
 */

import { spawnSync } from "node:child_process";
import path from "node:path";

/**
 * Every suite, in the order it runs.
 *
 * `db` is last because it is the only one that opens a database. The rest
 * assert against pure functions and fixtures, so they run anywhere, including
 * a checkout with no `.env` -- see the note on lazy construction in
 * lib/prisma.ts, which is what makes that true.
 */
const SUITES = [
    "anchor",
    "archive",
    "accounts",
    "attendance",
    "cells",
    "cite",
    "contributors",
    "directory",
    "links",
    "identity",
    "meetings",
    "names",
    "newsletter",
    "passages",
    "summarize",
    "titles",
    "render",
    "when",
    "db",
];

function outcome(suite: string): string | null {
    const file = path.join("scripts", `${suite}.check.ts`);

    console.log(`\n=== ${suite} ${"=".repeat(Math.max(0, 68 - suite.length))}`);

    // tsx through the running Node rather than the shim in node_modules/.bin,
    // so the suites run under the same interpreter as this script.
    const run = spawnSync(process.execPath, ["--import", "tsx", file], {
        stdio: "inherit",
    });

    if (run.error) return run.error.message;
    if (run.signal) return `killed by ${run.signal}`;
    if (run.status !== 0) return `exit ${run.status}`;
    return null;
}

const requested = process.argv.slice(2);
const unknown = requested.filter((name) => !SUITES.includes(name));

if (unknown.length > 0) {
    console.error(`No such suite: ${unknown.join(", ")}`);
    console.error(`Available: ${SUITES.join(" ")}`);
    process.exit(2);
}

const selected = requested.length > 0 ? requested : SUITES;
const failed: { suite: string; reason: string }[] = [];

for (const suite of selected) {
    const reason = outcome(suite);
    if (reason !== null) failed.push({ suite, reason });
}

console.log(`\n=== summary ${"=".repeat(60)}`);
console.log(`${selected.length} suite(s) run, ${selected.length - failed.length} passed`);

for (const { suite, reason } of failed) {
    console.log(`  FAILED ${suite} (${reason})`);
}

if (failed.length > 0) {
    console.log(`\n${failed.length} suite(s) failed`);
}

process.exitCode = failed.length === 0 ? 0 : 1;
