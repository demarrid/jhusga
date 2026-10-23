import { weeklyMinutes } from "./weekly-minutes.fixture";
/**
 * The outline beside a document: what counts as a section, and that naming
 * one does not move the text a citation indexes.
 */

import { findQuote } from "../lib/anchor";
import { toPlainText } from "../lib/markdown";
import { blockSectionIds, renderDocument, runsText, type Block } from "../lib/render";
import { documentSections, sectionAnchors, type DocumentSection } from "../lib/outline";

let failures = 0;
function check(label: string, condition: boolean, detail?: unknown) {
    if (condition) {
        console.log(`  ok   ${label}`);
    } else {
        failures += 1;
        console.log(`  FAIL ${label}`, detail ?? "");
    }
}

function flat(sections: DocumentSection[], depth = 0): string[] {
    return sections.flatMap((section) => [
        `${"  ".repeat(depth)}${section.title}`,
        ...flat(section.children, depth + 1),
    ]);
}

function idsOf(sections: DocumentSection[]): string[] {
    return sections.flatMap((section) => [section.id, ...idsOf(section.children)]);
}

function words(blocks: Block[]): string[] {
    const text = (runs: { text: string }[]) => runs.map((run) => run.text).join("");
    const pieces = (list: Block[]): string[] =>
        list.flatMap((block) => {
            switch (block.kind) {
                case "heading":
                case "paragraph":
                    return [text(block.runs)];
                case "quote":
                    return pieces(block.blocks);
                case "list":
                    return block.items.flatMap((item) => [text(item.runs), ...pieces(item.blocks)]);
                case "table":
                    return [...(block.header ? [block.header] : []), ...block.rows].flatMap((row) =>
                        row.cells.map(text),
                    );
                case "layout":
                    return block.rows.flatMap((row) => row.cells.map(text));
                case "rule":
                    return [];
            }
        });
    return pieces(blocks).join(" ").match(/[A-Za-z0-9]+/g) ?? [];
}

console.log("agenda");

// The shape Drive actually exports: bold numbered headings, then plain
// numbered, roman, and lettered lines, with the rules Docs inserts between.
const agenda = [
    "**Senate General Body Meeting \\#8**",
    "*October 13th, 2026 | 07:00 PM EST | BSC 404*",
    "",
    "**AGENDA**",
    "---",
    "",
    "1.  **Call to Order & Roll Call**",
    "   ---",
    "",
    "1. Present:",
    "2. Absent:",
    "",
    "   i. Excused:",
    "",
    "   ii. Unexcused:",
    "",
    "2.  **Convening Business**",
    "   ---",
    "",
    "   a. Judiciary confirmation",
    "",
    "5.  **Reports**",
    "   ---",
    "",
    "1. Cabinet Reports:",
    "",
    "   i. Student Body President: Jason Yu",
    "",
    "   v. Chair of Programming: Grace Guan",
    "",
    "      - Bootacular Baltimore",
    "",
    "   vi. Director of Communications: Sienna Kim",
    "",
    "7.  **First Reading**",
    "   ---",
    "",
    "1. Establishing a Transfer Student Caucus - Vice President of the Senate Shreemann Patel",
    "2. Bylaws Amendment: Choosing the CSAC Representative - Senator Paul Woo",
    "",
    "8. **Second Reading**",
    "   ---",
    "",
    "   a. Survey Tabling Bill - Student Services Chair Veda Kommineni",
    "         b. SAAC Funding Bill - Senator Sophia Baleeiro",
    "",
    "11. **Closing and Adjournment**",
    "   ---",
    "",
    "SGA meetings are always slated to extend until 9:00 PM, however SGA members are expected to remain until official adjournment.",
].join("\n");

const agendaOutline = flat(documentSections(agenda));
check(
    "an agenda nests plain items under the bold heading, and roman lines under those",
    agendaOutline.join("\n") ===
        [
            "Call to Order & Roll Call",
            "Convening Business",
            "  Judiciary confirmation",
            "Reports",
            "  Cabinet Reports",
            "    Student Body President: Jason Yu",
            "    Chair of Programming: Grace Guan",
            "    Director of Communications: Sienna Kim",
            "First Reading",
            "  Establishing a Transfer Student Caucus - Vice President of the Senate Shreemann Patel",
            "  Bylaws Amendment: Choosing the CSAC Representative - Senator Paul Woo",
            "Second Reading",
            "  Survey Tabling Bill - Student Services Chair Veda Kommineni",
            "  SAAC Funding Bill - Senator Sophia Baleeiro",
            "Closing and Adjournment",
        ].join("\n"),
    agendaOutline,
);
check(
    "the meeting title, the word AGENDA, and the closing sentence are not sections",
    !agendaOutline.some((line) => /meeting|agenda|slated/i.test(line)),
    agendaOutline,
);

