import { findQuote } from "../lib/anchor";

let failures = 0;
function check(label: string, condition: boolean, detail?: unknown) {
    if (condition) {
        console.log(`  ok   ${label}`);
    } else {
        failures += 1;
        console.log(`  FAIL ${label}`, detail ?? "");
    }
}

const doc = [
    "# SGA Constitution",
    "",
    "## Article III \u2014 The Executive Branch",
    "",
    "The **Student Body President** shall serve a term of one academic year,",
    "and shall preside over all meetings of the Executive Board.",
    "",
    "The Treasurer shall maintain the accounts.",
].join("\n");

console.log("findQuote");

// 1. Verbatim.
const exact = findQuote(doc, "The Treasurer shall maintain the accounts.");
check(
    "exact quote resolves to the right slice",
    exact !== null &&
    doc.slice(exact.startOffset, exact.endOffset) ===
    "The Treasurer shall maintain the accounts.",
    exact,
);

// 2. Model rewrapped the line: newline in the document, space in the quote.
const rewrapped = findQuote(
    doc,
    "shall serve a term of one academic year, and shall preside over all meetings",
);
check(
    "quote spanning a line break resolves",
    rewrapped !== null,
    rewrapped,
);
check(
    "rewrapped slice starts and ends on the right words",
    rewrapped !== null &&
    doc.slice(rewrapped.startOffset).startsWith("shall serve a term") &&
    doc.slice(0, rewrapped.endOffset).endsWith("all meetings"),
    rewrapped && JSON.stringify(doc.slice(rewrapped.startOffset, rewrapped.endOffset)),
);

// 3. Quote crosses markdown emphasis markers the model dropped.
const acrossEmphasis = findQuote(doc, "The Student Body President shall serve");
check(
    "quote ignoring ** markers resolves",
    acrossEmphasis !== null,
    acrossEmphasis,
);
check(
    "emphasis slice covers the markers",
    acrossEmphasis !== null &&
    doc.slice(acrossEmphasis.startOffset, acrossEmphasis.endOffset) ===
    "The **Student Body President** shall serve",
    acrossEmphasis &&
    JSON.stringify(
        doc.slice(acrossEmphasis.startOffset, acrossEmphasis.endOffset),
    ),
);

// 4. Curly em dash in the document, hyphen from the model.
const folded = findQuote(doc, "Article III - The Executive Branch");
check("em dash folds to a hyphen", folded !== null, folded);

// 5. Genuinely absent -- the amended-away case.
check(
    "amended-away quote returns null",
    findQuote(doc, "The President may veto any resolution.") === null,
);

// 6. Short ambiguous quote refuses rather than guessing.
check("short ambiguous quote returns null", findQuote(doc, "shall") === null);

// 7. Long unambiguous quote still resolves even though "shall" repeats.
check(
    "long quote unaffected by repeated words",
    findQuote(doc, "shall preside over all meetings of the Executive Board.") !==
    null,
);

console.log(failures === 0 ? "\nall checks passed" : `\n${failures} failure(s)`);
process.exitCode = failures === 0 ? 0 : 1;
