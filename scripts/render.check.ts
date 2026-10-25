import { findQuote } from "../lib/anchor";
import { presentBill, signatureCards, signatureIdentity } from "../lib/bill-presentation";
import { toPlainText } from "../lib/markdown";
import { documentSections, type DocumentSection } from "../lib/outline";
import {
    blockSectionIds,
    proseInlineRuns,
    renderDocument,
    runsText,
    type Block,
    type InlineRun,
} from "../lib/render";

let failures = 0;
function check(label: string, condition: boolean, detail?: unknown) {
    if (condition) {
        console.log(`  ok   ${label}`);
    } else {
        failures += 1;
        console.log(`  FAIL ${label}`, detail ?? "");
    }
}

const flattenedProvisions = "**4.3.1.3 ORDER** 4.3.1.3.7 Closing of a Session 4.3.1.3.7.1 Meetings are open. 4.3.1.3.~~7~~8 Suspension of Rules";
const provisionSource = `| Current | Proposed |\n| --- | --- |\n| ${"Existing language remains in this comparison. ".repeat(4)} | ${flattenedProvisions} |`;
const provisionQuote = findQuote(provisionSource, "Meetings are open.")!;
const provisionBlocks = renderDocument(provisionSource, [{ id: "provision", ...provisionQuote }]);
check("flattened and redlined legislative provisions each start a new line",
    provisionBlocks[0]?.kind === "table" && runsText(provisionBlocks[0].rows[0].cells[1]).includes("\n4.3.1.3.78 Suspension"), JSON.stringify(provisionBlocks));
check("restoring provision breaks preserves citation text",
    highlighted(provisionBlocks, "provision") === "Meetings are open.");

const attendanceColumns = renderDocument("| Here:<br>Veda<br>Cole | Absent:<br>Excused:<br>Kai |\n| :---- | :---- |", []);
check("single-row attendance keeps equal table columns without a false header",
    attendanceColumns[0]?.kind === "table" && attendanceColumns[0].header === null && attendanceColumns[0].rows.length === 1);
const updateColumns = renderDocument(`| ${"Updates from the committee. ".repeat(6)} | ${"Responses and next steps. ".repeat(6)} |\n| :---- | :---- |`, []);
check("single-row minutes updates preserve both prose columns",
    updateColumns[0]?.kind === "table" && updateColumns[0].header === null);
const tasks = renderDocument("- [ ] Follow up with housing\n- [x] ~~Email sent~~", []);
check("action items parse checked state and remove checkbox syntax",
    tasks[0]?.kind === "list" && tasks[0].items[0].checked === false && tasks[0].items[1].checked === true
    && runsText(tasks[0].items[0].runs) === "Follow up with housing" && tasks[0].items[1].runs.some(run => run.strike));

/** Every run in the document, in reading order. */
const rulesExcerpt = "**SECTION 4\\. RULES**\n4\\. Senate Meetings\n4.1. Meetings occur Tuesday.\n4.2.Agenda\n> > > 4.2.1. The agenda contains:\n4.2.1.1. Call to Order\n4.2.1.1.1 A deeper clause.\n\nAn ordinary paragraph.";
const rulesBlocks = renderDocument(rulesExcerpt, []);
const clauses = rulesBlocks.filter(block => block.kind === "paragraph" && block.clause);
check("typed legislative clauses become separate blocks at their numbered depths",
    clauses.length === 6 && clauses.every(block => block.kind === "paragraph")
    && clauses.map(block => block.kind === "paragraph" ? block.clause?.depth : -1).join() === "0,1,1,2,3,4");
check("quote indentation on a legislative clause does not become a blockquote",
    !rulesBlocks.some(block => block.kind === "quote"));
const legislativeCell = "**4.1.3.5 LIST** represented group: Disabled Students:";
const legislativeTable = renderDocument(`| Current | Proposed |\n| --- | --- |\n| ${legislativeCell} | other |`, []);
check("legislative cells do not mistake prose before colons for speaker names",
    allRuns(legislativeTable).map(run => run.text).join("").includes("represented group: Disabled Students:"));
const clauseStart = rulesExcerpt.indexOf("The agenda contains:");
const navigationText = "Before **the cited passage** after.";
const navigationOffset = navigationText.indexOf("cited");
const navigationRuns = allRuns(renderDocument(navigationText, [{ id: "navigation-citation", startOffset: 0, endOffset: navigationText.length }], {
    navigationTargets: [{ id: "minutes-test", offset: navigationOffset }, { id: "minutes-test", offset: navigationOffset }],
}));
check("navigation anchors are unique and preserve overlapping citation text",
    navigationRuns.filter(run => run.navigationId === "minutes-test").length === 1
    && navigationRuns.filter(run => run.annotationId === "navigation-citation").map(run => run.text).join("") === "Before the cited passage after."
    && navigationRuns.filter(run => run.annotationId === "navigation-citation" && run.anchor).length === 1);
