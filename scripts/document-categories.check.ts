import { documentMeetingRole } from "../lib/meetings";
import reviewed from "../config/archive-reviewed-categories.json";
import assert from "node:assert/strict";
import { classifyDocument, isDocumentKind, documentCategory, documentCategoryFilter, documentKindLabel, isDocumentCategory } from "../lib/kinds";

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

// Forms must win over incidental references in their text.
const classify = (name: string, content = "", folderPath = "", mimeType?: string) =>
    classifyDocument({ name, content, folderPath, mimeType });
assert.equal(classify("Executive #10", "", "04_Executive Branch/Minutes for Executive Meeting"), "minutes.executive");
assert.equal(classify("Event", "A Bill to Amend The Procedural Rules of the Senate\nDefinitions: Constitution and Bylaws"), "bill.senate_rules");
assert.equal(classify("Event", "An SGA Event Funding Bill\nAct to Fund a campus event\nPursuant to the constitution, amend allocations"), "bill.funding");
assert.equal(classify("Senate Meeting Minutes", "Attendance\nA Bill to fund a party was discussed."), "minutes.senate");
assert.equal(classify("Junior Formal Budget"), "finance.record");
assert.equal(classify("SS Survey Tabling Sign Up"), "schedule");
assert.equal(classify("Report of Findings"), "report");
assert.equal(classify("Bylaws (Personal Rewrite)"), "working.document");
assert.equal(classify("SGA Meeting Presentation", "", "", "application/vnd.google-apps.presentation"), "presentation");
assert.equal(classify("Untitled document"), "unknown");
assert.equal(classify("Resume 2026"), "resume");
assert.equal(classify("Meeting with the Dean"), "notes.meeting");

assert.equal(documentMeetingRole({kind: "minutes.other",title: "CSAC Agenda",folderPath: ""}), "agenda");
assert.equal(documentMeetingRole({kind: "minutes.class_council",title: "SoCC Meeting #5 Agenda",folderPath: "Class of 2018"}), "agenda");
for (const [driveFileId, record] of Object.entries(reviewed)) {
    assert.ok(isDocumentKind(record.kind), `${driveFileId}: valid reviewed kind`);
    assert.ok(record.evidence.length > 20);
    assert.equal(classifyDocument({name: record.title,folderPath: "",driveFileId}),record.kind);
}

console.log("Document category checks passed");

assert.equal(documentMeetingRole({kind: "minutes.executive", title: "Lunch Agenda", folderPath: "Agendas", content: "Omotara and Tyler expressed their concern.\nPresident Daniels noted the issue.\nSrigouri proposed more options."}), "minutes");
assert.equal(documentMeetingRole({kind: "minutes.executive", title: "Lunch Agenda", folderPath: "Agendas", content: "Date: Tuesday\nTime: 11:00\nLocation: BSC\nPresident Daniels will discuss funding."}), "agenda");
