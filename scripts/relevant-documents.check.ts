import assert from "node:assert/strict";
import { meetingForDocument } from "@/lib/meetings";
import { relevantDocuments, uniqueUnresolvedLinks } from "@/lib/relevant-documents";
import { agendaItems, agendaMappingHash, validateAgendaMatches } from "@/lib/agenda-mapping";
import { extractDocumentLinks } from "@/lib/links";

// September 29, 2026 example: dated minutes and a numbered copied agenda.
const agenda = `Senate General Body Meeting #6
September 29th, 2026 | 07:00 PM EST | BSC 404
AGENDA

1. **Reports**
2. **Non-Legislative Business**
   1. **Closed Session - Forming questions**
3. **First Reading**
4. **Second Reading**
   1. **[Tabling supplies funding bill](https://docs.google.com/document/d/1Dcdd7i2NdT4OeFOtE-WnEco3dPEzedgjCKDs4OUFcY4/edit)** - Student Services Chair Veda Kommineni
   2. **[JHU SGA Freedom of Expression Directive (Resolution)](https://docs.google.com/document/d/1hYBzAJAblKUruIN_bfDN9Oyh4WK1IP5kCShe66Lh0Mo/edit)** - Vice President of the Senate Shreemann Patel
   3. **[RSO Outreach Call to Action Funding Bill](https://docs.google.com/document/d/14ojx9uQgs5eL7F6yJUyI1sgSKa8613Mbsu6vHPNTxAs/edit)** - Finance Chair Peter Tarpley
5. **Closing and Adjournment**`;
const minutes = `jazz: nothing for first reading
veda: my bill, passed finance with positive recommendation
shreemann: in Civic Engagement Committee it passed with positive recommendation earlier today
peter: this is a funding bill to fund outreach opportunity; been discussed previously`;
const base = { sessionNumber: 114, kind: "minutes.senate", folderPath: "Minutes", datedAt: new Date("2026-09-29T00:00:00Z"), driveCreatedTime: new Date("2026-09-30T00:00:00Z") };
const minuteIdentity = meetingForDocument({ ...base, title: "Demarri's Senate GBM Minutes - 9/29", content: minutes });
const agendaIdentity = meetingForDocument({ ...base, title: "Copy of SGA GBM Agenda #6", content: agenda });
assert.equal(minuteIdentity.role, "minutes");
assert.equal(agendaIdentity.role, "agenda");
assert.equal(minuteIdentity.key, agendaIdentity.key);
assert.notEqual(minuteIdentity.key, meetingForDocument({ ...base, sessionNumber: 113, title: "Copy of SGA GBM Agenda #6", content: agenda }).key);
assert.notEqual(minuteIdentity.key, meetingForDocument({ ...base, title: "Executive Meeting Minutes 9/29", content: minutes }).key);
assert.equal(meetingForDocument({ ...base, title: "Copy of SGA GBM Agenda #6", content: "AGENDA" }).key, "");
assert.equal(meetingForDocument({ ...base, title: "Senate GBM Minutes 9/28/2026", content: minutes }).key, "");
assert.equal(extractDocumentLinks(agenda).length, 3);
assert.equal(extractDocumentLinks(minutes).length, 0); // Mentioning a bill is not linking it.

const doc = (id: string) => ({ id, title: id, kind: "bill.funding" as const, sessionNumber: 114 });
const combined = relevantDocuments([doc("a"), doc("b"), doc("a")], [doc("b"), doc("c"), doc("agenda")], ["agenda"]);
assert.deepEqual(combined.documents.map(row => row.id), ["a", "b", "c"]);
assert.deepEqual(combined.sources.b, ["Agenda", "Minutes"]);
const url = "https://docs.google.com/document/d/1Dcdd7i2NdT4OeFOtE-WnEco3dPEzedgjCKDs4OUFcY4/edit";
assert.equal(uniqueUnresolvedLinks([{url, text:"bill", source:"drive"}, {url:url+"?usp=sharing",text:"same bill",source:"drive"}]).length, 1);

const items = agendaItems(agenda);
const firstReading = items.find(row => row.title === "First Reading")!;
const tabling = items.find(row => row.title.includes("Tabling supplies"))!;
assert.ok(firstReading && tabling);
const result = validateAgendaMatches({ matches: [
    { sectionId: tabling.id, quote: "veda: my bill, passed finance with positive recommendation" },
    { sectionId: firstReading.id, quote: "jazz: nothing for first reading" },
    { sectionId: "section-invented", quote: "jazz: nothing for first reading" },
    { sectionId: firstReading.id, quote: "This fabricated passage does not occur in these minutes." },
    { sectionId: firstReading.id, quote: "jazz: nothing for first reading" },
] }, minutes, agenda, "agenda");
assert.equal(result.length, 2);
assert.equal(result[0].title, "First Reading");
assert.ok(result[0].minutesHref.startsWith("#:~:text="));
assert.equal(validateAgendaMatches({ matches: [{ sectionId: firstReading.id, quote: "jazz: nothing for first reading" }] }, minutes + "\njazz: nothing for first reading", agenda, "agenda").length, 0);
assert.notEqual(agendaMappingHash(minutes, agenda), agendaMappingHash(minutes + " changed", agenda));
assert.notEqual(agendaMappingHash(minutes, agenda), agendaMappingHash(minutes, agenda + " changed"));
console.log("All relevant-document and agenda-mapping checks passed.");