const citedRules = renderDocument(rulesExcerpt, [{ id: "rules-clause", startOffset: clauseStart, endOffset: clauseStart + "The agenda contains:".length }]);
check("numbered clauses preserve citation highlights and anchors",
    allRuns(citedRules).filter(run => run.annotationId === "rules-clause").map(run => run.text).join("") === "The agenda contains:"
    && allRuns(citedRules).filter(run => run.annotationId === "rules-clause" && run.anchor).length === 1);

function allRuns(blocks: Block[]): InlineRun[] {
    return blocks.flatMap((block) => {
        switch (block.kind) {
            case "heading":
            case "paragraph":
                return block.runs;
            case "quote":
                return allRuns(block.blocks);
            case "list":
                return block.items.flatMap((item) => [
                    ...item.runs,
                    ...allRuns(item.blocks),
                ]);
            case "table":
                return [...(block.header ? [block.header] : []), ...block.rows]
                    .flatMap((row) => row.cells.flat());
            case "layout":
                return block.rows.flatMap((row) => row.cells.flat());
            case "rule":
                return [];
        }
    });
}

/**
 * The rendered text, run boundaries removed. Highlighting splits runs, so
 * anything comparing two renderings of the same document has to ignore them.
 */
function renderedText(blocks: Block[]): string {
    return allRuns(blocks).map((run) => run.text).join("");
}

/**
 * The words the reader ends up seeing, in order. Runs are joined inside a
 * block and separated between blocks, because `**S**ponsors` is one word.
 */
function words(blocks: Block[]): string[] {
    const text = (runs: InlineRun[]) => runs.map((run) => run.text).join("");

    const pieces = (list: Block[]): string[] =>
        list.flatMap((block) => {
            switch (block.kind) {
                case "heading":
                case "paragraph":
                    return [text(block.runs)];
                case "quote":
                    return pieces(block.blocks);
                case "list":
                    return block.items.flatMap((item) => [
                        text(item.runs),
                        ...pieces(item.blocks),
                    ]);
                case "table":
                    return [...(block.header ? [block.header] : []), ...block.rows]
                        .flatMap((row) => row.cells.map(text));
                case "layout":
                    return block.rows.flatMap((row) => row.cells.map(text));
                case "rule":
                    return [];
            }
        });

    return pieces(blocks).join(" ").match(/[A-Za-z0-9]+/g) ?? [];
}

/** One table cell's text, run boundaries removed. */
function cellText(cell: InlineRun[]): string {
    return cell.map((run) => run.text).join("");
}

function flatIds(sections: DocumentSection[]): string[] {
    return sections.flatMap((section) => [section.id, ...flatIds(section.children)]);
}

/** The text a given annotation ended up highlighting. */
function highlighted(blocks: Block[], id: string): string {
    return allRuns(blocks)
        .filter((run) => run.annotationId === id)
        .map((run) => run.text)
        .join("");
}

const doc = [
    "# SGA Constitution",
    "",
    "## Article III \u2014 The Executive Branch",
    "",
    "The **Student Body President** shall serve a term of one academic year.",
    "The Treasurer shall maintain the accounts.",
    "",
    "1. Call to Order",
    "2. Reports",
    "   1. Finance Committee",
    "   2. Programming",
    "3. Adjournment",
    "",
    "* A *bulleted* point",
    "* Another with a [link](https://example.org/charter)",
    "",
    "> > The Senate shall retain oversight.",
    "",
    "---",
    "",
    "| Office | Holder |",
    "| :---- | :---- |",
    "| **Treasurer** | Ada |",
].join("\n");

const blocks = renderDocument(doc, []);

console.log("blocks");

check("heading levels survive", blocks[0].kind === "heading" &&
    blocks[0].level === 1 && blocks[0].runs[0].text === "SGA Constitution",
    blocks[0]);
check(
    "heading markers are not rendered",
    !renderedText(blocks).includes("#"),
    renderedText(blocks),
);
check(
    "a paragraph keeps the author's line break",
    blocks[2].kind === "paragraph" &&
    blocks[2].runs.some((run) => run.text.includes("\n")),
    blocks[2],
);
check(
    "bold is a mark, not asterisks",
    blocks[2].kind === "paragraph" &&
    blocks[2].runs.some((run) => run.bold && run.text === "Student Body President") &&
    !renderedText(blocks).includes("**"),
    blocks[2],
);

const ordered = blocks[3];
check("ordered list is one list", ordered.kind === "list" && ordered.ordered, ordered);
check(
    "list numbering comes from the document",
    ordered.kind === "list" && ordered.start === 1 && ordered.items.length === 3,
    ordered.kind === "list" && ordered.items.length,
);
check(
    "a deeper indent nests instead of restarting the list",
    ordered.kind === "list" &&
    ordered.items[1].blocks[0]?.kind === "list" &&
    (ordered.items[1].blocks[0] as Extract<Block, { kind: "list" }>).items.length === 2,
    ordered.kind === "list" && ordered.items[1],
);

