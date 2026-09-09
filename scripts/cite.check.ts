import { citedIndexes, splitCitedParts, truncateAtWord } from "../lib/cite";

let failures = 0;
function check(label: string, condition: boolean, detail?: unknown) {
    if (condition) {
        console.log(`  ok   ${label}`);
    } else {
        failures += 1;
        console.log(`  FAIL ${label}`, detail ?? "");
    }
}

console.log("splitCitedParts");
const parts = splitCitedParts("The Senate holds legislative power. [1] Class Senators sit four to a class. [1][2]");
check(
    "keeps the prose",
    parts.some((part) => part.type === "text" && part.value.includes("Senate")),
);
check(
    "reads both markers on one claim",
    parts.filter((part) => part.type === "cite").map((part) => part.type === "cite" && part.index).join(",") ===
    "1,1,2",
    parts,
);
check(
    "citedIndexes is first-seen unique",
    citedIndexes("A [2] B [1] C [2]").join(",") === "2,1",
);
check(
    "text with no markers is one part",
    splitCitedParts("plain").length === 1 && splitCitedParts("plain")[0].type === "text",
);

console.log("\ntruncateAtWord");
check("short text is unchanged", truncateAtWord("Senate", 20) === "Senate");
check(
    "long text ends on a word and an ellipsis",
    truncateAtWord("The Senate shall meet every two weeks during the year", 24).endsWith("…") &&
    !truncateAtWord("The Senate shall meet every two weeks during the year", 24).includes("wee…"),
);

console.log(failures === 0 ? "\nall checks passed" : `\n${failures} failure(s)`);
process.exitCode = failures === 0 ? 0 : 1;
