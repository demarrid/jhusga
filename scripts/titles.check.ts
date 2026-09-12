/**
 * Checks that display titles tidy real filenames without inventing or losing
 * anything, and that a rename is abandoned when it would collide.
 */
import { canonicalTitle, cleanTitle, standardTitles } from "../lib/titles";

let failures = 0;
function check(label: string, condition: boolean, detail?: unknown) {
    if (condition) {
        console.log(`  ok   ${label}`);
    } else {
        failures += 1;
        console.log(`  FAIL ${label}`, detail ?? "");
    }
}

const GBM_AGENDAS = "General SGA/General Body Meetings/Agenda Items";
const GBM_MINUTES = "General SGA/General Body Meetings/Minutes";
const EXEC = "Executive Branch/Minutes for Exec Meetings";
const CE = "Senate/Committees/Civic Engagement";

const on = (iso: string) => new Date(`${iso}T16:00:00Z`);

console.log("cleaning");

check("leading and doubled spaces go", cleanTitle(" Senate GBM  #13 ") === "Senate GBM #13");
check(
    "shouting is undone but acronyms survive",
    cleanTitle("MINUTES of Senate GBM #14") === "Minutes of Senate GBM #14",
    cleanTitle("MINUTES of Senate GBM #14"),
);
check(
    "a fully shouted title comes back readable",
    cleanTitle("EXEC x PRESIDENT DANIELS LUNCH AGENDA") ===
    "Exec x President Daniels Lunch Agenda",
    cleanTitle("EXEC x PRESIDENT DANIELS LUNCH AGENDA"),
);
check(
    // The reason re-casing is restricted to shouting titles.
    "a correctly cased title is left alone",
    cleanTitle("JHU SGA Bylaws 2025-2026") === "JHU SGA Bylaws 2025-2026",
    cleanTitle("JHU SGA Bylaws 2025-2026"),
);
check(
    "a short acronym title is not mangled",
    cleanTitle("114th SGA Roster") === "114th SGA Roster",
    cleanTitle("114th SGA Roster"),
);
check(
    "a bracketed word is capitalised, not left lowercase",
    cleanTitle("[TEMPLATE] Committee Meeting Minutes") ===
    "[Template] Committee Meeting Minutes",
    cleanTitle("[TEMPLATE] Committee Meeting Minutes"),
);
check(
    "a listed acronym survives even at four letters",
    cleanTitle("Questions for SHWB") === "Questions for SHWB",
    cleanTitle("Questions for SHWB"),
);
check(
    // Two short acronyms hyphenated together are not one long shout.
    "a hyphenated acronym is not un-shouted",
    cleanTitle("Important Changes to SGA-FC guidelines") ===
    "Important Changes to SGA-FC guidelines",
    cleanTitle("Important Changes to SGA-FC guidelines"),
);
check(
    "a bill number keeps its case",
    cleanTitle("SGA-R-1718.08 - SGA Powers and Authorities Resolution") ===
    "SGA-R-1718.08 - SGA Powers and Authorities Resolution",
    cleanTitle("SGA-R-1718.08 - SGA Powers and Authorities Resolution"),
);
check(
    // Bills naming a student group are how most groups reach the archive.
    "a group's name is an acronym, not a person's name",
    cleanTitle("JHUMA Funding Bill Fall 2026") === "JHUMA Funding Bill Fall 2026",
    cleanTitle("JHUMA Funding Bill Fall 2026"),
);

console.log("\ncanonical meeting names");

const canon = (
    title: string,
    folderPath: string,
    sessionNumber = 113,
    driveCreatedTime: Date | null = on("2025-11-04"),
) =>
    canonicalTitle({ id: title, title, folderPath, sessionNumber, driveCreatedTime });

