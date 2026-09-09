/**
 * Checks that an agenda and the minutes written from it land on one key, and
 * that nothing else does. Every title below is a real one from the archive.
 */
import { meetingFor, meetingLog, meetingNumber, type Meeting } from "../lib/meetings";

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
const EXEC_MINUTES = "Executive Branch/Minutes for Exec Meetings";
const IA = "Senate/Committees/Internal Affairs";

const CE = "Senate/Committees/Civic Engagement";

const at = (
    title: string,
    folderPath: string,
    sessionNumber = 113,
    driveCreatedTime?: Date,
): Meeting => meetingFor({ title, folderPath, sessionNumber, driveCreatedTime });

console.log("meeting numbers");

check("a hash number is the meeting number", meetingNumber("Senate GBM #13") === 13);
check(
    "the session ordinal is not the meeting number",
    meetingNumber("112th SGA Senate Meeting 7") === 7,
    meetingNumber("112th SGA Senate Meeting 7"),
);
check(
    "a trailing number counts",
    meetingNumber("MINUTES senate 3") === 3,
    meetingNumber("MINUTES senate 3"),
);
check("a template has no number", meetingNumber("[TEMPLATE] Senate Meeting #X") === null);
check(
    "an academic year is not a meeting number",
    meetingNumber("JHU SGA Bylaws 2026-2027") === null,
    meetingNumber("JHU SGA Bylaws 2026-2027"),
);
check(
    "a dated meeting is keyed by its date, not a stray number",
    meetingNumber("08.04.2026 Internal Affairs Committee Meeting Minutes") === null,
);
check(
    "a yearless slash date is not read as a meeting number",
    meetingNumber("Exec Deans Meeting_4/27") === null,
    meetingNumber("Exec Deans Meeting_4/27"),
);
check(
    "a decimal ordinal survives the date rules",
    meetingNumber("Exec Minutes 26.1") === 26,
    meetingNumber("Exec Minutes 26.1"),
);

console.log("\npairing");

const agenda = at("Senate GBM #13", GBM_AGENDAS);
const minutes = at("MINUTES of  Senate GBM #13", GBM_MINUTES);

check("the agenda is an agenda", agenda.role === "agenda", agenda);
check("the minutes are minutes", minutes.role === "minutes", minutes);
check(
    "both halves of one meeting share a key",
    agenda.key === minutes.key && agenda.key === "113:senate:13",
    [agenda, minutes],
);

// The 114th titles its minutes without naming the body at all.
check(
    "a bare 'MINUTES #1' pairs with 'Senate GBM #1'",
    at("Senate GBM #1", GBM_AGENDAS, 114).key === at("MINUTES #1", GBM_MINUTES, 114).key,
    [at("Senate GBM #1", GBM_AGENDAS, 114), at("MINUTES #1", GBM_MINUTES, 114)],
);

check(
    "a differently-worded series still pairs",
    at(" Senate Meeting #17", GBM_AGENDAS, 112).key === "112:senate:17",
    at(" Senate Meeting #17", GBM_AGENDAS, 112),
);

console.log("\nthings that must not pair");

check(
    "different sessions never share a key",
    at("Senate GBM #13", GBM_AGENDAS, 113).key !==
    at("Senate GBM #13", GBM_AGENDAS, 112).key,
);
check(
    "a copy is excluded, so the agenda side stays unambiguous",
    at("Copy of Senate GBM #15", GBM_AGENDAS).key === "",
    at("Copy of Senate GBM #15", GBM_AGENDAS),
);
check(
    "templates are excluded",
    at("MINUTES Template", GBM_MINUTES).key === "" &&
    at("Agenda Item Template", GBM_AGENDAS).key === "" &&
    at("[TEMPLATE] Senate Meeting #X", GBM_AGENDAS).key === "",
);
check(
    "a governing document is not a meeting",
    at("JHU SGA Bylaws 2026-2027", "Guiding Documents", 114).key === "",
    at("JHU SGA Bylaws 2026-2027", "Guiding Documents", 114),
);
check(
    "a bill is not a meeting",
    at("RSO Finance Workshop Funding Bill", "Senate/Bills").key === "",
    at("RSO Finance Workshop Funding Bill", "Senate/Bills"),
);