const bulleted = blocks[4];
check("bulleted list is unordered", bulleted.kind === "list" && !bulleted.ordered, bulleted);
check(
    "a link keeps its words and its target",
    bulleted.kind === "list" &&
    bulleted.items[1].runs.some(
        (run) => run.text === "link" && run.href === "https://example.org/charter",
    ),
    bulleted.kind === "list" && bulleted.items[1].runs,
);

check("stacked quote markers collapse to one quote", blocks[5].kind === "quote", blocks[5]);
check("a rule is its own block", blocks[6].kind === "rule", blocks[6]);

const table = blocks[7];
check(
    "a two-column office list is prose, not a table",
    table.kind === "layout" && table.rows.length === 2,
    table,
);
check(
    "cells are parsed inline too",
    table.kind === "layout" &&
    table.rows[1].cells[0][0].bold &&
    table.rows[1].cells[0][0].text === "Treasurer",
    table.kind === "layout" && table.rows[1]?.cells,
);

// Docs has no other way to put two things side by side, so the minutes
// template uses a table to hold an agenda item and whoever leads it. Those are
// not data, and a reader given a one-cell spreadsheet to scroll is worse off
// than one given the text.

console.log("\nlayout tables");

const layoutDoc = [
    "| Closing Adjournment: 4:36 motion: Shreeman Second; demarri, cole Aye: Nay: | All Present |",
    "| :---- | ----: |",
    "",
    "| Welcome Reintroductions (If necessary) Agenda Amendment or Approval | All Present |",
    "| :---- | ----: |",
    "| The Senate shall consider the bill at its next meeting, and the Chair shall circulate it beforehand. |  |",
    "",
    "| A notice the author drew a box around |",
    "| :---- |",
    "| And a second line of it |",
].join("\n");
const layoutBlocks = renderDocument(layoutDoc, []);

check(
    "a single row of two cells is prose, not a table",
    layoutBlocks[0].kind === "layout" && layoutBlocks[0].rows.length === 1,
    layoutBlocks[0],
);
check(
    "a grid holding a sentence is prose, not a table",
    layoutBlocks[1].kind === "layout" && layoutBlocks[1].rows.length === 2,
    layoutBlocks[1],
);
check(
    "the header row of a layout table is content, not a heading",
    layoutBlocks[1].kind === "layout" &&
    cellText(layoutBlocks[1].rows[0].cells[0]).startsWith("Welcome"),
    layoutBlocks[1],
);
check(
    "one column is never a table",
    layoutBlocks[2].kind === "layout",
    layoutBlocks[2],
);
check(
    "a grid of short values in several columns is still a table",
    renderDocument(
        ["| Ada | Present | Grace | Absent |", "| :---- | :---- | :---- | :---- |",
            "| Alan | Present | Ida | Present |"].join("\n"),
        [],
    )[0].kind === "table",
);
check(
    "a two-column amendment is a table, not an aside",
    renderDocument(
        [
            "| *SENATE BYLAWS* |  |",
            "| ----- | ----- |",
            "| **CURRENT LANGUAGE** | **PROPOSED LANGUAGE** |",
            "| Option i: the bylaws do not mention the CSAC representative at all, in any article of the bylaws. | Option i: within the first 3 meetings the senate elects a CSAC representative from among its members. |",
        ].join("\n"),
        [],
    )[0].kind === "table",
);
check(
    "a funding grid of several short columns is a table",
    renderDocument(
        [
            "| Item | Vendor (Link) | Price ($/item) | Quantity | Total ($) |",
            "| :---- | :---- | :---- | :---- | :---- |",
            "| Qdoba catering | https://catering.qdoba.com/online/itemDetails/index/itemId/1156/categoryId/32/itemQuantity/1 | $926.71 | 1 | $997.99 |",
            "| **Total:** |  |  |  | **997.99** |",
        ].join("\n"),
        [],
    )[0].kind === "table",
);
check(
    "an agenda of short items next to All Present is still prose",
    renderDocument(
        [
            "| Welcome Reintroductions | All Present |",
            "| :---- | ----: |",
            "| Closing Adjournment: 4:36 motion: Shreeman Second; demarri, cole Aye: Nay: | All Present |",
        ].join("\n"),
        [],
    )[0].kind === "layout",
);

const flatMinutes = renderDocument(
    "| S-B.114.09.01.26-1 Fast-Forward Finance Bill – Intr. Peter Tarpley Discussion: Peter: SIF, this Friday Changes Made: Decision: Pass | Chair |",
    [],
);
const flatCell =
    flatMinutes[0]?.kind === "layout" ? cellText(flatMinutes[0].rows[0]!.cells[0]!) : "";