check(
    "the roll call's slots, and the names under them, are not sections",
    !agendaOutline.some((line) => /\b(present|absent|excused|unexcused)\b/i.test(line)) &&
        agendaOutline[0] === "Call to Order & Roll Call",
    agendaOutline,
);

const rollCall = [
    "1. **Call to Order and Attendance**",
    "   1. **Present:**",
    "      1. Ada Lovelace",
    "      2. Grace Hopper",
    "   2. Not Present",
    "      i. Excused: Alan Turing",
    "      ii. Tardy",
    "   3. Quorum",
    "2. **Late Business**",
    "   a. Members Present Bill",
    "3. **Public Input**",
].join("\n");
check(
    "every attendance label goes with what is under it, and the next item survives",
    flat(documentSections(rollCall)).join("\n") ===
        ["Call to Order and Attendance", "Late Business", "  Members Present Bill", "Public Input"].join("\n"),
    flat(documentSections(rollCall)),
);

const minutesRoll = [
    "# Senate Minutes",
    "",
    "**Attendance**",
    "",
    "**ABSENT (EXCUSED):**",
    "- **Stone Meng**",
    "",
    "**Members Present**",
    "",
    "**Absent Excused - Vishnu**",
    "",
    "**Absent Position Applications**",
    "",
    "**Reports**",
    "",
    "The President reported on the retreat.",
].join("\n");
check(
    "a bold roll call in minutes is dropped, and the heading it sits under stays",
    flat(documentSections(minutesRoll)).join("\n") ===
        ["Senate Minutes", "  Attendance", "  Absent Position Applications", "  Reports"].join("\n"),
    flat(documentSections(minutesRoll)),
);

console.log("\nconstitution");

const constitution = [
    "Constitution of the",
    "Student Government Association at the Johns Hopkins University",
    "",
    "**Table of Contents**",
    "",
    "* Preamble",
    "* Article I: Bill of Rights",
    "* Article II: Name, Authority, and Membership",
    "",
    "**Preamble**",
    "We, the Undergraduates of the Zanvyl Krieger School, hereby establish this Constitution.",
    "",
    "**Article I: Bill of Rights**",
    "All persons enrolled as undergraduates have equal rights as students under this Constitution.",
    "",
    "1. The SGA will not restrict membership and/or activity by reason of age, citizenship, or any other such ground.",
    "2. Students have a right to attend all meetings of the SGA, and all minutes shall be open.",
    "",
    "**Anti-Hazing/Discrimination Statement**",
    "",
    "*Non-Hazing Policy (Updated October 2024):*",
    "The Johns Hopkins University Student Government Association is committed to fostering a safe community.",
    "",
    "**Article II: Name, Authority, and Membership**",
    "*Section One: Name*",
    "The official governing body of the undergraduates shall be the Student Government Association.",
    "*Section Two: Purpose*",
    "The purpose of the SGA is to protect and improve the rights of students.",
    "",
    "3. Membership of the Judicial Branch is detailed in Article 2, Section 4: Membership",
].join("\n");

const constitutionOutline = flat(documentSections(constitution));
check(
    "articles and sections nest, and the table of contents is not repeated",
    constitutionOutline.join("\n") ===
        [
            "Table of Contents",
            "Preamble",
            "Article I: Bill of Rights",
            "Anti-Hazing/Discrimination Statement",
            "  Non-Hazing Policy (Updated October 2024)",
            "Article II: Name, Authority, and Membership",
            "  Section One: Name",
            "  Section Two: Purpose",
        ].join("\n"),
    constitutionOutline,
);
check(
    "a numbered sentence is a clause, not a section",
    !constitutionOutline.some((line) => /restrict membership|Judicial Branch/i.test(line)),
);
check(
    "the document title is not a section",
    !constitutionOutline.some((line) => /Constitution of the|Johns Hopkins University$/i.test(line.trim())),
);

