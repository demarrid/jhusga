/**
 * Checks the order the summary queue works through.
 *
 * The queue is budgeted (SUMMARY_RUN_BUDGET), so its order decides what gets a
 * summary tonight and what waits. Two properties have to hold, and neither is
 * visible by reading a `findMany` call:
 *
 * 1. Current-session material is never behind archive backfill. The
 *    News-Letter is being read a year at a time into sessions that ended a
 *    decade ago, and those rows are created tonight with no Drive timestamps
 *    at all, so every way of ordering that leans on when the archive learned
 *    of a document, or on a column only one source has, puts them first.
 * 2. The order is total. A budget applied to the front of an order with ties
 *    can skip the same document every night, forever, and that failure is
 *    invisible: nothing errors, a document simply never gets a summary.
 *
 * So the fixtures below are ordered by a comparator derived from
 * SUMMARY_QUEUE_ORDER rather than by a copy of it -- reordering the keys wrongly
 * has to fail here. Postgres's own null placement is reproduced, defaults
 * included, because defaulting to NULLS FIRST under DESC is the specific thing
 * that broke.
 */
import { SUMMARY_QUEUE_ORDER } from "../lib/summarize";

let failures = 0;
function check(label: string, condition: boolean, detail?: unknown) {
    if (condition) {
        console.log(`  ok   ${label}`);
    } else {
        failures += 1;
        console.log(`  FAIL ${label}`, detail ?? "");
    }
}

/** The columns the queue is allowed to read, as a row of one. */
type QueueRow = {
    id: string;
    sessionNumber: number | null;
    datedAt: Date | null;
    driveModifiedTime: Date | null;
    lastSyncedAt: Date | null;
    createdAt: Date;
};

/** Every column in QueueRow that the schema lets be null. */
const NULLABLE = ["sessionNumber", "datedAt", "driveModifiedTime", "lastSyncedAt"];

function day(text: string): Date {
    return new Date(`${text}T12:00:00Z`);
}

type Key = { column: string; sort: "asc" | "desc"; nulls: "first" | "last" };

/**
 * The order table as a list of keys.
 *
 * Prisma writes a key either as `{ column: "desc" }` or as
 * `{ column: { sort: "desc", nulls: "last" } }`, and only the second can place
 * nulls. Where it is unstated Postgres treats nulls as larger than any value,
 * so they lead under DESC and trail under ASC.
 */
function keys(): Key[] {
    return SUMMARY_QUEUE_ORDER.map((entry) => {
        const [column, spec] = Object.entries(entry)[0] as [string, unknown];

        if (typeof spec === "string") {
            return { column, sort: spec as "asc" | "desc", nulls: spec === "desc" ? "first" : "last" } as Key;
        }

        const { sort, nulls } = spec as { sort: "asc" | "desc"; nulls?: "first" | "last" };
        return { column, sort, nulls: nulls ?? (sort === "desc" ? "first" : "last") };
    });
}

function value(row: QueueRow, column: string): number | null {
    const held = (row as unknown as Record<string, unknown>)[column];
    if (held === null || held === undefined) return null;
    return held instanceof Date ? held.getTime() : Number(held);
}

function compare(left: QueueRow, right: QueueRow): number {
    for (const key of keys()) {
        if (key.column === "id") {
            const order = left.id.localeCompare(right.id);
            if (order !== 0) return key.sort === "desc" ? -order : order;
            continue;
        }

        const a = value(left, key.column);
        const b = value(right, key.column);

        if (a === null && b === null) continue;
        if (a === null) return key.nulls === "first" ? -1 : 1;
        if (b === null) return key.nulls === "first" ? 1 : -1;
        if (a !== b) return key.sort === "desc" ? b - a : a - b;
    }

    return 0;
}

console.log("SUMMARY_QUEUE_ORDER");

const columns = SUMMARY_QUEUE_ORDER.map((entry) => Object.keys(entry)[0]);

check("every key names exactly one column", SUMMARY_QUEUE_ORDER.every((entry) => Object.keys(entry).length === 1));
check("no column is used twice", new Set(columns).size === columns.length, columns);
check(
    // Nothing above this is unique, so it is the whole of what makes the order
    // total; `id` is the document's primary key.
    "the last key is a column that cannot tie",
    columns.at(-1) === "id",
    columns,
);
check(
    "the session is read before any date",
    columns.indexOf("sessionNumber") === 0,
    columns,
);
check(
    // The bug: a News-Letter article has no Drive timestamps, so ordering on
    // them first sorted every article ahead of every document in its session.
    "the date a document states about itself outranks Drive's timestamp",
    columns.indexOf("datedAt") < columns.indexOf("driveModifiedTime"),
    columns,
);
check(
    // Rewritten every run for every Drive document, so as a sort key it means
    // "came from Drive" and nothing else.
    "lastSyncedAt is not a key",
    !columns.includes("lastSyncedAt"),
    columns,
);
for (const column of NULLABLE) {
    if (!columns.includes(column)) continue;
    const key = keys().find((entry) => entry.column === column);
    check(`${column} states where its nulls go`, key?.nulls === "last", key);
}

