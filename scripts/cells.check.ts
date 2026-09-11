import { restoreCellBreaks } from "../lib/cells";
import { CELL_BREAK } from "../lib/markdown";

let failures = 0;
function check(label: string, condition: boolean, detail?: unknown) {
    if (condition) {
        console.log(`  ok   ${label}`);
    } else {
        failures += 1;
        console.log(`  FAIL ${label}`, detail ?? "");
    }
}

function cell(htmlLines: string[], extra = ""): string {
    return `<td>${htmlLines.map((line) => `<p><span>${line}</span></p>`).join("")}${extra}</td>`;
}

function table(rows: string[][]): string {
    return `<table>${rows.map((row) => `<tr>${row.map((line) => cell([line])).join("")}</tr>`).join("")}</table>`;
}

console.log("cell breaks");

const discussionMd = [
    "| S-B.114 Fast-Forward Finance Bill Discussion: Peter: SIF, this Friday Changes Made: Decision: Pass | Committee Chair |",
    "| :---- | ----: |",
].join("\n");

const discussionHtml = `<table><tr>${cell([
    "S-B.114 Fast-Forward Finance Bill",
    "Discussion: Peter: SIF, this Friday",
    "Changes Made:",
    "Decision: Pass",
])}<td><p>Committee Chair</p></td></tr></table>`;

const restored = restoreCellBreaks(discussionMd, discussionHtml);
check(
    "a flattened discussion cell gets a break at each HTML paragraph",
    restored.includes(`Finance Bill${CELL_BREAK}Discussion:`) &&
    restored.includes(`Friday${CELL_BREAK}Changes Made:${CELL_BREAK}Decision:`),
    restored,
);
check(
    "the neighbouring cell is left alone",
    restored.includes("| Committee Chair |"),
    restored,
);

const linkedMd =
    "| S-B.114 [Fast-Forward Finance Bill](https://docs.google.com/document/d/abc) Discussion: Peter: hello |  |";
const linkedHtml = `<table><tr>${cell([
    'S-B.114 <a href="https://docs.google.com/document/d/abc">Fast-Forward Finance Bill</a>',
    "Discussion: Peter: hello",
])}<td></td></tr></table>`;
const linked = restoreCellBreaks(linkedMd, linkedHtml);
check(
    "a link in the markdown does not hide the next paragraph",
    linked.includes(`Bill](https://docs.google.com/document/d/abc)${CELL_BREAK}Discussion:`),
    linked,
);

const boldMd = "| The **Student Body President** shall serve. Next line. |";
const boldHtml = `<table><tr>${cell([
    "The Student Body President shall serve.",
    "Next line.",
])}</tr></table>`;
check(
    "emphasis markers stay put while the break is inserted",
    restoreCellBreaks(boldMd, boldHtml).includes(
        `**Student Body President** shall serve.${CELL_BREAK}Next line.`,
    ),
    restoreCellBreaks(boldMd, boldHtml),
);

check(
    "a cell that is already one paragraph is unchanged",
    restoreCellBreaks(
        "| Ada Lovelace | Present |",
        table([["Ada Lovelace", "Present"]]),
    ) === "| Ada Lovelace | Present |",
);

check(
    "HTML that does not match the markdown is left alone",
    restoreCellBreaks(
        "| The Senate shall meet | weekly |",
        `<table><tr>${cell(["Something else entirely", "and another"])}<td>weekly</td></tr></table>`,
    ) === "| The Senate shall meet | weekly |",
);

const two = [
    "| First item one two | A |",
    "",
    "| Second item three four | B |",
].join("\n");
const twoHtml = [
    `<table><tr>${cell(["First item", "one two"])}<td>A</td></tr></table>`,
    `<table><tr>${cell(["Second item", "three four"])}<td>B</td></tr></table>`,
].join("");
const twoRestored = restoreCellBreaks(two, twoHtml);
check(
    "each table is repaired on its own",
    twoRestored.includes(`First item${CELL_BREAK}one two`) &&
    twoRestored.includes(`Second item${CELL_BREAK}three four`),
    twoRestored,
);

const wrapped = `| Notes one two | extra |\n| :---- | ----: |`;
const wrappedHtml = `<table><tr><td><table><tr>${cell(["Notes", "one two"])}<td>extra</td></tr></table></td></tr></table>`;
check(
    "a wrapping HTML table still finds the inner cells",
    restoreCellBreaks(wrapped, wrappedHtml).includes(`Notes${CELL_BREAK}one two`),
    restoreCellBreaks(wrapped, wrappedHtml),
);

console.log(failures === 0 ? "\nall checks passed" : `\n${failures} failure(s)`);
process.exitCode = failures === 0 ? 0 : 1;