check(
    "a flattened minutes cell is shown with a break at each heading and speaker",
    flatMinutes[0]?.kind === "layout" &&
    flatCell.includes("\nDiscussion:") &&
    flatCell.includes("\nPeter:") &&
    flatCell.includes("\nChanges Made:") &&
    flatCell.includes("\nDecision:"),
    flatCell,
);

console.log("\ncontent fidelity");

// The invariant that replaces "segments concatenate back to the document":
// rendering may drop syntax, but never a word, and never their order.
check(
    "every word of the document is rendered, in order",
    words(blocks).join(" ") ===
    (toPlainText(doc).match(/[A-Za-z0-9]+/g) ?? []).join(" "),
    words(blocks).join(" "),
);

// Google Docs' own oddities.
const messy = [
    "SECTION 1\\. The **Council** shall meet\\.",
    "",
    "A stray * asterisk and an unclosed *marker.",
    "",
    "An image link [****](https://example.org/image.png) leaves nothing behind.",
    "",
    "A ~~struck~~ clause and a [target](javascript:danger).",
    "",
    "A [venue guide](https://example.org/rates%20\\(Cylburn\\).pdf) with parentheses.",
    "",
    "1. ## Call to Order",
    "2.",
    "3. Roll",
].join("\n");
const messyBlocks = renderDocument(messy, []);
const messyText = allRuns(messyBlocks).map((run) => run.text).join(" ");

check("escaped punctuation loses its backslash", messyText.includes("SECTION 1."),
    messyText);
check("an unclosed marker stays a literal asterisk",
    messyText.includes("stray * asterisk") && messyText.includes("*marker"), messyText);
check(
    "a link with no text is dropped rather than rendered invisible",
    allRuns(messyBlocks).every((run) => run.href !== "https://example.org/image.png"),
    allRuns(messyBlocks).filter((run) => run.href),
);
check(
    "an unsafe target keeps its words and loses its link",
    allRuns(messyBlocks).some((run) => run.text === "target" && run.href === null),
    allRuns(messyBlocks).filter((run) => run.href),
);
check("strikethrough is a mark",
    allRuns(messyBlocks).some((run) => run.strike && run.text === "struck"),
    allRuns(messyBlocks).filter((run) => run.strike));
check(
    "a URL keeps its escaped parentheses",
    allRuns(messyBlocks).some(
        (run) =>
            run.text === "venue guide" &&
            run.href === "https://example.org/rates%20(Cylburn).pdf",
    ),
    allRuns(messyBlocks).filter((run) => run.href),
);

const agenda = messyBlocks.at(-1);
check(
    "a heading inside a list item renders as a heading, not as hashes",
    agenda?.kind === "list" &&
    agenda.items[0].blocks[0]?.kind === "heading" &&
    !messyText.includes("#"),
    agenda,
);
check(
    // Docs exports a blank bullet as a bare "2." line.
    "an empty list item stays an item rather than becoming a stray number",
    agenda?.kind === "list" &&
    agenda.items.length === 3 &&
    agenda.items[1].runs.length === 0 &&
    !/\b2\b/.test(messyText),
    agenda,
);

console.log("\nagendas");

// The shape the GBM agendas actually export in: each item a bold numbered
// line with Docs' underline as a `---` beneath it, and the lines under it at
// whatever column the export chose, the first of them at the item's own.
const agendaDoc = [
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
    "2.  **Non-Legislative Business**",
    "   ---",
    "",
    "            a. Senator of the Month",
    "            b. Approval of the discretionary fund",
    "3. **Second Reading**",
    "",
    "      a. [Survey Tabling Bill](https://example.org/survey) \\- Chair Veda",
    "",
    "         b. SAAC Funding Bill",
    "4. Public Input",
    "5. **Closing and Adjournment**",
    "    ---",
    "",
    "    *SGA meetings run until 9:00 PM.*",
].join("\n");
const agendaBlocks = renderDocument(agendaDoc, []);
type ListBlock = Extract<Block, { kind: "list" }>;
const agendaList = agendaBlocks[0] as ListBlock;
const titleOf = (item: ListBlock["items"][number]) => {
    const heading = item.blocks[0];
    return heading?.kind === "heading" ? heading : null;
};
const childList = (item: ListBlock["items"][number], at = 1) => item.blocks[at] as ListBlock | undefined;

