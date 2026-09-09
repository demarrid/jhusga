/**
 * Checks that a document's own caption, not Drive createdTime, decides
 * which session it belongs to and when it was dated.
 */
import { sessionFromAcademicYearStart } from "../config/session";
import {
    dateFromDocument,
    linkedSession,
    sessionFromDocument,
} from "../lib/identity";
import { classifyDocument } from "../lib/kinds";

let failures = 0;
function check(label: string, condition: boolean, detail?: unknown) {
    if (condition) {
        console.log(`  ok   ${label}`);
    } else {
        failures += 1;
        console.log(`  FAIL ${label}`, detail ?? "");
    }
}

function isoDay(date: Date | null): string | null {
    return date ? date.toISOString().slice(0, 10) : null;
}

console.log("sessionFromAcademicYearStart");
check("the 114th begins in 2026", sessionFromAcademicYearStart(2026) === 114);
check("the 1st begins in 1913", sessionFromAcademicYearStart(1913) === 1);
check("a year before the SGA is not a session", sessionFromAcademicYearStart(1912) === null);

console.log("\nsessionFromDocument");

const rulesTitle = "S.B.26-27.21.04-1 Rules Bill";
const rulesHeader = [
    "JHU STUDENT GOVERNMENT ASSOCIATION — SGA-B-2627.01 — SENATE PROCEDURAL RULES BILL 1",
    "{S-B.26-27 04.21.26-1}",
    "A BILL ESTABLISHING THE 2026-2027 LEGISLATIVE SESSION RULES",
    "CONSIDERED THIS 21ST DAY OF APRIL IN THE YEAR 2026",
].join("\n");

check(
    "a 26-27 rules bill is the 114th, from its filename",
    sessionFromDocument({ title: rulesTitle }) === 114,
    sessionFromDocument({ title: rulesTitle }),
);
check(
    "the same bill's caption agrees",
    sessionFromDocument({ title: rulesTitle, content: rulesHeader }) === 114,
);
check(
    "a file that names two sessions is not guessed",
    sessionFromDocument({
        title: "Notes",
        content: "The 112th session bylaws and the 114th session rules.",
    }) === null,
);
check(
    "an undated working doc stays unknown",
    sessionFromDocument({ title: "Copy of bill" }) === null,
);

console.log("\nlinkedSession");
check(
    "the caption wins over a 112th agenda that still links the file",
    linkedSession({ title: rulesTitle, content: rulesHeader }, 112) === 114,
);
check(
    "a file that says nothing keeps the session it was inherited from",
    linkedSession({ title: "Untitled" }, 112) === 112,
);

console.log("\ndateFromDocument");
check(
    "S.B.26-27.21.04-1 is 21 April 2026, not Drive's July 2024",
    isoDay(dateFromDocument({ title: rulesTitle })) === "2026-04-21",
    isoDay(dateFromDocument({ title: rulesTitle })),
);
check(
    "the enacting clause dates it the same way",
    isoDay(dateFromDocument({ title: rulesTitle, content: rulesHeader })) ===
        "2026-04-21",
);
check(
    "a US-order caption 04.21.26 is April, not 4 January",
    isoDay(dateFromDocument({ title: "{S-B.26-27 04.21.26-1}" })) === "2026-04-21",
    isoDay(dateFromDocument({ title: "{S-B.26-27 04.21.26-1}" })),
);
check(
    "a title with no date is not invented from a session year",
    dateFromDocument({ title: "S.B.26-27 Rules Bill" }) === null,
);

console.log("\nclassifyDocument");
check(
    "a Rules Bill is senate rules, not a generic bill",
    classifyDocument({ name: rulesTitle, folderPath: "" }) === "bill.senate_rules",
);

console.log(failures === 0 ? "\nall checks passed" : `\n${failures} failure(s)`);
process.exitCode = failures === 0 ? 0 : 1;
