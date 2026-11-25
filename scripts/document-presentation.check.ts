import { indexSections } from "../lib/outline";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { presentBill } from "../lib/bill-presentation";
import { renderDocument, runsText, blockSectionIds, type Block, type InlineRun } from "../lib/render";
import { canonicalTitle } from "../lib/titles";
import { extractContributors } from "../lib/contributors";
import { maskImagePayloads, sanitizeExport, toPlainText } from "../lib/markdown";

// Excerpts from the reported archive documents, preserving their export shapes.
const freedom = "**Senate**\n**of the**\n**Student Government Association**\n**of**\n**The Johns Hopkins University**\n\n**{ *S. Resolution. S-B.114.09.22.26-2* }**\n\n**A Resolution Expressing the SGA\u2019s Full-bodied Commitment to Free Expression**\n\n**JHU SGA Freedom Of Expression Directive**\n\nIntroduced by: **Vice President of the Senate and Chair of Internal Affairs Shreemann Patel**\nSponsored by: **President of the Senate Jazzlyn Fernandez** and **Disability Caucus Senator and Chair of Civic Engagement Jackson Morris**\nPresented for consideration by the SGA this **22nd** day of **September** in the year **2026**\n\n**SECTION 1\\. TITLE.**\nThis Resolution may be referred to as the \u201cJHU SGA Freedom of Expression Directive\u201d\n\n";
const ai = "Senate\nof the\nStudent Government Association\nof\nThe Johns Hopkins University\n{ S. Resolution. 26-27 }\nA Resolution To Declare the Formal Opinion of the SGA\nEquitable Access to AI Tools\nIntroduced by: Senator Isaac Zhang, Chair of Academic Affairs\nSponsored by: Shreemann Patel and Veda Kommineni\nPresented for consideration by the SGA this 27th day of October in the year 2026\nSECTION 1. TITLE.\nThis Resolution may be referred to as the \u201cEquitable AI Access Resolution.\u201d\n";
const clerpa = "**Senate**\n**of the**\n**Student Government Association**\n**of**\n**The Johns Hopkins University**\n\n**{ *S. Bill. 26-27.01.09-4* }**\n\n**A Bill to Amend The Bylaws of the Senate**\n\n**The Clarifying Legislative Roles and Processes Act (CLeRPA)**\n\nIntroduced by: **Vice President of the Senate and Chair of Internal Affairs Shreemann Patel**\nSponsored by: **President of the Senate Jazzlyn Fernandez** and\n           **Student Body Vice President Sumire Sumi**\nPresented for First Reading this **First** day of **September** in the year **2026**\n\n**SECTION 1\\. TITLE.**\nThis Act may be referred to as the Clarifying Legislative Roles and Processes Act, or CLeRPA\n\n";
const slides = "JHU Ceramics x \u000bEmpty Bowls Initiative\nIntroducer: RSO Senator Andrei Espelien (Visual & Performing Arts)\nSponsors: SGA Treasurer Amy Xu\u000bSponsors: Finance Committee Co-Chair Peter Tarpley\n\n";
const finance = "SGA Finance Committee Meeting Minutes\nDate: Tuesday, November 3\nrd\n, 2026, 5:45-6:45pm\nLocation: Shriver Board Room\nPresent Absent\nAmy Xu\nPeter Tarpley\nLuke Holmes\nOluwanifemi Ajayi\nMamadou Thiam\nAndrew Gao\nOmotola Alaofin\nAarshi Lamichhane\nSrika Popuri\nKai Martin\nKevin Wu\nExcused\nRoyce Willis\nUnexcused\nAgenda Items\n1. Claw backs";
const academic = "AA Meeting Minutes \u201310/31/2026\n\nPresent:  Issac, Tola, Demarri, Rocio, Saavani, Grace, Peter, Rocio, Ella, Noah, Kevin Tse, Heidi, Boyi\n\nExcused: Arjun\n\n";