check(
    "an agenda of bold numbered items is one list, its underlines not rules",
    agendaBlocks.length === 1 &&
    agendaList.kind === "list" &&
    agendaList.agenda === true &&
    agendaList.items.length === 5,
    agendaBlocks.map((block) => block.kind),
);
check(
    "each agenda item is a heading with the number the export wrote",
    agendaList.items.map((item) => titleOf(item)?.marker).join(" ") === "1. 2. 3. 4. 5." &&
    runsText(titleOf(agendaList.items[0])!.runs) === "Call to Order & Roll Call" &&
    titleOf(agendaList.items[0])!.ruled === true &&
    titleOf(agendaList.items[2])!.ruled !== true,
    agendaList.items.map((item) => titleOf(item)),
);
check(
    // The inversion this fixes: "1. Present" sat at the item's own column and
    // so became a sibling of "Call to Order", and the lettered lines became
    // flush-left paragraphs larger in effect than the items above them.
    "lines at the item's own column fall under it, with their own nesting",
    childList(agendaList.items[0])?.items.length === 2 &&
    (childList(agendaList.items[0])!.items[1].blocks[0] as ListBlock | undefined)?.numbering === "roman" &&
    (childList(agendaList.items[0])!.items[1].blocks[0] as ListBlock).items.length === 2,
    childList(agendaList.items[0]),
);
check(
    // The letters are the author's text, not list syntax: they stay in the
    // runs, and the item says how many characters they take up.
    "typed letters are a lettered list under their item, and keep their letters",
    childList(agendaList.items[1])?.numbering === "letter" &&
    childList(agendaList.items[1])!.items.map((item) => runsText(item.runs)).join("|") ===
        "a. Senator of the Month|b. Approval of the discretionary fund" &&
    childList(agendaList.items[1])!.items.every((item) => item.typedMarker === 2),
    childList(agendaList.items[1]),
);
check(
    "a b. indented under a. is still a's sibling",
    childList(agendaList.items[2])?.items.length === 2 &&
    childList(agendaList.items[2])!.items[1].value === 2,
    childList(agendaList.items[2]),
);
check(
    "an unbolded item numbered next is the agenda's, not a note under the last",
    runsText(titleOf(agendaList.items[3])!.runs) === "Public Input" &&
    agendaList.items[3].blocks.length === 1,
    agendaList.items[3],
);
check(
    "a note indented under the last item stays with it",
    agendaList.items[4].blocks[1]?.kind === "paragraph" &&
    runsText((agendaList.items[4].blocks[1] as { runs: InlineRun[] }).runs) === "SGA meetings run until 9:00 PM.",
    agendaList.items[4].blocks,
);
check(
    "an agenda renders every word, typed letters included",
    words(agendaBlocks).join(" ") ===
    (toPlainText(agendaDoc).match(/[A-Za-z0-9]+/g) ?? []).join(" "),
    words(agendaBlocks).join(" "),
);
check(
    "every outline entry of an agenda has a block to scroll to",
    documentSections(agendaDoc).length > 0 &&
    flatIds(documentSections(agendaDoc)).every((id) => blockSectionIds(agendaBlocks).has(id)),
    [flatIds(documentSections(agendaDoc)), [...blockSectionIds(agendaBlocks)]],
);
const agendaQuote = findQuote(agendaDoc, "Senator of the Month")!;
const crossing = findQuote(agendaDoc, "Absent:\n\n   i. Excused:")!;
const agendaCited = renderDocument(agendaDoc, [
    { id: "month", startOffset: agendaQuote.startOffset, endOffset: agendaQuote.endOffset },
    { id: "cross", startOffset: crossing.startOffset, endOffset: crossing.endOffset },
]);
check(
    "a citation inside an agenda highlights exactly its words",
    highlighted(agendaCited, "month") === "Senator of the Month" &&
    highlighted(agendaCited, "cross") === "Absent:i. Excused:",
    [highlighted(agendaCited, "month"), highlighted(agendaCited, "cross")],
);
check(
    "highlighting an agenda does not change what is rendered",
    renderedText(agendaCited) === renderedText(agendaBlocks),
);

const pdfAgenda = renderDocument(
    ["1. Call to Order and Attendance (1 min)", "a. Absentees:", "i. Excused:", "2. Convening Business"].join("\n"),
    [],
);
check(
    // A PDF's wrapped lines sit at the margin too, so a list there would cut
    // "e. Election of President of the Senate" off from "& Committee Chairs".
    "unindented letters outside an agenda stay text",
    pdfAgenda.every((block) => block.kind !== "list" || (!block.agenda && !block.numbering)) &&
    pdfAgenda.some((block) => block.kind === "paragraph" && runsText(block.runs).startsWith("a. Absentees:")),
    pdfAgenda,
);
check(
    "a bold sentence is a notice, not an agenda item",
    renderDocument("1. **The first 3 hours are required\\!**\n2. **Please arrive by 10:30am.**", [])
        .every((block) => block.kind !== "list" || !block.agenda),
);
const mixed = renderDocument(
    ["1. Attendance", "2. Academic Affairs", "   1. **Board Town Hall**", "3. **Wellness Pass**"].join("\n"),
    [],
);
check(
    "a plain list gives way to an agenda below it, and keeps its bold sub-items",
    mixed.length === 2 &&
    mixed[0].kind === "list" && !mixed[0].agenda && mixed[0].items.length === 2 &&
    mixed[1].kind === "list" && mixed[1].agenda === true && mixed[1].start === 3,
    mixed,
);
const letters = renderDocument("   g. Seventh\n   h. Eighth\n   i. Ninth", [])[0];
check(
    "an i. after h. is a letter, not a numeral",
    letters?.kind === "list" && letters.numbering === "letter" &&
    letters.items.map((item) => item.value).join(",") === "7,8,9",
    letters,
);

