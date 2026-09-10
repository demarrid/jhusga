import { findQuote } from "../lib/anchor";
import { toPlainText } from "../lib/markdown";
import { renderDocument, type Block, type InlineRun } from "../lib/render";

let failures = 0;
function check(label: string, condition: boolean, detail?: unknown) {
    if (condition) {
        console.log(`  ok   ${label}`);
    } else {
        failures += 1;
        console.log(`  FAIL ${label}`, detail ?? "");
    }
}

/** Every run in the document, in reading order. */
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
    "the delimiter row becomes a header, not a row",
    table.kind === "table" &&
    table.header?.cells.length === 2 &&
    table.rows.length === 1,
    table,
);
check(
    "cells are parsed inline too",
    table.kind === "table" &&
    table.rows[0].cells[0][0].bold &&
    table.rows[0].cells[0][0].text === "Treasurer",
    table.kind === "table" && table.rows[0]?.cells,
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

const tabbed = renderDocument("Name\tSeat\nAda\tTreasurer", [], {
    sheetDelimiter: "\t",
});
check(
    "tab-separated rows from the xlsx path split too",
    tabbed[0].kind === "table" && cellText(tabbed[0].rows[0].cells[1]) === "Treasurer",
    tabbed[0].kind === "table" ? tabbed[0].rows[0].cells.map(cellText) : null,
);

console.log(failures === 0 ? "\nall checks passed" : `\n${failures} failure(s)`);
process.exitCode = failures === 0 ? 0 : 1;