for (const content of [freedom, ai]) {
    const result = presentBill(renderDocument(content, []));
    assert.equal(result.header.filter(line => line.kind === "number").length, 1);
    assert.equal(result.header.filter(line => line.kind === "title").length, 1);
    assert.equal(result.header.filter(line => line.kind === "credit").length, 2);
    assert.equal(result.header.filter(line => line.kind === "reading").length, 1);
    assert.equal(result.blocks[0]?.kind, "heading");
}
assert.equal(canonicalTitle({ id: "ai", title: "SGA Resolution - Equitable Access to AI Tools revised.docx", content: ai, kind: "resolution", sessionNumber: 114, folderPath: "" }), "Equitable Access to AI Tools");
assert.equal(canonicalTitle({ id: "minutes", title: "Notes", content: ai, kind: "minutes.committee", sessionNumber: 114, folderPath: "" }), null);
const header = presentBill(renderDocument(clerpa, [])).header;
for (const name of ["Jazzlyn Fernandez", "Sumire Sumi"]) {
    assert.equal(header.find(line => runsText(line.runs).includes(name))?.kind, "credit");
}
const people = extractContributors(slides, "Ceramics", "presentation");
assert(people.some(person => person.name === "Andrei Espelien" && person.role === "introducer"));
assert.equal(people.filter(person => person.role === "sponsor").length, 2);
const attendance = extractContributors(finance, "Finance Committee Minutes", "minutes.committee");
assert.equal(attendance.filter(person => person.role === "mentioned").length, 11);
assert(!attendance.some(person => person.role === "present" || person.role === "absent"));
assert(attendance.some(person => person.name === "Royce Willis" && person.role === "excused"));
assert.equal(extractContributors(academic, "AA Minutes", "minutes.committee").filter(person => person.role === "present").length, 12);
assert(!extractContributors("Looking forward: Deans and committee can look for solutions.", "AA Minutes", "minutes.committee").some(person => person.name === "Looking Forward"));
const payload = "Before\n\n: <data:image/png;base64,AAAA\nBBBB> \"Chart\"\n\nAfter";
assert.equal(sanitizeExport(payload), "Before\n\nAfter");
assert.equal(toPlainText(payload), "Before After");
assert.equal(sanitizeExport(sanitizeExport(payload)), sanitizeExport(payload));
assert.equal(maskImagePayloads(payload).length, payload.length);
const rendered = renderDocument(payload, [{id: "after", startOffset: payload.indexOf("After"), endOffset: payload.length}]);
assert(!JSON.stringify(rendered).includes("data:image"));
const after = rendered.find(block => block.kind === "paragraph" && runsText(block.runs) === "After");
assert(after && "runs" in after && after.runs.some(run => run.annotationId === "after" && run.anchor));
console.log("Reported document regressions passed");


// A PDF funding bill contains page furniture, hard wraps, and a flattened table.
const pdf = readFileSync(new URL("./fixtures/bootacular-pdf.txt", import.meta.url), "utf8");
const quotes = ["branded tote", "bag featuring a cute design", "$0.21/piece", "Quantity Total ($)"];
const pdfBlocks = renderDocument(pdf, quotes.map((quote, index) => ({ id: `pdf-${index}`, startOffset: pdf.indexOf(quote), endOffset: pdf.indexOf(quote) + quote.length })));
const pdfBill = presentBill(pdfBlocks);
const collect = (blocks: Block[]): InlineRun[] => blocks.flatMap(block => {
    if ("runs" in block) return block.runs;
    if (block.kind === "table") return [...(block.header ? [block.header] : []), ...block.rows].flatMap(row => row.cells.flat());
    return [];
});
const pdfRuns = [...pdfBill.header.flatMap(line => line.runs), ...collect(pdfBill.blocks)];
assert.equal(pdfBill.header.find(line => line.kind === "title")?.runs.map(run => run.text).join(""), "BOOTACULAR BALTIMORE FUNDING BILL");
assert(pdfBill.header.some(line => line.kind === "reading" && runsText(line.runs).includes("15TH DAY")));
assert(!runsText(pdfRuns).includes("PAGE 3"));
assert(!runsText(pdfRuns).includes("SGA-B.25-26"));
assert(pdfBill.blocks.some(block => block.kind === "paragraph" && runsText(block.runs).includes("branded tote bag featuring")));
assert.equal(pdfBill.blocks.filter(block => block.kind === "heading").length, 6);
const budget = pdfBill.blocks.find(block => block.kind === "table");
assert(budget?.kind === "table");
assert.equal(budget.rows.length, 20);
assert(budget.rows.some(row => runsText(row.cells[0]).trim() === "Small Assorted Candies" && runsText(row.cells[4]) === "$95.00"));
assert.equal(pdfBill.blocks.filter(block => block.kind === "paragraph" && runsText(block.runs).startsWith("__________________________________")).length, 10);
for (let index = 0; index < quotes.length; index++) {
    assert.equal(pdfRuns.filter(run => run.annotationId === `pdf-${index}` && run.anchor).length, 1);
}
for (const block of pdfBlocks) {
    if ("sectionId" in block && block.sectionId) assert.equal(pdfRuns.filter(run => run.navigationId === block.sectionId).length, 1);
}
assert.deepEqual(presentBill(pdfBlocks), pdfBill, "presentation is deterministic and does not mutate parsed blocks");
console.log("PDF bill wrapping, budget, signatures, citations and outline checks passed");