const duties = [
    "**Article III: Executive Branch**",
    "*Section One: Structure*",
    "1. Student Body Vice President",
    "   1. Shall assist the President in all their duties.",
    "   2. Social media management.",
].join("\n");
check(
    "an office is a section and the duties under it are not",
    flat(documentSections(duties)).join("\n") ===
        [
            "Article III: Executive Branch",
            "  Section One: Structure",
            "    Student Body Vice President",
        ].join("\n"),
    flat(documentSections(duties)),
);

console.log("\nminutes");

const minutes = [
    "# Prose",
    "",
    "7:10 p.m. — Meeting called to order",
    "",
    "Jazz: Thank you so much for being here tonight, and for spending your Tuesday evening with us.",
    "",
    "Office of Institutional Equity",
    "",
    "Julie: Hi, everyone. I am Julie, the interim assistant vice provost.",
    "",
    "<Public Safety and JHPD>",
    "",
    "Hernandez: We will ask Public Safety to come up next.",
    "",
    "<Cabinet reports>",
    "",
    "Jason: First off, a round of applause.",
    "",
    "# Raw",
    "",
    "hernandez: good evening everyone..",
    "",
    "<script>",
    "",
    "jazz: ok, going to reports",
].join("\n");

const minutesOutline = flat(documentSections(minutes));
const transcriptAsides = "jazz: showing a video\n\n\\<hispanic heritage month video\\>\n\njazz: thanks\n\n\\<light laughter from room\\>\n\ncole: motion to adjourn";
check("transcript actions and reactions do not invent sections", documentSections(transcriptAsides).length === 0);
check("a lowercase meeting topic survives among transcript asides",
    flat(documentSections(minutes + "\n\n<cabinet reports>\n\njason: another update\n\n<light laughter from room>")).includes("  cabinet reports") &&
    !flat(documentSections(minutes + "\n\n<light laughter from room>")).some(title => title.includes("laughter")));
check(
    "a transcript's topic lines nest under its headings, and speeches do not",
    minutesOutline.join("\n") ===
        [
            "Prose",
            "  Meeting called to order",
            "  Office of Institutional Equity",
            "  Public Safety and JHPD",
            "  Cabinet reports",
            "Raw",
        ].join("\n"),
    minutesOutline,
);

const notesMinutes = [
    "# Committee on Student Life",
    "",
    "**Last Meeting Follow-up**",
    "",
    "- Srigouri: PHSF, Housing, ResLife",
    "- Make students more conscious about their consumption",
    "",
    "**New Business**",
    "",
    "Rachel, Omar, Zoe, Srigouri, Danial",
].join("\n");
check(
    "a plain bullet and a list of who came are not sections",
    flat(documentSections(notesMinutes)).join("\n") ===
        ["Committee on Student Life", "  Last Meeting Follow-up", "  New Business"].join("\n"),
    flat(documentSections(notesMinutes)),
);