console.log("\nthe order it produces");

const CURRENT_MINUTES: QueueRow = {
    id: "d-current-minutes",
    sessionNumber: 114,
    datedAt: day("2026-09-08"),
    driveModifiedTime: day("2026-09-09"),
    lastSyncedAt: day("2026-09-12"),
    createdAt: day("2026-09-09"),
};

const CURRENT_ROSTER: QueueRow = {
    // A living file states no date of its own; what it has is a recent edit.
    id: "d-current-roster",
    sessionNumber: 114,
    datedAt: null,
    driveModifiedTime: day("2026-09-11"),
    lastSyncedAt: day("2026-09-12"),
    createdAt: day("2026-09-08"),
};

const CURRENT_ARTICLE: QueueRow = {
    id: "a-current",
    sessionNumber: 114,
    datedAt: day("2026-09-10"),
    driveModifiedTime: null,
    lastSyncedAt: null,
    createdAt: day("2026-09-12"),
};

const BACKFILLED_ARTICLE: QueueRow = {
    // Read out of the 2001 archive tonight: old material, new row.
    id: "a-backfilled",
    sessionNumber: 89,
    datedAt: day("2001-09-05"),
    driveModifiedTime: null,
    lastSyncedAt: null,
    createdAt: day("2026-09-12"),
};

const LAST_SESSION_BILL: QueueRow = {
    id: "d-last-session",
    sessionNumber: 113,
    datedAt: day("2026-04-07"),
    driveModifiedTime: day("2026-04-08"),
    lastSyncedAt: day("2026-09-12"),
    createdAt: day("2026-09-08"),
};

const UNPLACED: QueueRow = {
    // Nothing current fails to name a session, so this is archive by default.
    id: "d-unplaced",
    sessionNumber: null,
    datedAt: day("2026-09-11"),
    driveModifiedTime: day("2026-09-11"),
    lastSyncedAt: day("2026-09-12"),
    createdAt: day("2026-09-12"),
};

const FIXTURES = [
    BACKFILLED_ARTICLE,
    UNPLACED,
    CURRENT_ROSTER,
    LAST_SESSION_BILL,
    CURRENT_ARTICLE,
    CURRENT_MINUTES,
];

const queue = [...FIXTURES].sort(compare).map((row) => row.id);

check(
    "the whole current session comes before every earlier one",
    queue.indexOf("d-current-roster") < queue.indexOf("d-last-session"),
    queue,
);
check(
    // The starvation this order exists to prevent: the row is new, the story
    // is from 2001, and it must not be read as fresh material on either count.
    "an article backfilled tonight waits behind every current-session document",
    queue.indexOf("a-backfilled") > Math.max(
        queue.indexOf("d-current-minutes"),
        queue.indexOf("d-current-roster"),
    ),
    queue,
);
check(
    "a document that names no session sorts as archive",
    queue.indexOf("d-unplaced") > queue.indexOf("d-current-roster"),
    queue,
);
check(
    // Not a concession: an article about this session's Senate is this
    // session's material, and it is dated later than the minutes.
    "within the current session the newer date leads",
    queue.indexOf("a-current") < queue.indexOf("d-current-minutes"),
    queue,
);
check(
    "a current document with no stated date still beats the previous session",
    queue.indexOf("d-current-roster") < queue.indexOf("d-last-session"),
    queue,
);

const reversed = [...FIXTURES].reverse().sort(compare).map((row) => row.id);
check("the order does not depend on the order rows arrive in", reversed.join() === queue.join(), [queue, reversed]);

const twins: QueueRow[] = [
    { ...CURRENT_MINUTES, id: "d-twin-b" },
    { ...CURRENT_MINUTES, id: "d-twin-a" },
];
check(
    // Two documents can agree on every date the archive holds. Without a
    // unique key they tie, and a budget over an untied order can pass the same
    // document by on every run.
    "documents identical on every date are still ordered",
    compare(twins[0], twins[1]) > 0 && compare(twins[1], twins[0]) < 0,
);
check(
    "no two distinct documents tie",
    FIXTURES.every((left) => FIXTURES.every((right) => (left.id === right.id) === (compare(left, right) === 0))),
);

console.log(failures === 0 ? "\nall checks passed" : `\n${failures} failure(s)`);
process.exitCode = failures === 0 ? 0 : 1;