// A slide PDF uses physical line wraps; complete questions must be headings,
// and every section link must have one real destination.
const programming = readFileSync(new URL('./fixtures/programming-presentation.txt', import.meta.url), 'utf8');
const slideQuote = 'autonomy within LEED?';
const slideBlocks = renderDocument(programming, [{ id: 'slide-question', startOffset: programming.indexOf(slideQuote), endOffset: programming.indexOf(slideQuote) + slideQuote.length }]);
const slideHeadings = slideBlocks.filter(block => block.kind === 'heading');
assert.equal(slideHeadings.length, 14);
assert(slideHeadings.some(block => runsText(block.runs) === '1. How can Programming ensure sufficient autonomy within LEED? (i.e. prevent bullying)'));
assert(slideHeadings.some(block => runsText(block.runs) === 'Examples of Class Programming events totally separate from the HOP and SGA'));
assert(slideBlocks.some(block => block.kind === 'list' && block.items.some(item => runsText(item.runs) === 'Battle of the Classes')));
assert(slideBlocks.some(block => block.kind === 'paragraph' && runsText(block.runs).includes('LEED has strong control over class programming decisions')));
assert.equal(collect(slideBlocks).filter(run => run.annotationId === 'slide-question' && run.anchor).length, 1);
assert(collect(slideBlocks).every(run => !run.text.includes('\n')));

// Source paragraph boundaries take precedence over the speaker heuristic.
const minutesCell = '| Discussion<br>We discussed the role of Chair: a leadership position.<br>Cole: next topic | All Present |\n| --- | --- |';
const minutesBlocks = renderDocument(minutesCell, []);
const minutesLayout = minutesBlocks.find(block => block.kind === 'layout');
assert(minutesLayout?.kind === 'layout');
assert.equal(runsText(minutesLayout.rows[0].cells[0]), 'Discussion\nWe discussed the role of Chair: a leadership position.\nCole: next topic');
console.log('Slide headings, soft wraps, citations and source paragraph breaks passed');

const slideOutline = indexSections(programming).sections;
const slideAnchors = blockSectionIds(slideBlocks);
assert(slideOutline.every(section => slideAnchors.has(section.id) && section.children.length === 0));
assert(slideOutline.some(section => section.title === 'LEED’s Proposal (continued)'));
assert(!slideOutline.some(section => section.title.includes('Thank you')));