console.log("\nbodies");

// Exec documents all sit in one "Minutes for Exec Meetings" folder, so they
// are minutes with no agenda counterpart -- which is the correct answer.
const exec = at("Executive Meeting #10", EXEC_MINUTES);
check("the folder overrides a title that says nothing", exec.role === "minutes", exec);
check("exec meetings key to the executive", exec.key === "113:executive:10", exec);
check(
    "a senate meeting and an exec meeting with the same number differ",
    at("Senate GBM #10", GBM_AGENDAS).key !== exec.key,
);

// The Board numbers its summer meetings from one again, so the 113th holds
// both an "EXECUTIVE MEETING #2" and an "EXECUTIVE SUMMER MEETING #2".
const summer = at("EXECUTIVE SUMMER MEETING #2", EXEC_MINUTES);
check(
    "a summer exec meeting is not the same meeting as #2 of the term",
    summer.key === "113:executive:summer:2" &&
    summer.key !== at("EXECUTIVE MEETING #2", EXEC_MINUTES).key,
    [summer, at("EXECUTIVE MEETING #2", EXEC_MINUTES)],
);
check(
    "the 114th's 'Sum Exec' is read as the same series",
    at("Sum Exec Minutes 4", "Executive Branch/Minutes for Executive Meeting", 114).key ===
    "114:executive:summer:4",
    at("Sum Exec Minutes 4", "Executive Branch/Minutes for Executive Meeting", 114),
);

// Meetings with the advisors, the deans or the University President are
// minuted into the Board's folder but are not part of its numbered series.
check(
    "a meeting with the advisors is not folded into the Board's series",
    at("March 10 2025 Exec x Advisor Meeting", EXEC_MINUTES, 112).key === "",
    at("March 10 2025 Exec x Advisor Meeting", EXEC_MINUTES, 112),
);
check(
    "nor is a deans meeting",
    at("SGA Meet with the Deans Agenda", EXEC_MINUTES).key === "",
    at("SGA Meet with the Deans Agenda", EXEC_MINUTES),
);

const committee = at(
    "IA.114.02 - 09.06.2026 Internal Affairs Committee Meeting Minutes",
    IA,
    114,
);
check(
    "a committee keys to its own folder and date",
    committee.key === "114:committee:internal affairs:2026-09-06",
    committee,
);
check(
    // Civic Engagement dates the file and never says "minutes"; Internal
    // Affairs always does. Both are that committee's minutes.
    "a committee meeting that does not call itself minutes is still keyed",
    at("CE June 15 2026 (CSC Summer Meeting 1)", CE, 114).key ===
    "114:committee:civic engagement:2026-06-15" &&
    at("CE June 15 2026 (CSC Summer Meeting 1)", CE, 114).role === "minutes",
    at("CE June 15 2026 (CSC Summer Meeting 1)", CE, 114),
);
check(
    "a working document in the same folder is not a meeting",
    at("CEC Initiatives Working Doc", CE).key === "",
    at("CEC Initiatives Working Doc", CE),
);
check(
    "a misspelled month is still a date",
    at("CE Meeting Minutes - 22 Feburary 2026", CE).key ===
    "113:committee:civic engagement:2026-02-22",
    at("CE Meeting Minutes - 22 Feburary 2026", CE),
);
check(
    "a one-off exec meeting is not folded into the numbered series",
    at("Exec Deans Meeting_4/27", EXEC_MINUTES).key === "",
    at("Exec Deans Meeting_4/27", EXEC_MINUTES),
);

console.log("\nthe year a title leaves out");

