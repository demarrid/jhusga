import assert from "node:assert/strict";
import { meetingForDocument } from "@/lib/meetings";
import { relevantDocuments, uniqueUnresolvedLinks } from "@/lib/relevant-documents";
import { agendaItems, agendaMappingHash, agendaSectionLinks, validateAgendaMatches } from "@/lib/agenda-mapping";
import { extractDocumentLinks } from "@/lib/links";
import { meetingOutline } from "@/lib/meeting-outline";

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
assert.equal(items.find(row => row.title === "Second Reading")?.children[0].id, tabling.id);
const separatedLinks = `1. **Second Reading**\n   1. **Fall retreat funding bill**\n      [Fall retreat funding bill](${url})\n   2. **SAAC funding bill**\n      [SAAC funding bill](https://docs.google.com/document/d/abcdefghijklmnop1234/edit)\n2. **Adjournment**`;
const separatedItems = agendaItems(separatedLinks);
const retreat = separatedItems.find(row => row.title === "Fall retreat funding bill")!;
assert.deepEqual(agendaSectionLinks(separatedLinks, retreat.id).map(link => link.url), [url]);
assert.equal(agendaSectionLinks(separatedLinks, "section-missing").length, 0);
assert.equal(separatedItems.find(row => row.title === "Second Reading")?.children.length, 2);
const directOutline = meetingOutline([
    { id: "section-0", title: "Fall retreat funding bill - Chair of Programming Grace Guan", children: [] },
    { id: "section-90", title: "SAAC funding bill", children: [] },
], [], [{ ...doc("retreat"), title: "Fall retreat funding bill" }]);
assert.equal(directOutline.length, 2);
assert.equal(directOutline[0].documentLinks?.[0].href, "/documents/retreat");
const unresolvedOutline = meetingOutline([], [{ agendaId: "a", sectionId: retreat.id, title: retreat.title,
    quote: "a sufficiently long passage", startOffset: 0, minutesHref: "#minutes-0", linkedUrls: [url] }], [], [{ url, text: "Fall retreat funding bill", source: "drive" }]);
assert.equal(unresolvedOutline.length, 1);
assert.equal(unresolvedOutline[0].documentLinks?.[0].href, url);
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

const authored = [{ id: "section-0", title: "First Reading", children: [] }, { id: "section-30", title: "Second Reading", children: [] }];
const enriched = result.map(match => ({ ...match, linkedDocumentIds: match.title === "First Reading" ? [] : ["a"] }));
const outline = meetingOutline(authored, enriched, [doc("a"), doc("unmatched")]);
assert.equal(outline[0].href, result[0].minutesHref);
assert.equal(outline[1].children[0].documentLinks?.[0].href, "/documents/a");
assert.equal(outline[1].children[0].href, result[1].minutesHref);
assert.equal(outline.at(-1)?.documentLinks?.[0].href, "/documents/unmatched");
assert.equal(authored[1].children.length, 0);
const agendaOnly = meetingOutline([], enriched, [doc("a")]);
assert.equal(agendaOnly.length, 2);
assert.equal(agendaOnly[0].title, "First Reading");
assert.equal(agendaOnly[1].title, "Second Reading");
assert.equal(agendaOnly[1].children[0].documentLinks?.[0].href, "/documents/a");

const reportsAgenda = "1. ## Reports\n   1. Cabinet Reports:\n      1. Student Body President: Jason Yu\n      2. Student Body Vice President: Sumire Sumi\n   2. Advisor Report:\n2. ## Closing and Adjournment";
const reportsMinutes = "jason: nothing major; had some meetings with departments\nsumi: today met with Public Safety and OIS this morning";
const reportItems = agendaItems(reportsAgenda);
const reportsMatches = validateAgendaMatches({ matches: [
    { sectionId: reportItems.find(row => row.title.includes("Jason Yu"))!.id, quote: "jason: nothing major; had some meetings with departments" },
    { sectionId: reportItems.find(row => row.title.includes("Sumire Sumi"))!.id, quote: "sumi: today met with Public Safety and OIS this morning" },
] }, reportsMinutes, reportsAgenda, "reports-agenda");
const reportsOutline = meetingOutline([], reportsMatches, []);
assert.equal(reportsOutline.length, 1);
assert.equal(reportsOutline[0].title, "Reports");
assert.equal(reportsOutline[0].children[0].title, "Cabinet Reports");
assert.equal(reportsOutline[0].children[0].children.length, 2);
assert.equal(reportsOutline[0].children[0].children[0].title, "Student Body President: Jason Yu");
assert.equal(reportsOutline[0].href, reportsMatches[0].minutesHref);
assert.equal(reportsOutline[0].children[0].href, reportsMatches[0].minutesHref);
assert.ok(!JSON.stringify(reportsOutline).includes("Advisor Report"));
console.log("Merged meeting outline checks passed.");

