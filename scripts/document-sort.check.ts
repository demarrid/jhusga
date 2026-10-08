import {
    compareDocuments,
    pageOf,
    parseDocumentSort,
    type SortableDocument,
} from "../lib/document-sort";

let failures = 0;
function check(label: string, condition: boolean, detail?: unknown) {
    if (condition) {
        console.log(`  ok   ${label}`);
    } else {
        failures += 1;
        console.log(`  FAIL ${label}`, detail ?? "");
    }
}

function doc(
    id: string,
    dates: { dated?: string; created?: string; modified?: string } = {},
    extra: Partial<SortableDocument> = {},
): SortableDocument {
    return {
        id,
        title: extra.title ?? id,
        findRank: extra.findRank ?? 0,
        datedAt: dates.dated ? new Date(dates.dated) : null,
        driveCreatedTime: dates.created ? new Date(dates.created) : null,
        driveModifiedTime: dates.modified ? new Date(dates.modified) : null,
    };
}

const documents = [
    doc("minutes", { dated: "2026-09-01", created: "2026-09-02", modified: "2026-09-03" }),
    doc("bill", { dated: "2026-08-01", created: "2026-10-01", modified: "2026-08-02" }),
    doc("template", { created: "2026-07-01", modified: "2026-10-05" }),
    doc("orphan"),
];

const ids = (sort: "modified" | "dated" | "created") =>
    [...documents].sort((a, b) => compareDocuments(a, b, sort)).map((d) => d.id);

console.log("compareDocuments");

check("modified is newest Drive modification first", ids("modified").join() === "template,minutes,bill,orphan", ids("modified"));
check("dated puts documents with no date of their own last", ids("dated").join() === "minutes,bill,orphan,template", ids("dated"));
check("created is newest Drive creation first", ids("created").join() === "bill,minutes,template,orphan", ids("created"));

const ranked = [
    doc("old-title-match", { modified: "2020-01-01" }, { findRank: 10_000 }),
    doc("new-body-match", { modified: "2026-10-01" }),
];
check(
    "most relevant puts a title match above a newer body match",
    [...ranked].sort((a, b) => compareDocuments(a, b, "relevant"))[0]!.id === "old-title-match",
);
check(
    "a date order chosen over a query ignores relevance",
    [...ranked].sort((a, b) => compareDocuments(a, b, "modified"))[0]!.id === "new-body-match",
);
const tied = [
    doc("older", { modified: "2026-01-01" }, { findRank: 5 }),
    doc("newer", { modified: "2026-06-01" }, { findRank: 5 }),
];
check(
    "equally relevant documents are newest modified first",
    [...tied].sort((a, b) => compareDocuments(a, b, "relevant"))[0]!.id === "newer",
);

const twins = [doc("b", {}, { title: "Same" }), doc("a", {}, { title: "Same" })];
check(
    "identical documents fall back to id, so the order is total",
    [...twins].sort((a, b) => compareDocuments(a, b, "dated")).map((d) => d.id).join() === "a,b",
);

console.log("pageOf");

const list = Array.from({ length: 7 }, (_, index) => ({ id: `d${index}` }));

const first = pageOf(list, null, 3);
check("first page starts at the top", first.items.map((d) => d.id).join() === "d0,d1,d2", first);
check("first page points after its last item", first.next?.after === "d2" && first.next.offset === 3, first.next);

const second = pageOf(list, first.next, 3);
check("next page continues after the cursor", second.items.map((d) => d.id).join() === "d3,d4,d5", second);

const last = pageOf(list, second.next, 3);
check("last page has no cursor", last.items.length === 1 && last.next === null, last);

const inserted = [{ id: "new" }, ...list];
const afterInsert = pageOf(inserted, first.next, 3);
check(
    "a document added above the cursor does not repeat one already shown",
    afterInsert.items.map((d) => d.id).join() === "d3,d4,d5",
    afterInsert,
);

const removed = list.filter((d) => d.id !== "d2");
const afterRemoval = pageOf(removed, first.next, 3);
check(
    "a cursor document that has gone does not cost the reader the one after it",
    afterRemoval.items.some((d) => d.id === "d3"),
    afterRemoval,
);

check("an unknown sort reads as Modified", parseDocumentSort("title", false) === "modified");
check("a known sort is kept", parseDocumentSort("dated", false) === "dated");
check("a query opens on Most relevant", parseDocumentSort(undefined, true) === "relevant");
check("a date sort chosen with a query is kept", parseDocumentSort("modified", true) === "modified");
check("Most relevant without a query reads as Modified", parseDocumentSort("relevant", false) === "modified");

if (failures > 0) {
    console.log(`\n${failures} failure(s)`);
    process.exit(1);
}