check(
    "an agenda gets the house style, dated",
    canon("Senate GBM #23", GBM_AGENDAS) ===
    "Senate General Body Meeting #23 — Agenda (11/04/25)",
    canon("Senate GBM #23", GBM_AGENDAS),
);
check(
    "its minutes get the matching name",
    canon("MINUTES of  Senate GBM #23", GBM_MINUTES) ===
    "Senate General Body Meeting #23 — Minutes (11/04/25)",
    canon("MINUTES of  Senate GBM #23", GBM_MINUTES),
);
check(
    "a differently-worded series lands in the same style",
    canon("112th SGA Senate Meeting 7", GBM_AGENDAS, 112) ===
    "Senate General Body Meeting #7 — Agenda (11/04/25)",
    canon("112th SGA Senate Meeting 7", GBM_AGENDAS, 112),
);
check(
    "a misspelling is corrected by the rename",
    canon("Exective Meeting #1 Minutes", EXEC) ===
    "Executive Board Meeting #1 — Minutes (11/04/25)",
    canon("Exective Meeting #1 Minutes", EXEC),
);
check(
    // The summer board numbers its own meetings, so #2 of one series is not
    // #2 of the other.
    "a summer executive meeting says so",
    canon("EXECUTIVE SUMMER MEETING #2", EXEC) ===
    "Summer Executive Board Meeting #2 — Minutes (11/04/25)",
    canon("EXECUTIVE SUMMER MEETING #2", EXEC),
);
check(
    "the 114th's abbreviation for it is read the same way",
    canon("Sum Exec Minutes 4", "Executive Branch/Minutes for Executive Meeting", 114) ===
    "Summer Executive Board Meeting #4 — Minutes (11/04/25)",
    canon("Sum Exec Minutes 4", "Executive Branch/Minutes for Executive Meeting", 114),
);
check(
    "a dated committee meeting is dated from its own filename, not from Drive",
    canon(
        "IA.114.02 - 09.06.2026 Internal Affairs Committee Meeting Minutes",
        "Senate/Committees/Internal Affairs",
        114,
    ) === "Internal Affairs Committee Meeting — Minutes (09/06/26)",
    canon(
        "IA.114.02 - 09.06.2026 Internal Affairs Committee Meeting Minutes",
        "Senate/Committees/Internal Affairs",
        114,
    ),
);
check(
    // Civic Engagement files this as "CE June 15 2026" with no "minutes" in
    // the title; Internal Affairs always writes "Meeting Minutes". Same kind
    // of document, so the same name.
    "a committee meeting that does not call itself minutes is still one",
    canon("CE June 15 2026 (CSC Summer Meeting 1)", CE, 114, on("2026-06-15")) ===
    "Civic Engagement Committee Meeting — Minutes (06/15/26)",
    canon("CE June 15 2026 (CSC Summer Meeting 1)", CE, 114, on("2026-06-15")),
);
check(
    // Filed under Internal Affairs by the senator who took them, which had it
    // published as that committee's minutes -- a meeting it was not.
    "minutes of a Senate meeting kept in a committee folder are named for the Senate",
    canon(
        "Demarri's Senate GBM Minutes - 9/8",
        "Senate/Committees/Internal Affairs/Senate Minutes",
        114,
        on("2026-09-08"),
    ) === "Senate General Body Meeting — Minutes (09/08/26)",
    canon(
        "Demarri's Senate GBM Minutes - 9/8",
        "Senate/Committees/Internal Affairs/Senate Minutes",
        114,
        on("2026-09-08"),
    ),
);
check(
    "a meeting Drive cannot date still gets the house style",
    canon("Senate GBM #23", GBM_AGENDAS, 113, null) ===
    "Senate General Body Meeting #23 — Agenda",
    canon("Senate GBM #23", GBM_AGENDAS, 113, null),
);
check("a bill is not a meeting and is not renamed", canon("Funding Bill Jay-Fil-a", "Senate/Bills") === null);
check(
    // Renaming it "Executive Board Meeting" would file a meeting with the
    // University's advisors as one of the Board's own.
    "an exec meeting with outsiders keeps its filename",
    canon("March 10 2025 Exec x Advisor Meeting", EXEC, 112) === null,
    canon("March 10 2025 Exec x Advisor Meeting", EXEC, 112),
);

console.log("\nrunning logs of meetings");

// Half the committees keep one file per meeting and half keep one file for all
// of them. Both are that committee's minutes, so both are named that way.
const logged = (title: string, folderPath: string, content: string, sessionNumber = 113) =>
    canonicalTitle({
        id: title,
        title,
        folderPath,
        sessionNumber,
        driveCreatedTime: null,
        content,
    });

const HSS_LOG = [
    "Committee on Health, Safety, and Sustainability MEETING \\#1 **7 SEPTEMBER 2025**",
    "ATTENDANCE",
    "Zoe Gaillard",
    "Committee on Health, Safety, and Sustainability MEETING \\#2 **14 SEPTEMBER 2025**",
    "ATTENDANCE",
    "Zaynab Mirza",
].join("\n");

check(
    "a whole session of meetings in one file is named for the committee and the session",
    logged("HSS Meeting Notes 2025-2026", "Senate/Committees/Health, Safety and Sustainability", HSS_LOG) ===
    "Health, Safety and Sustainability Committee Meeting — Minutes (113th Session)",
    logged("HSS Meeting Notes 2025-2026", "Senate/Committees/Health, Safety and Sustainability", HSS_LOG),
);
check(
    // The complaint that prompted the rule: one committee's minutes read as a
    // dated series while the next committee's kept whatever the author typed.
    "so it sits under the same name as the committee that files one per meeting",
    logged(
        "Civic Engagement Fall 2026 Weekly Minutes",
        CE,
        "# Meeting \\#1: September 3rd, 2026\n**Present**: JM\n# Meeting \\#2: September 10th, 2026\n**Present**: SB",
        114,
    ) === "Civic Engagement Committee Meeting — Minutes (114th Session)",
    logged(
        "Civic Engagement Fall 2026 Weekly Minutes",
        CE,
        "# Meeting \\#1: September 3rd, 2026\n**Present**: JM\n# Meeting \\#2: September 10th, 2026\n**Present**: SB",
        114,
    ),
);
check(
    "a file holding one meeting is dated instead, not stamped with a session",
    logged("CE Meeting Minutes - 7 September 2025", CE, "Date: 7 September 2025\nPresent: Chair") ===
    "Civic Engagement Committee Meeting — Minutes (09/07/25)",
    logged("CE Meeting Minutes - 7 September 2025", CE, "Date: 7 September 2025\nPresent: Chair"),
);
check(
    "a tracker the committee keeps is not its minutes",
    logged("CEC Initiatives Working Doc", CE, "Background:\n9/15 talk to the CSC\n10/2 draft it") === null,
);

