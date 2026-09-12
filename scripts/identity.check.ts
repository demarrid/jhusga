/**
 * Checks that a document's own caption, not Drive createdTime, decides
 * which session it belongs to and when it was dated.
 */
import { sessionFromAcademicYearStart } from "../config/session";
import {
    dateFromDocument,
    documentDate,
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

// The 114th numbers its bills by session and date instead of academic year.
const accountabilityAct = [
    "**{ *S. Bill. 114.09.08.2026-1* }**",
    "**The Accountability Act**",
    "Introduced by: **Vice President of the Senate Shreemann Patel**",
    "Presented for First Reading this **8th** day of **September** in the year **2026**",
].join("\n");

check(
    "a bill numbered by session and date names its session",
    sessionFromDocument({ title: "The Accountability Act", content: accountabilityAct }) === 114,
    sessionFromDocument({ title: "The Accountability Act", content: accountabilityAct }),
);

// The report that prompted the rule: a 2019 document a 113th agenda links to.
const referendum = [
    "**Report on the 2018/2019 SGA Omnibus Referendum**",
    "Data analysis and report composition by Executive President AJ Tsang",
    "May 8th, 2019",
    "",
    "**INTRODUCTION AND CONTEXT**",
    "The most recent iteration of this effort derives from the April 2018 SGA",
    "Powers & Authorities Resolution.",
].join("\n");

check(
    "an academic year written with a slash is read like a hyphenated one",
    sessionFromDocument({ title: "Referendum", content: referendum }) === 106,
    sessionFromDocument({ title: "Referendum", content: referendum }),
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
check(
    "a 2019 report is the 106th's, not the 113th's that linked it",
    linkedSession({ title: "Referendum", content: referendum }, 113) === 106,
    linkedSession({ title: "Referendum", content: referendum }, 113),
);
check(
    // The only thing this one says about itself is the day it was written.
    "a date alone is enough to date a document out of the folder that linked it",
    linkedSession({ title: "Notes", content: "Minutes taken 12 March 2021\nPresent: nobody" }, 114) ===
    108,
    linkedSession({ title: "Notes", content: "Minutes taken 12 March 2021\nPresent: nobody" }, 114),
);
// A real file: filed as the 23-24 rules bill, and still saying 2022-2023 in the
// prose it was copied from.
const staleRulesBill = [
    "**{ S. BILL 23-24, 01 }**",
    "**A BILL ESTABLISHING THE 2022-2023 LEGISLATIVE**",
    "**SESSION RULES**",
    "CONSIDERED THIS 18TH DAY OF APRIL IN THE YEAR 2022",
].join("\n");

check(
    "the name a bill was filed under beats a year left in its prose",
    linkedSession({ title: "S.B.23-24.01 Rules Bill", content: staleRulesBill }, 113) === 111,
    linkedSession({ title: "S.B.23-24.01 Rules Bill", content: staleRulesBill }, 113),
);
check(
    // April 2022 is the 109th's academic year and the 110th's rules.
    "a document arguing with itself is not dated into a third session",
    linkedSession({ title: "Rules Bill", content: staleRulesBill }, 113) === 113,
    linkedSession({ title: "Rules Bill", content: staleRulesBill }, 113),
);
check(
    // June is the boundary, because the summer belongs to the incoming session.
    "a summer document belongs to the session about to sit",
    linkedSession({ title: "Notes", content: "Meeting of 15 June 2026\nPresent: everyone" }, 100) ===
    114,
    linkedSession({ title: "Notes", content: "Meeting of 15 June 2026\nPresent: everyone" }, 100),
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
check(
    // Bold one word at a time, which is how every caption in the archive is
    // written and how none of them used to be read.
    "a clause bolded mid-sentence is still a clause",
    isoDay(
        dateFromDocument({
            title: "JHUMA BBQ Funding Bill Fall 2026",
            content:
                "**{ *S. Bill. 26-27, XX*}**\nIntroduced by: Senior Class Senator Mamadou Thiam\n" +
                "Considering this **2nd** day of **September** in the year **2026**",
        }),
    ) === "2026-09-02",
    isoDay(
        dateFromDocument({
            title: "JHUMA BBQ Funding Bill Fall 2026",
            content:
                "**{ *S. Bill. 26-27, XX*}**\nIntroduced by: Senior Class Senator Mamadou Thiam\n" +
                "Considering this **2nd** day of **September** in the year **2026**",
        }),
    ),
);
check(
    "the day it got furthest is the day it is filed under",
    isoDay(
        dateFromDocument({
            title: "A Bill",
            content: [
                "Introduced this 1st day of March in the year 2026",
                "Presented for First Reading this 8th day of March in the year 2026",
                "Enacted this 22nd day of April in the year 2026",
            ].join("\n"),
        }),
    ) === "2026-04-22",
    isoDay(
        dateFromDocument({
            title: "A Bill",
            content: [
                "Introduced this 1st day of March in the year 2026",
                "Presented for First Reading this 8th day of March in the year 2026",
                "Enacted this 22nd day of April in the year 2026",
            ].join("\n"),
        }),
    ),
);
check(
    // Two ways the template gets filled in wrong that still say one thing.
    "a day typed into the month's blank is still the day",
    isoDay(
        dateFromDocument({
            title: "Fall Retreat Bill",
            content: "Considered this **the** day of **August 24th** in the year **2024**",
        }),
    ) === "2024-08-24",
    isoDay(
        dateFromDocument({
            title: "Fall Retreat Bill",
            content: "Considered this **the** day of **August 24th** in the year **2024**",
        }),
    ),
);
check(
    "a month moved into a clause of its own is still the month",
    isoDay(
        dateFromDocument({
            title: "SGA Graduation Funding Bill 2026",
            content: "CONSIDERED THE DAY OF  **31** IN THE MONTH OF **March** IN THE YEAR **2026**",
        }),
    ) === "2026-03-31",
    isoDay(
        dateFromDocument({
            title: "SGA Graduation Funding Bill 2026",
            content: "CONSIDERED THE DAY OF  **31** IN THE MONTH OF **March** IN THE YEAR **2026**",
        }),
    ),
);
check(
    "a clause with the blanks still in it dates nothing",
    dateFromDocument({
        title: "National Health Education Week Funding Bill",
        content: "Considered this **the** day of **XXX** in the year **2024**",
    }) === null,
    dateFromDocument({
        title: "National Health Education Week Funding Bill",
        content: "Considered this **the** day of **XXX** in the year **2024**",
    }),
);
check(
    "the 114th's own bill number carries the date",
    isoDay(dateFromDocument({ title: "S-B.114.09.08.2026-1 | The Accountability Act" })) ===
    "2026-09-08",
    isoDay(dateFromDocument({ title: "S-B.114.09.08.2026-1 | The Accountability Act" })),
);

console.log("\ndocumentDate");
check(
    "a report is dated by the byline under its title",
    isoDay(documentDate({ title: "Referendum", content: referendum })) === "2019-05-08",
    isoDay(documentDate({ title: "Referendum", content: referendum })),
);
check(
    "a sentence that mentions a date is not a byline",
    documentDate({
        title: "Notes",
        content: "Background\nThe committee met on 3 February 2026 to discuss it.",
    }) === null,
    documentDate({
        title: "Notes",
        content: "Background\nThe committee met on 3 February 2026 to discuss it.",
    }),
);
check(
    "the furniture around a meeting's byline does not disqualify it",
    isoDay(
        documentDate({
            title: "MINUTES senate 3",
            content: "**Senate General Body Meeting \\#3**\n*September 8th, 2026 | 07:00 PM EST | BSC 404*",
        }),
    ) === "2026-09-08",
    isoDay(
        documentDate({
            title: "MINUTES senate 3",
            content: "**Senate General Body Meeting \\#3**\n*September 8th, 2026 | 07:00 PM EST | BSC 404*",
        }),
    ),
);
check(
    "a title that dates the meeting still wins over the body",
    isoDay(
        documentDate({
            title: "CE Meeting Minutes - 22 February 2026",
            content: "Present: everyone\nLast time we met on 8 February 2026",
        }),
    ) === "2026-02-22",
    isoDay(
        documentDate({
            title: "CE Meeting Minutes - 22 February 2026",
            content: "Present: everyone\nLast time we met on 8 February 2026",
        }),
    ),
);

console.log("\nclassifyDocument");
check(
    "a Rules Bill is senate rules, not a generic bill",
    classifyDocument({ name: rulesTitle, folderPath: "" }) === "bill.senate_rules",
);

console.log(failures === 0 ? "\nall checks passed" : `\n${failures} failure(s)`);
process.exitCode = failures === 0 ? 0 : 1;
