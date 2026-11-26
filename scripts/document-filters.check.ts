/**
 * The documents page's list filters each take several values; see
 * lib/document-filters.
 */
import assert from "node:assert/strict";

import { demoDocuments } from "../lib/demo-data";
import { joinFilterValues, parseFilterValues } from "../lib/document-filters";

// One value reads as it always has, so existing links keep working.
assert.deepEqual(parseFilterValues("person-1"), ["person-1"]);
assert.deepEqual(parseFilterValues(undefined), []);
assert.deepEqual(parseFilterValues(""), []);
assert.deepEqual(parseFilterValues(" , "), []);

// Comma-separated and repeated parameters read alike, in order, without repeats.
assert.deepEqual(parseFilterValues("minutes.senate, bill.funding,minutes.senate"), ["minutes.senate", "bill.funding"]);
assert.deepEqual(parseFilterValues(["minutes.senate", "bill.funding,report"]), ["minutes.senate", "bill.funding", "report"]);
assert.deepEqual(parseFilterValues(joinFilterValues(["a", "b"])), ["a", "b"]);
assert.equal(joinFilterValues([]), "");

// Several types are alternatives.
const all = demoDocuments({ session: "all" });
const ofKind = (kind: string) => all.filter((document) => document.kind === kind).length;
assert.equal(
    demoDocuments({ session: "all", kind: ["minutes.senate", "bill.funding"] }).length,
    ofKind("minutes.senate") + ofKind("bill.funding"),
);
assert.equal(demoDocuments({ session: "all", kind: "minutes.senate,bill.funding" }).length, ofKind("minutes.senate") + ofKind("bill.funding"));

// Several capacities are alternatives too, and an empty list filters nothing.
const byRole = (role: string) => demoDocuments({ session: "all", role }).map((document) => document.id);
const either = demoDocuments({ session: "all", role: ["author", "sponsor"] }).map((document) => document.id);
assert.deepEqual(new Set(either), new Set([...byRole("author"), ...byRole("sponsor")]));
assert.equal(demoDocuments({ session: "all", role: [] }).length, all.length);

console.log("Document filter checks passed");