console.log("\nstanding documents");

const standing = (title: string, sessionNumber = 114) =>
    canonicalTitle({
        id: title,
        title,
        folderPath: "Guiding Documents",
        sessionNumber,
        driveCreatedTime: null,
    });

check(
    "the bylaws are named for what they are and stamped with the session",
    standing("JHU SGA Bylaws 2026-2027") === "JHU SGA Bylaws (114th Session)",
    standing("JHU SGA Bylaws 2026-2027"),
);
check(
    "a prior session's copy lines up beside it",
    standing("JHU SGA Bylaws", 112) === "JHU SGA Bylaws (112th Session)",
    standing("JHU SGA Bylaws", 112),
);
check(
    "the sort digit an officer typed to pin the file to the top is dropped",
    standing("2Official SGA Attendance Sheet (2026-2027)") ===
    "SGA Attendance Sheet (114th Session)",
    standing("2Official SGA Attendance Sheet (2026-2027)"),
);
check(
    "the roster and the contact list get one name each",
    standing("114th SGA Roster") === "SGA Roster (114th Session)" &&
    standing("114th email list") === "SGA Contact List (114th Session)",
    [standing("114th SGA Roster"), standing("114th email list")],
);
check(
    // The whole risk of the rule: an amendment is not the thing it amends.
    "a document that merely mentions the bylaws is left alone",
    standing("JHU SGA Bylaws (Amended April 2026)") === null &&
    standing("SGA Bylaws Omnibus Update 2026") === null &&
    standing("IA Revisions of JHU SGA Bylaws April 2024") === null,
    [
        standing("JHU SGA Bylaws (Amended April 2026)"),
        standing("SGA Bylaws Omnibus Update 2026"),
        standing("IA Revisions of JHU SGA Bylaws April 2024"),
    ],
);
check(
    "a copy is not presented as the session's own",
    standing("Copy of Constitution Updates 2025", 112) === null,
);

console.log("\ndates come from the meeting, not the file");

// The agenda is drafted the day before; the minutes are typed in the room.
const pair = standardTitles([
    {
        id: "agenda",
        title: "Senate GBM #13",
        folderPath: GBM_AGENDAS,
        sessionNumber: 113,
        driveCreatedTime: on("2025-11-03"),
    },
    {
        id: "minutes",
        title: "MINUTES of Senate GBM #13",
        folderPath: GBM_MINUTES,
        sessionNumber: 113,
        driveCreatedTime: on("2025-11-04"),
    },
]);

check(
    "both halves of one meeting show the meeting's date",
    pair.get("agenda") === "Senate General Body Meeting #13 — Agenda (11/04/25)" &&
    pair.get("minutes") === "Senate General Body Meeting #13 — Minutes (11/04/25)",
    [pair.get("agenda"), pair.get("minutes")],
);

console.log("\ncollisions");

const documents = [
    {
        id: "bylawsA",
        title: "JHU SGA Bylaws 2026-2027",
        folderPath: "Guiding Documents",
        sessionNumber: 114,
        driveCreatedTime: null,
    },
    {
        id: "bylawsB",
        title: "JHU SGA Bylaws 2026-2027",
        folderPath: "Guiding Documents",
        sessionNumber: 114,
        driveCreatedTime: null,
    },
    {
        id: "gbm23a",
        title: " Senate GBM #23",
        folderPath: GBM_AGENDAS,
        sessionNumber: 113,
        driveCreatedTime: on("2026-03-10"),
    },
    {
        id: "gbm23m",
        title: "MINUTES of Senate GBM #23",
        folderPath: GBM_MINUTES,
        sessionNumber: 113,
        driveCreatedTime: on("2026-03-10"),
    },
];

const titles = standardTitles(documents);

check(
    // Both canonicalise to "JHU SGA Bylaws (114th Session)", so neither may:
    // naming them alike would assert the two files are one document.
    "two documents that would share a name keep their own filenames",
    titles.get("bylawsA") === "JHU SGA Bylaws 2026-2027" &&
    titles.get("bylawsB") === "JHU SGA Bylaws 2026-2027",
    [titles.get("bylawsA"), titles.get("bylawsB")],
);
check(
    "an unambiguous pair is still renamed",
    titles.get("gbm23a") === "Senate General Body Meeting #23 — Agenda (03/10/26)" &&
    titles.get("gbm23m") === "Senate General Body Meeting #23 — Minutes (03/10/26)",
    [titles.get("gbm23a"), titles.get("gbm23m")],
);
check(
    "every document gets some title",
    documents.every((document) => (titles.get(document.id) ?? "").length > 0),
);

console.log(failures === 0 ? "\nall checks passed" : `\n${failures} failure(s)`);
process.exitCode = failures === 0 ? 0 : 1;