console.log("\nhighlights");

const a = findQuote(doc, "The Treasurer shall maintain the accounts.")!;
const b = findQuote(doc, "The Student Body President shall serve")!;
const cited = renderDocument(doc, [
    { id: "a", startOffset: a.startOffset, endOffset: a.endOffset },
    { id: "b", startOffset: b.startOffset, endOffset: b.endOffset },
]);

check(
    "a plain quote highlights exactly its own words",
    highlighted(cited, "a") === "The Treasurer shall maintain the accounts.",
    JSON.stringify(highlighted(cited, "a")),
);
// The reason offsets are carried through the parse at all: this quote spans
// `**` markers that are no longer in the output.
check(
    "a quote spanning emphasis highlights across the markers",
    highlighted(cited, "b") === "The Student Body President shall serve",
    JSON.stringify(highlighted(cited, "b")),
);
check(
    "the highlight is split by the emphasis it crosses",
    allRuns(cited).filter((run) => run.annotationId === "b").length === 3,
    allRuns(cited).filter((run) => run.annotationId === "b"),
);
check(
    "each citation is anchored exactly once",
    allRuns(cited).filter((run) => run.anchor).length === 2,
    allRuns(cited).filter((run) => run.anchor).map((run) => run.annotationId),
);
check(
    "highlighting does not change what is rendered",
    renderedText(cited) === renderedText(blocks),
);

// A citation that lands inside a table cell must still be found there.
const inCell = findQuote(doc, "Treasurer | Ada")!;
const cellCited = renderDocument(doc, [
    { id: "cell", startOffset: inCell.startOffset, endOffset: inCell.endOffset },
]);
check(
    "a citation inside a table highlights the cells it covers",
    highlighted(cellCited, "cell") === "TreasurerAda",
    JSON.stringify(highlighted(cellCited, "cell")),
);

// Overlapping, orphaned and out-of-range spans must not corrupt the output.
const spans = renderDocument(doc, [
    { id: "x", startOffset: 10, endOffset: 40 },
    { id: "y", startOffset: 20, endOffset: 50 },
    { id: "z", startOffset: 5, endOffset: 99_999 },
    { id: "orphan", startOffset: null, endOffset: null },
]);
check(
    "invalid and overlapping spans leave the text intact",
    renderedText(spans) === renderedText(blocks),
);
check(
    "an overlapping span is dropped rather than double-rendered",
    new Set(
        allRuns(spans)
            .map((run) => run.annotationId)
            .filter(Boolean),
    ).size === 1,
    allRuns(spans).map((run) => run.annotationId).filter(Boolean),
);

// Spreadsheets. Stored as the raw export, shown as a table, with the offsets
// still pointing at the CSV underneath.

console.log("\nspreadsheets");

const sheet = [
    "Name,Position,Note",
    'Ada Lovelace,Treasurer,"Chairs Finance, and Appropriations"',
    'Grace Hopper,Senator,"She said ""ship it"" and left"',
    "Alan Turing,Senator",
].join("\n");

const sheetBlocks = renderDocument(sheet, [], { sheetDelimiter: "," });
const sheetTable = sheetBlocks[0];

check(
    "a sheet renders as one table",
    sheetBlocks.length === 1 && sheetTable.kind === "table",
);

check(
    "the first row becomes the header",
    sheetTable.kind === "table" &&
    sheetTable.header !== null &&
    sheetTable.header.cells.map(cellText).join("|") === "Name|Position|Note",
    sheetTable.kind === "table" ? sheetTable.header?.cells.map(cellText) : null,
);

check(
    "a quoted cell keeps its comma and loses its quotes",
    sheetTable.kind === "table" &&
    cellText(sheetTable.rows[0].cells[2]) === "Chairs Finance, and Appropriations",
    sheetTable.kind === "table" ? cellText(sheetTable.rows[0].cells[2]) : null,
);

check(
    "a doubled quote inside a cell renders as one",
    sheetTable.kind === "table" &&
    cellText(sheetTable.rows[1].cells[2]) === 'She said "ship it" and left',
    sheetTable.kind === "table" ? cellText(sheetTable.rows[1].cells[2]) : null,
);

check(
    "a short row is padded to the width of the table",
    sheetTable.kind === "table" &&
    sheetTable.rows[2].cells.length === 3 &&
    cellText(sheetTable.rows[2].cells[2]) === "",
    sheetTable.kind === "table" ? sheetTable.rows[2].cells.map(cellText) : null,
);

