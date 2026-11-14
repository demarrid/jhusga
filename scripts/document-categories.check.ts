import assert from "node:assert/strict";
import { documentCategory, documentCategoryFilter, documentKindLabel, isDocumentCategory } from "../lib/kinds";

for (const body of ["senate", "executive", "committee", "judicial"]) {
    const kind = `minutes.${body}`;
    const agenda = `agenda.${body}`;
    assert.ok(isDocumentCategory(agenda));
    assert.equal(documentCategory(kind, "agenda"), agenda);
    assert.equal(documentCategory(kind, "minutes"), kind);
    assert.equal(documentCategory(kind, ""), kind);
    assert.deepEqual(documentCategoryFilter(agenda), { kind, meetingRole: "agenda" });
    assert.deepEqual(documentCategoryFilter(kind), { kind, NOT: { meetingRole: "agenda" } });
    assert.ok(documentKindLabel(kind, "agenda").startsWith("Agenda / "));
    assert.ok(documentKindLabel(kind, "minutes").startsWith("Minutes / "));
}
assert.equal(documentCategory("bill.funding", "agenda"), "bill.funding");
assert.deepEqual(documentCategoryFilter("bill.funding"), { kind: "bill.funding" });
assert.deepEqual(documentCategoryFilter("agenda.invalid"), {});
console.log("Document category checks passed");