// OIE resolution (bec0b5d6): separate sponsor paragraphs, then Whereas clauses.
const oie = "Senate\n\nof the\n\nStudent Government Association\n\nof\n\nThe Johns Hopkins University\n\n{ S. Resolution 18-19, 05 }\n\nA Resolution Calling for Johns Hopkins to Reform the Office of Institutional Equity\n\nIntroduced By: Senator Miranda Bannister of the Junior Class and Senator Madelynn Wellons of the Junior Class and considered this 4th day of December in the Year 2018\n\nSponsored By: Senator Jennifer Baron of the Senior Class\n\nSenator Kiana Boroumand of the Junior Class\n\nSenator Fatima Bouftas of the Senior Class\n\nPresident Dean Chien of the Junior Class\n\nSenator Pavan Patel of the Junior Class\n\nSenator Mohamed T. El Gendi of the Junior Class\n\nVice President AJ Tsang of the Executive Board\n\nSecretary Aspen Williams of the Executive Board\n\nPresident Noh Mebrahtu of the Executive Board\n\nSenator Ash Panakam of the Senior Class\n\nSenator Nathan Mudrak of the Freshman Class\n\nPresident Sam Schatmeyer of the Sophomore Class\n\nSenator Alex Forlenza of the Freshman Class\n\nSenator Pritika Parmar of the Freshman Class\n\nSenator Mehak Ali of the Freshman Class\n\nSenator Omar Lloyd of the Junior Class\n\nSenator akshay Bhamidipati of the Senior Class\n\nReferred to the senate by WAIVED which recommends its N/A by a vote of N/A to N/A.\n\nWhereas Section II of the Johns Hopkins Undergraduate Student Government Association\u2019s Constitution states, \u201cThe purpose of the SGA is to protect and improve the rights, opportunities, and quality of life for every undergraduate student at the Johns Hopkins University;\u201d\n\nWhereas this resolution refers to the Office of Institutional Equity\u2019s Annual Report of 2017,";
const oieTitle = "A Resolution Calling for Johns Hopkins to Reform the Office of Institutional Equity";
for (const content of [oie, oie.replaceAll("\n\n", "\n")]) {
    const startOffset = content.indexOf(oieTitle);
    const parsed = renderDocument(content, [{
        id: "5c0fa843-05cf-463f-b854-e562927da573",
        startOffset, endOffset: startOffset + oieTitle.length,
    }]);
    const result = presentBill(parsed);
    assert(result.header.some(line => line.kind === "purpose" && runsText(line.runs).trim() === oieTitle));
    assert(result.header.some(line => line.kind === "credit" && runsText(line.runs).includes("akshay Bhamidipati")));
    assert(result.header.some(line => line.kind === "reading" && runsText(line.runs).includes("Referred to the senate")));
    assert(!result.header.some(line => /Whereas/.test(runsText(line.runs))));
    assert(result.blocks[0]?.kind === "paragraph" && runsText(result.blocks[0].runs).trimStart().startsWith("Whereas"));
    assert.equal(result.header.flatMap(line => line.runs).filter(run => run.anchor && run.annotationId === "5c0fa843-05cf-463f-b854-e562927da573").length, 1);
    assert.deepEqual(presentBill(parsed), result);
}
assert.equal(presentBill(renderDocument(oie.slice(0, oie.indexOf("Whereas")), [])).header.length, 0);

// Real archive exports cover custom captions, enacting clauses, empty tables,
// decorative rules, numbered provisions, and PDF-flattened title pages.
const olderBills: { id: string; title: string; content: string }[] = JSON.parse(
    readFileSync(new URL("./fixtures/bill-formatting.json", import.meta.url), "utf8"),
);
function sourceRunText(value: unknown): string {
    if (Array.isArray(value)) return value.map(sourceRunText).join("");
    if (!value || typeof value !== "object") return "";
    if ("text" in value && typeof value.text === "string") return value.text;
    return Object.values(value).map(sourceRunText).join("");
}
for (const fixture of olderBills) {
    const startOffset = fixture.content.indexOf("Introduced By:");
    assert(startOffset >= 0, fixture.title);
    const annotationId = "0ec158b9-d25e-4813-a2f0-f2fddc6a6613";
    const parsed = renderDocument(fixture.content, [{
        id: annotationId, startOffset, endOffset: startOffset + 50,
    }]);
    const result = presentBill(parsed);
    assert(result.header.some(line => line.kind === "number"), fixture.title);
    assert(result.header.some(line => line.kind === "credit"), fixture.title);
    assert(!result.header.some(line => /Be it enacted|Whereas/i.test(runsText(line.runs))), fixture.title);
    assert.equal(result.header.flatMap(line => line.runs).filter(run =>
        run.annotationId === annotationId && run.anchor).length, 1, fixture.title);
    assert.equal(sourceRunText(result).replace(/\s/g, ""),
        sourceRunText(parsed).replace(/\s/g, ""), fixture.title + ": retain source text");
    assert.deepEqual(presentBill(parsed), result, fixture.title + ": no mutation");
}
console.log("Older bill formats, source text, and annotation anchors passed");