// The point of doing this at render time: a quote anchored against the stored
// CSV still highlights the cell it lands in.
const inSheet = findQuote(sheet, "Grace Hopper")!;
const sheetCited = renderDocument(
    sheet,
    [{ id: "s", startOffset: inSheet.startOffset, endOffset: inSheet.endOffset }],
    { sheetDelimiter: "," },
);
check(
    "a citation into the raw CSV highlights the cell it falls in",
    highlighted(sheetCited, "s") === "Grace Hopper",
    JSON.stringify(highlighted(sheetCited, "s")),
);

const roll = renderDocument(
    "| Shreemann Patel, Chair | Present |\n| :---- | :---- |\n| Sumire Sumi | Present |\n| Paul Woo | Excused |",
    [],
);
check(
    "a roll's first row is a member, not a column header",
    roll[0]?.kind === "table" && roll[0].header === null && roll[0].rows.length === 3,
    roll[0],
);

const tabbed = renderDocument("Name\tSeat\nAda\tTreasurer", [], {
    sheetDelimiter: "\t",
});
check(
    "tab-separated rows from the xlsx path split too",
    tabbed[0].kind === "table" && cellText(tabbed[0].rows[0].cells[1]) === "Treasurer",
    tabbed[0].kind === "table" ? tabbed[0].rows[0].cells.map(cellText) : null,
);

const tabs = [
    "Name,Seat",
    "Ada,Treasurer",
    "\fBudget",
    "Item,Amount",
    "Coffee,12",
].join("\n");
const tabBlocks = renderDocument(tabs, [], { sheetDelimiter: "," });
const tabTables = tabBlocks.filter((block) => block.kind === "table");
check(
    "each tab of a workbook renders as its own table",
    tabTables.length === 2 &&
        tabBlocks.some(
            (block) => block.kind === "heading" && runsText(block.runs) === "Budget",
        ),
    tabBlocks.map((block) => block.kind),
);
check(
    "a later tab keeps its own header",
    tabTables[1]?.kind === "table" &&
        tabTables[1].header !== null &&
        tabTables[1].header.cells.map(cellText).join("|") === "Item|Amount",
    tabTables[1]?.kind === "table" ? tabTables[1].header?.cells.map(cellText) : null,
);
const coffee = findQuote(tabs, "Coffee")!;
const tabCited = renderDocument(
    tabs,
    [{ id: "b", startOffset: coffee.startOffset, endOffset: coffee.endOffset }],
    { sheetDelimiter: "," },
);
check(
    "a citation into a later tab highlights that cell",
    highlighted(tabCited, "b") === "Coffee",
    JSON.stringify(highlighted(tabCited, "b")),
);

console.log("\nproseInlineRuns");
const committee = proseInlineRuns("**Committee on Internal Affairs:** hears appeals. [1]");
check(
    "generated prose bold labels render without asterisks",
    committee.some((run) => run.bold && run.text === "Committee on Internal Affairs:") &&
        runsText(committee) === "Committee on Internal Affairs: hears appeals. [1]",
    committee,
);

const billOpening = [
    "**Senate**\n**of the**\n**Student Government Association**\n**of**\n**The Johns Hopkins University**",
    "**{ *S. Bill. 114.10.20.2026-1* }**",
    "**A Bill to Amend The Bylaws of the Senate**",
    "**Closed Session Clarification Act**",
    "Introduced by: **Cole**Sponsored by: **Shreemann** and **Veda**\nPresented for First Reading this **20th** day of **October** in the year **2026**",
    "**SECTION 1. TITLE.**\nThis Act has a title.",
    "**SECTION 6. CONSTITUTIONALLY-MANDATED NON-LEGISLATIVE ADDENDUM**",
    "1. **FIRST SENATOR REPRESENTING THE CAUCUS**\n    1. The first Senator shall be appointed.",
].join("\n\n");
const billCredit = findQuote(billOpening, "Cole")!;
const rallyBill = presentBill(renderDocument(billOpening
    .replace("A Bill to Amend The Bylaws of the Senate", "An SGA Funding Bill")
    .replace("Closed Session Clarification Act", "Take Back The Night Rally Funding Bill")
    .replace("S. Bill. 114.10.20.2026-1", "S. Bill. 26-27"), []));
check("SGA funding bills receive the shared header, credits and section presentation",
    rallyBill.header.some(line => line.kind === "purpose" && runsText(line.runs).trim() === "An SGA Funding Bill") &&
    rallyBill.header.some(line => line.kind === "title" && runsText(line.runs).includes("Take Back")) &&
    rallyBill.header.filter(line => line.kind === "credit").length === 2 &&
    rallyBill.blocks[0]?.kind === "heading");
const billParsed = renderDocument(billOpening, [{ id: "bill-credit", ...billCredit }]);
const billPresented = presentBill(billParsed);
check("standard bill title block separates number, purpose, title, credits, and reading",
    billPresented.header.filter(line => line.kind === "number").length === 1 &&
    billPresented.header.filter(line => line.kind === "title").length === 1 &&
    billPresented.header.filter(line => line.kind === "credit").length === 2 &&
    billPresented.header.filter(line => line.kind === "reading").length === 1, billPresented.header);
