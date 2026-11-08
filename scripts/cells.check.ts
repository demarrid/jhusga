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

const bulleted = `| Action Items Can we audit them? It\u2019s kind of primitive\u2026 there are better ways | All Present |\n| :---- | ----: |`;
const bulletedHtml =
    `<table><tr><td><p><span>Action Items</span></p><ul>` +
    `<li><span>Can we audit them?</span></li>` +
    `<li><span>It&rsquo;s kind of primitive&hellip; there are better ways</span></li>` +
    `</ul></td><td>All Present</td></tr></table>`;
check(
    "bullets with named entities in them still get their breaks",
    restoreCellBreaks(bulleted, bulletedHtml).includes(
        `Action Items${CELL_BREAK}Can we audit them?${CELL_BREAK}It\u2019s kind`,
    ),
    restoreCellBreaks(bulleted, bulletedHtml),
);

const commented = `| Open Forum Bylaws comments Consent Agenda Discussion Standardizing Bill ID | All Present |\n| :---- | ----- |`;
const commentedHtml =
    `<table><tr><td><p><span>Open Forum</span></p><ul>` +
    `<li><span>Bylaws comments</span></li>` +
    `<li><span>Consent Agenda Discussion</span><sup><a href="#cmnt1" id="cmnt_ref1">[a]</a></sup></li>` +
    `<li><span>Standardizing Bill ID</span></li>` +
    `</ul></td><td>All Present</td></tr></table>`;
check(
    "a comment marker in the HTML does not drop the cell's breaks",
    restoreCellBreaks(commented, commentedHtml).includes(
        `Bylaws comments${CELL_BREAK}Consent Agenda Discussion${CELL_BREAK}Standardizing Bill ID`,
    ),
    restoreCellBreaks(commented, commentedHtml),
);

const struck = `| ~~3.2.1.2.7 Reviews legislation~~ 3.2.1.2.8 Assists new members | Current |\n| :---- | ----- |`;
const struckHtml =
    `<table><tr><td><p><span style="text-decoration:line-through">3.2.1.2.7 Reviews legislation</span></p>` +
    `<p><span>3.2.1.2.8 Assists new members</span></p></td><td>Current</td></tr></table>`;
check(
    "a break after struck-through text goes after the closing ~~",
    restoreCellBreaks(struck, struckHtml).includes(`legislation~~${CELL_BREAK}3.2.1.2.8`),
    restoreCellBreaks(struck, struckHtml),
);

console.log(failures === 0 ? "\nall checks passed" : `\n${failures} failure(s)`);
process.exitCode = failures === 0 ? 0 : 1;