// "14 September" and "9/3" are dates missing only the year, and the year is
// what Drive knows.
check(
    "with nothing to date it against, a yearless title stays unkeyed",
    at("CE Meeting Minutes - 14 September", CE).key === "",
    at("CE Meeting Minutes - 14 September", CE),
);
check(
    "the file's creation date supplies the year",
    at("CE Meeting Minutes - 14 September", CE, 113, new Date("2025-09-14T00:00:00Z")).key ===
    "113:committee:civic engagement:2025-09-14",
    at("CE Meeting Minutes - 14 September", CE, 113, new Date("2025-09-14T00:00:00Z")),
);
check(
    "so does it for a slash date",
    at(
        "Student Services Meeting Mins 9/3",
        "Senate/Committees/Student Services/Meeting Minutes",
        114,
        new Date("2026-09-03T00:00:00Z"),
    ).key === "114:committee:student services:2026-09-03",
);
check(
    "a September meeting minuted the January after takes the earlier year",
    at("CE Meeting Minutes - 14 December", CE, 113, new Date("2026-01-06T00:00:00Z")).key ===
    "113:committee:civic engagement:2025-12-14",
    at("CE Meeting Minutes - 14 December", CE, 113, new Date("2026-01-06T00:00:00Z")),
);
check(
    "a creation date months away dates nothing",
    at("CE Meeting Minutes - 14 September", CE, 113, new Date("2026-03-01T00:00:00Z")).key === "",
    at("CE Meeting Minutes - 14 September", CE, 113, new Date("2026-03-01T00:00:00Z")),
);

console.log("\nrunning logs");

// Several committees type every meeting of the year into one file, which names
// no meeting and so falls out of everything above.
const HSS = "Senate/Committees/Health, Safety and Sustainability";

const log = meetingLog({
    title: "HSS Meeting Notes 2025-2026",
    folderPath: HSS,
    sessionNumber: 113,
    content: [
        "Committee on Health, Safety, and Sustainability MEETING \\#1 **7 SEPTEMBER 2025**",
        "ATTENDANCE",
        "Zoe Gaillard, Zaynab Mirza",
        "Committee on Health, Safety, and Sustainability MEETING \\#2 **14 SEPTEMBER 2025**",
        "ATTENDANCE",
        "Zoe Gaillard",
    ].join("\n"),
});
check("a file holding several meetings is a log", log?.meetings === 2, log);
check("the log knows whose meetings they are", log?.body === "committee:health safety and sustainability", log);
check(
    "the attendance it keeps says it is minutes, though the title does not",
    log?.role === "minutes",
    log,
);

check(
    "an ordinal day is a date, so the heading counts",
    meetingLog({
        title: "Civic Engagement Fall 2026 Weekly Minutes",
        folderPath: CE,
        sessionNumber: 114,
        content: [
            "# Meeting \\#1: September 3rd, 2026 / 6:30 PM / CSC 3rd Floor",
            "**Present**: JM, SB",
            "# Meeting \\#2: September 10th, 2026 / 6:30 PM / CSC 3rd Floor",
            "**Present**: JM",
        ].join("\n"),
    })?.meetings === 2,
);

check(
    "one meeting in a file is that meeting, not a log of it",
    meetingLog({
        title: "CE June 15 2026 (CSC Summer Meeting 1)",
        folderPath: CE,
        sessionNumber: 114,
        content: "Date: June 15th, 2026\nStudents Present: Jackson Morris",
    }) === null,
);

// Minutes are drafted by copying the last set, and several in the archive
// still carry the heading of the meeting they were copied from.
check(
    "a document that names its own meeting is never a log",
    meetingLog({
        title: "Minutes of Senate GBM #4",
        folderPath: GBM_MINUTES,
        sessionNumber: 113,
        content:
            "September 2, 2025 / 07:00 PM / Hackerman Hall\nPresent: everyone\n" +
            "April 16, 2024 / 07:00 PM / Scott-Bates Commons Salon B",
    }) === null,
);

check(
    "a working document keeps no attendance and is no log",
    meetingLog({
        title: "CEC Initiatives Working Doc",
        folderPath: CE,
        sessionNumber: 113,
        content: "Background:\n9/15 talk to the CSC\n10/2 draft the bill",
    }) === null,
);

console.log(failures === 0 ? "\nall checks passed" : `\n${failures} failure(s)`);
process.exitCode = failures === 0 ? 0 : 1;