const series = [
    "**Committee on Health, Safety, and Sustainability MEETING #1**",
    "**Last Meeting Follow-up**",
    "Nothing to follow up.",
    "**Committee on Health, Safety, and Sustainability MEETING #2**",
    "**Last Meeting Follow-up**",
    "The fair is booked.",
].join("\n");
check(
    "a file of several meetings keeps each meeting's title",
    flat(documentSections(series)).filter((line) => /MEETING #\d/.test(line)).length === 2,
    flat(documentSections(series)),
);

// The committee template: a dated banner and a room, the roll, then the
// agenda and the minutes written into a copy of it, padded with empty `##`.
const banner = ["# **10.11.2026**", "", "3:30 PM EDT | IA.114.06", "**BSC 201 \\- Barber Boardroom**", ""];
const business = [
    "## **CONVENING BUSINESS**", "##", "## ---", "", " **Call to Order / Start Time:**", "",
    "| Welcome | All Present |", "| :---- | ----: |", "",
    "## **CLOSING**", "##", "## ---", "", "| Closing | All Present |", "| :---- | ----: |", "",
];
const noted = business.map((line) =>
    line.startsWith("| Welcome") ? "| Welcome<br>Shreemann: the Newsletter published an article on the advisor | All Present |" : line,
);
const committee = [
    ...banner,
    "## **ATTENDANCE**", "##", "## ---", "",
    "**Committee Members**", "Quorum: 5 Members Present", "",
    "| Shreemann Patel, Chair | Present |", "| :---- | :---- |", "",
    "**Non-Committee Member Guests & Observers**", "", "* Royce Willis, Class of 2030 President", "",
    ...banner,
    "## **ATTENDANCE**", "##", "## ---", "",
    ...business,
    ...noted,
].join("\n");
const committeeOutline = documentSections(committee, { kind: "minutes.committee" });
check(
    "the committee template drops its banner and roll, and captions the agenda and the minutes",
    flat(committeeOutline).join("\n") ===
        [
            "ATTENDANCE",
            "Agenda",
            "  CONVENING BUSINESS",
            "    Call to Order / Start Time",
            "  CLOSING",
            "Minutes",
            "  CONVENING BUSINESS",
            "    Call to Order / Start Time",
            "  CLOSING",
        ].join("\n") &&
        committeeOutline.filter((section) => section.group).length === 2,
    flat(committeeOutline),
);
check(
    "outside minutes, or with no notes in the second copy, a repeated run is left alone",
    !documentSections(committee).some((section) => section.group) &&
        !documentSections([...banner, ...business, ...business].join("\n"), { kind: "minutes.committee" })
            .some((section) => section.group),
    flat(documentSections(committee)),
);

const minutesNotes = [
    "1. ## Reports (5 min)",
    "   1. Cabinet Reports (4 min)",
    "      1. Student Body President - *Jason*",
    "         1. Bring meetings with different departments to GBM",
    "      2. Treasurer - *Amy*",
    "      3. Chair of Programming - *Grace*",
    "         1. Auditions due at October 4th",
    "   2. Senator reports",
    "      1. Luke",
    "      2. Aishani:",
    "         1. Working with Jackson and Natalie from CARE to apply to dialogue grant, working on budgeting details, seeking more help",
    "1. ## Second Reading (10 min)",
    "   1. Tabling supplies funding bill - Student Services Chair Veda Kommineni",
    "      1. Passed finance with positive recommendation",
    "      2. Jazz: chair of programming washes them",
    "      3. Aishani: motion to pass",
    "         1. passed",
].join("\n");
check(
    "minutes number their notes, and the outline keeps the parts of the meeting",
    flat(documentSections(minutesNotes)).join("\n") ===
        [
            "Reports (5 min)",
            "  Cabinet Reports (4 min)",
            "    Student Body President - Jason",
            "    Treasurer - Amy",
            "    Chair of Programming - Grace",
            "  Senator reports",
            "Second Reading (10 min)",
            "  Tabling supplies funding bill - Student Services Chair Veda Kommineni",
        ].join("\n"),
    flat(documentSections(minutesNotes)),
);

console.log("\nbills and articles");

const bill = [
    "**Senate**",
    "**of the**",
    "**Student Government Association**",
    "",
    "**Act to Fund the Speed Dating Event**",
    "",
    "Introduced by: Me",
    "",
    "**SECTION 1\\. TITLE.**",
    "\tThis Act may be referred to as the Speed Dating Funding Bill",
    "",
    "**SECTION 2\\. FUNDING.**",
    "1) Expecting around 48 people, with a possible rotation in the middle to get new people",
    "2) The total amount would be $516",
    "",
    "Signatures of Enactment:",
    "Stone Meng",
    "Student Body President of the Johns Hopkins SGA",
].join("\n");
const bylaws = [
    "**BYLAWS OF THE Senate**",
    "**OF THE**",
    "**STUDENT GOVERNMENT ASSOCIATION**",
    "",
    "*Last Updated April 2026*",
    "",
    "**ARTICLE 1\\. TITLE AND PURPOSE**",
    "",
    "**_ARTICLE 1, SECTION 1\\._** These Bylaws of the Student Government Association, also referred to as the Bylaws, enacted pursuant to Article II, Section 3 of the Constitution, contains all regulations currently and permanently affecting the Student Government Association.",
    "",
    "**ARTICLE 3\\. THE EXECUTIVE BRANCH**",
    "",
    "**_ARTICLE 3, SECTION 2\\. RESPONSIBILITIES OF THE EXECUTIVE BRANCH_**",
    "",
    "**3.2.1 STUDENT BODY PRESIDENT**",
    "",
    "3.2.1 Serves as the Spokesperson of SGA.",
    "",
    "3.2.6.3 Organizes SGA Tabling Events",
    "",
    "3.2.6.3.5.8 The Bloomberg Student Center",
    "",
    "Caucus Senators Shall:",
    "",
    "**ARTICLE 4\\. THE LEGISLATIVE BRANCH**",
    "",
    "**4.1.2 STANDING LEGISLATIVE COMMITTEES**",
    "",
    "**4.1.2.5.1 COMMITTEE ON ACADEMIC AFFAIRS**",
].join("\n");
check(
    "bylaws nest sections and offices under their article, and clauses stay out",
    flat(documentSections(bylaws)).join("\n") ===
        [
            "ARTICLE 1. TITLE AND PURPOSE",
            "  ARTICLE 1, SECTION 1",
            "ARTICLE 3. THE EXECUTIVE BRANCH",
            "  ARTICLE 3, SECTION 2. RESPONSIBILITIES OF THE EXECUTIVE BRANCH",
            "    3.2.1 STUDENT BODY PRESIDENT",
            "ARTICLE 4. THE LEGISLATIVE BRANCH",
            "  4.1.2 STANDING LEGISLATIVE COMMITTEES",
            "    4.1.2.5.1 COMMITTEE ON ACADEMIC AFFAIRS",
        ].join("\n"),
    flat(documentSections(bylaws)),
);

check(
    "a bill's title block, its fields, its clauses, and its signatories are not sections",
    flat(documentSections(bill)).join("\n") ===
        ["SECTION 1. TITLE", "SECTION 2. FUNDING", "Signatures of Enactment"].join("\n"),
    flat(documentSections(bill)),
);

const article = [
    "# SGA talks mental health, teamwork",
    "",
    "*By ABBY SHEGELMAN · The Johns Hopkins News-Letter · November 12, 2015*",
    "",
    "The Student Government Association gathered in Charles Commons on Tuesday.",
].join("\n");
check(
    "an article's headline is the page title and its byline is not a section",
    documentSections(article, { titles: ["SGA talks mental health, teamwork"] }).length === 0,
    flat(documentSections(article, { titles: ["SGA talks mental health, teamwork"] })),
);

const codebook = Array.from({ length: 80 }, (_, index) => `# Variable ${index + 1}\n\nA value.`).join("\n\n");
check("a list of eighty headings is an index, not an outline", documentSections(codebook).length === 0);

const deep = Array.from(
    { length: 30 },
    (_, index) => `# Article ${index + 1}\n\n## Part ${index + 1}a\n\n## Part ${index + 1}b`,
).join("\n\n");
const deepOutline = documentSections(deep);
check(
    "an outline too long to scan drops its deepest level first",
    deepOutline.length === 30 && deepOutline.every((section) => section.children.length === 0),
    flat(deepOutline).length,
);

console.log("\nedges");

check(
    "a single heading is not an outline",
    documentSections("# Just a title\n\nOne paragraph and nothing else.").length === 0,
);
check(
    "a short document with no sections stays empty",
    documentSections("The Senate adjourned at nine.").length === 0,
);
check(
    "a heading styled inside a list item is a section",
    flat(documentSections("1. ## Call to Order\n\n2. ## Adjournment")).join("\n") ===
        "Call to Order\nAdjournment",
);

const anchors = sectionAnchors(agenda);
check(
    "every section id is the line it anchors, and ids are unique",
    (() => {
        const ids = idsOf(documentSections(agenda));
        return (
            ids.length > 0 &&
            new Set(ids).size === ids.length &&
            ids.every((id) => {
                const at = Number(id.slice("section-".length));
                const line = agenda.slice(at).split("\n")[0] ?? "";
                return anchors.get(at) === id && line.trim().length > 0;
            })
        );
    })(),
    [...anchors.keys()],
);

console.log("\nrendering");

const rendered = renderDocument(agenda, []);
check(
    "stamping section anchors does not change the words",
    words(rendered).join(" ") === (toPlainText(agenda).match(/[A-Za-z0-9]+/g) ?? []).join(" "),
    words(rendered).join(" "),
);

const renderedIds = blockSectionIds(rendered);
const outlineIds = idsOf(documentSections(agenda));
check(
    "the viewer has a target for every section the outline names",
    outlineIds.length > 0 && outlineIds.every((id) => renderedIds.has(id)),
    { renderedIds: [...renderedIds], outlineIds },
);

const split = [
    "**Article I: Bill of Rights**",
    "All persons enrolled as undergraduates have equal rights.",
    "*Section One: Name*",
    "The official governing body shall be the Student Government Association.",
].join("\n");
const quote = findQuote(split, "equal rights")!;
const cited = renderDocument(split, [
    { id: "c", startOffset: quote.startOffset, endOffset: quote.endOffset },
]);
const paragraphs = cited.filter((block) => block.kind === "paragraph");
check(
    "a section glued under another paragraph starts its own block, and the one on top keeps its text",
    paragraphs.length === 2 &&
        paragraphs.every((block) => block.sectionId !== undefined) &&
        runsText(paragraphs[0]!.runs).includes("equal rights") &&
        runsText(paragraphs[1]!.runs).startsWith("Section One"),
    cited.map((block) => (block.kind === "paragraph" ? runsText(block.runs) : block.kind)),
);
check(
    "a citation in the sentence under a section still highlights that sentence",
    cited.some(
        (block) =>
            block.kind === "paragraph" &&
            block.runs.some((run) => run.annotationId === "c" && run.text.includes("equal rights")),
    ),
    cited,
);

const workbook = ["Name,Present", "Ada,Here", "\fBudget", "Item,Amount", "Retreat,40"].join("\n");
const sheets = renderDocument(workbook, [], { sheetDelimiter: "," });
check(
    "a later sheet's name is a section, and the tables are untouched",
    sheets.some((block) => block.kind === "heading" && block.sectionId && runsText(block.runs) === "Budget") &&
        sheets.filter((block) => block.kind === "table").length === 2,
    sheets.map((block) => block.kind),
);

const notes = [
    "Week,Committee,Update",
    '1,Internal Affairs,"- Reviewed the bylaw update bill',
    '- Added a clause for a Senate Pro-tempore"',
    "\fBudget",
    "Item,Amount",
    "Retreat,40",
].join("\n");
const noteSheet = renderDocument(notes, [], { sheetDelimiter: "," });
check(
    "a bullet inside a spreadsheet cell is not a section, since the table has no block for it",
    idsOf(documentSections(notes, { anchored: blockSectionIds(noteSheet) })).length === 0,
    flat(documentSections(notes, { anchored: blockSectionIds(noteSheet) })),
);


const weeklyRendered = renderDocument(weeklyMinutes, []);
const weeklyAnchors = blockSectionIds(weeklyRendered);
const weeklyOutline = documentSections(weeklyMinutes, {kind: "minutes.committee", anchored: weeklyAnchors});
check("weekly meeting headings survive dates, times, rooms and exported anchor IDs",
    flat(weeklyOutline).some(title => title.includes("Meeting #6: October 15th, 2026"))
    && !flat(weeklyOutline).some(title => title.includes("{#")), flat(weeklyOutline));
check("weekly meeting links target rendered headings rather than the table of contents",
    idsOf(weeklyOutline).every(id => weeklyAnchors.has(id))
    && weeklyAnchors.has(`section-${weeklyMinutes.indexOf("# Meeting \\#6")}`));
check("exported anchor markup is hidden in rendered headings",
    weeklyRendered.filter(block => block.kind === "heading").every(block => !runsText(block.runs).includes("{#")));

const structuralDuties = "1. Article I - Senate\n    1. Section IV - Committees\n        1. Part I - All Committees shall\n            1. Issue reports.\n    2. Section V - Procedure\n        1. a Point of Parliamentary Inquiry, or\n        2. a Point of Personal Privilege,\n        3. Follow the rules.";
const dutySections = flat(documentSections(structuralDuties));
check("explicit structural headings retain introductory shall clauses",
    dutySections.some(title => title.trim() === "Part I - All Committees shall"), dutySections);
check("unfinished parliamentary list fragments are not sections",
    !dutySections.some(title => title.includes("a Point of")), dutySections);

const writingNotes = "# Prose\n- KSAS first-years must take Reintroduction to Writing\n    - Some courses are offered during the Fall\n- FAs across schools: KSAS vs WSE\n    - Full FAs for KSAS started two years ago\n- Legibility\n    - We know the legibility of the FAs is a real challenge\n- Credit Approval Timeline\n    - I aim for 2 weeks\n# Raw\n1. Credit approval time\n2. Orientation time\n3. Orientation office?\n\nThe original transcript continues here.";
const writingBlocks = renderDocument(writingNotes, []);
const writingOutline = documentSections(writingNotes, { anchored: blockSectionIds(writingBlocks) });
check("writing meeting topic bullets with nested content become sections with working targets",
    flat(writingOutline).join("|") === "Prose|  FAs across schools: KSAS vs WSE|  Legibility|  Credit Approval Timeline|Raw", flat(writingOutline));

if (failures > 0) {
    console.log(`\n${failures} failed`);
    process.exitCode = 1;
}