check("bill sections are headings while their numbered provisions are ordinary list items",
    billPresented.blocks.filter(block => block.kind === "heading").length === 2 &&
    billPresented.blocks.some(block => block.kind === "list" && !block.agenda &&
        runsText(block.items[0].runs) === "FIRST SENATOR REPRESENTING THE CAUCUS"), billPresented.blocks);
check("bill presentation preserves section targets, body text, and citation anchors",
    [...blockSectionIds(billParsed)].every(id => blockSectionIds(billPresented.blocks).has(id) || billPresented.header.some(line => line.sectionId === id)) &&
    allRuns(billPresented.blocks).some(run => run.text.includes("This Act has a title.")) &&
    billPresented.header.flatMap(line => line.runs).filter(run => run.annotationId === "bill-credit" && run.anchor).length === 1);
const secondBill = presentBill(renderDocument(billOpening.replace("S. Bill. 114.10.20.2026-1", "S-B.114.10.13.26-1")
    .replace("Closed Session Clarification Act", "Establishing A Transfer Student Caucus").replaceAll("**\n**", "**\n\n**"), []));
check("alternate bill identifiers and separately exported letterhead lines share the presentation",
    secondBill.header.some(line => line.kind === "number") && secondBill.header.some(line => line.kind === "title" && runsText(line.runs).includes("Transfer")));
check("meeting agendas retain their original presentation",
    presentBill(agendaBlocks).header.length === 0 && presentBill(agendaBlocks).blocks === agendaBlocks);

const fundingBill = presentBill(renderDocument(billOpening
    .replace("**A Bill to Amend The Bylaws of the Senate**", "**Student Athlete Caucus Chair Funding Bill**\n\n**Act to Fund T-Shirts for Student Athlete Advisory Committee (SAAC)**")
    .replace("Closed Session Clarification Act", "SAAC T-Shirts Funding Bill"), []));
check("SAAC funding bill recognizes Act to Fund and retains its extra introductory title",
    fundingBill.header.some(line => line.kind === "purpose" && runsText(line.runs).includes("Act to Fund")) &&
    fundingBill.header.some(line => line.kind === "title" && runsText(line.runs) === "SAAC T-Shirts Funding Bill") &&
    fundingBill.header.some(line => runsText(line.runs).includes("Student Athlete Caucus Chair Funding Bill")) &&
    fundingBill.blocks[0]?.kind === "heading");
const ceremonyParagraphs = [
    "__________________________________\nSophia Baleeiro\nSenator of the Johns Hopkins SGA\n__________________________________",
    "Cole Liazos-Coffey\nSenator of the Johns Hopkins SGA\n__________________________________",
    "Demarri Dosunmu\nSenator of the Johns Hopkins SGA",
];
const ceremonyCards = signatureCards(ceremonyParagraphs.map((text, index) => ({ runs: proseInlineRuns(text), sectionId: `ceremony-${index}` })));
check("ceremony signature rules trailing the previous paragraph produce three separate cards",
    ceremonyCards.length === 3 && ceremonyCards.every((card, index) =>
        runsText(card.runs).includes(["Sophia Baleeiro", "Cole Liazos-Coffey", "Demarri Dosunmu"][index])) &&
    ceremonyCards.flatMap(card => card.runs).filter(run => run.navigationId).length === 3, ceremonyCards);

const multilineIdentity = signatureIdentity(proseInlineRuns("____\nJason Yu\nStudent Body President of the Johns Hopkins SGA"));
const inlineIdentity = signatureIdentity(proseInlineRuns("____\nCole Liazos-Coffey, Religious and Spiritual Life Senator and Vice Chair of Internal Affairs"));
check("signature names and offices separate in multiline and comma-separated templates",
    runsText(multilineIdentity.name) === "Jason Yu" && runsText(multilineIdentity.position).startsWith("Student Body President") &&
    runsText(inlineIdentity.name) === "Cole Liazos-Coffey" && runsText(inlineIdentity.position).trimStart().startsWith("Religious and Spiritual Life Senator"));
const citedIdentityRuns = [{ ...proseInlineRuns("____\nJason Yu\nPresident")[0], annotationId: "signature", anchor: true }];
const citedIdentity = signatureIdentity(citedIdentityRuns);
check("signature styling preserves all source text and a single citation anchor",
    runsText([...citedIdentity.rule, ...citedIdentity.name, ...citedIdentity.separator, ...citedIdentity.position]) === runsText(citedIdentityRuns) &&
    [...citedIdentity.rule, ...citedIdentity.name, ...citedIdentity.separator, ...citedIdentity.position].filter(run => run.anchor).length === 1);

console.log(failures === 0 ? "\nall checks passed" : `\n${failures} failure(s)`);
process.exitCode = failures === 0 ? 0 : 1;
