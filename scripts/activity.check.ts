/**
 * What the home carousel is willing to call recent.
 *
 * The fixtures are shortened from the way Senate minutes actually record a
 * vote: a motion on its own line, the result indented under it, and a
 * committee recommendation that must not be mistaken for passage.
 */

import {
    activityDate,
    latestMinutesEntry,
    latestMinutesSummary,
    authorLine,
    collectiveResolutionAuthor,
    isHomepageHighlight,
    calendarDay,
    chooseMeetings,
    countsAsSenateRecord,
    hasOccurred,
    legislationLane,
    passedLegislation,
    recordedResolutionPassage,
} from "../lib/activity";

let failures = 0;

check("combined card uses the last summary bullet without formatting or citation markers",
    latestMinutesSummary({status: "fresh", content: "- Earlier meeting. [1]\n- **October 14:** Discussed housing access. [2]"}) === "October 14: Discussed housing access.");
check("paragraph summaries use their closing sentence",
    latestMinutesSummary({status: "stale", content: "Earlier meetings covered dining. The latest meeting addressed housing."}) === "The latest meeting addressed housing.");
check("unavailable summaries remain empty", latestMinutesSummary(null) === "" && latestMinutesSummary({status: "pending", content: "Unpublished."}) === "");

const rolling = { content: "# 9/3\n\nNotes\n\n# 10/14\n\nMeeting Minutes: 10/1\n\nUpdates\n\n# 10/21\n\nFuture notes", sessionNumber: 114 };
const latest = latestMinutesEntry(rolling, new Date("2026-10-14T20:00:00Z"));
check("combined minutes use the latest occurred heading, ignoring stale captions and future entries",
    latest?.when.toISOString().startsWith("2026-10-14") === true
    && latest.sectionId === `section-${rolling.content.indexOf("# 10/14")}`);
check("yearless combined minutes need an archived session", latestMinutesEntry({ ...rolling, sessionNumber: null }, new Date()) === null);
check("combined minutes use the spring year of their academic session",
    latestMinutesEntry({ content: "# 12/3\n\nNotes\n\n# 1/14\n\nNotes", sessionNumber: 114 }, new Date("2027-01-15T20:00:00Z"))?.when.toISOString().startsWith("2027-01-14") === true);

function check(label: string, condition: boolean, detail?: unknown) {
    if (condition) {
        console.log(`  ok   ${label}`);
    } else {
        failures += 1;
        console.log(`  FAIL ${label}`, detail ?? "");
    }
}

function ids(content: string): string[] {
    return passedLegislation(content).map((item) => item.fileId);
}

const doc = (id: string) => `https://docs.google.com/document/d/${id}/edit`;

console.log("passage");

const secondReading = `
8. ## **Second Reading (10 min)**

1. [Nutrition Tabling Supplies Funding Bill](${doc("NUTRITIONBILLID123456")}) \\- HSS Chair
   1. Nutrition infographics
   2. Demarri : Motion to pass bill, passed
2. [Sexual Assault Awareness Tabling](${doc("ASSAULTBILLID12345678")})
   1. Banner that students can sign
   2. Passed with positive recommendation from finance committee
   3. Motion
3. [Black Jays 90s Photoshoot Funding Bill](${doc("BLACKJAYSBILLID123456")})
   1. Demarri: Motion to pass bill, passed
`;

check(
    "a motion to pass the bill is passage",
    ids(secondReading).includes("NUTRITIONBILLID123456"),
    ids(secondReading),
);
check(
    "a committee recommendation is not passage",
    !ids(secondReading).includes("ASSAULTBILLID12345678"),
    ids(secondReading),
);
check(
    "the next bill's vote is not borrowed",
    ids(secondReading).includes("BLACKJAYSBILLID123456"),
);

const splitResult = `
   1. [Survey Tabling Bill](${doc("SURVEYBILLID123456789")}) \\- Veda
      1. Peter: Motion to table until next week, passed
   1. [Tabling supplies funding bill](${doc("TABLINGBILLID12345678")})
      1. Passed finance with positive recommendation
      5. Aishani: motion to pass
         1. passed
   2. *[Freedom of Expression Directive (Resolution)](${doc("FREEDOMRESID123456789")})*
      5. Jackson: motion to vote to vote
         1. Passed
      6. Jackson: Motion to pass
         1. Passes
   3. [RSO Outreach Call to Action Funding Bill](${doc("RSOOUTREACHID12345678")})
      2. Jackson: Motion to strike section 3
         1. Passes
      5. Demarri: motion to pass
         1. Passes
`;

check("tabling a bill does not pass it", !ids(splitResult).includes("SURVEYBILLID123456789"), ids(splitResult));
check("a result indented under the motion counts", ids(splitResult).includes("TABLINGBILLID12345678"));
check("a resolution recorded as passed counts", ids(splitResult).includes("FREEDOMRESID123456789"));
check(
    "an amendment passing is not the bill passing, but the later motion is",
    ids(splitResult).includes("RSOOUTREACHID12345678"),
);

const amendmentOnly = `
1. [Only Amended](${doc("ONLYAMENDEDID1234567")})
   2. Jackson: Motion to strike the date
      1. Passes
`;

check("an amendment alone does not pass the bill", ids(amendmentOnly).length === 0, ids(amendmentOnly));
for (const line of ["Motion to pass the amendment, passed", "Motion to pass, not passed",
    "Bill never passed", "Motion to pass in finance committee, passed"]) {
    const content = `1. [Draft Bill](${doc("DRAFTBILLID123456789")})\n   1. ${line}`;
    check(`${line} does not record Senate passage`, ids(content).length === 0, ids(content));
}

const noResult = `
   2. [JHUMA Funding Bill](${doc("JHUMAFUNDINGID1234567")})
      1. Passed in finance committee
      2. Jason: motion to pass
   3. ClerPa
`;

check("a motion with no result is not passage", ids(noResult).length === 0, ids(noResult));

const explicit = `
1. [Rules Bill](${doc("RULESBILLID1234567890")})
   4. Bill passes!
2. [Bad Bill](${doc("BADBILLID12345678901")})
   1. Cole: motion to pass, failed
3. [Retreat Bill](${doc("FALLRETREATID12345678")})
   2. Demarri: motion to tabled indefinitely, passed
4. [Library Hours](${doc("LIBRARYHOURS123456789")})
   1. Passes to finance committee
`;

check("bill passes is passage", ids(explicit).includes("RULESBILLID1234567890"), ids(explicit));
check("a failed motion is not passage", !ids(explicit).includes("BADBILLID12345678901"));
check("tabling indefinitely is not passage", !ids(explicit).includes("FALLRETREATID12345678"));
check("passing a bill on to committee is not passage", !ids(explicit).includes("LIBRARYHOURS123456789"));

const prefixed = `
1. a. [Survey Tabling Bill](${doc("SURVEYBILLID123456789")}) \\- Veda
   1. passed finance committee with negative recommendations
   7. Cole: motion to pass, demarri opposes
      1. passed
`;

check("a lettered heading still belongs to its bill", ids(prefixed).includes("SURVEYBILLID123456789"), ids(prefixed));

const sameLine = `
5. [Crab Fest Funding Bill](${doc("CRABFESTBILLID1234567")})
   5. RC: motion to pass, passes
`;

check("passed on the motion's own line counts", ids(sameLine).includes("CRABFESTBILLID1234567"));

const safelink = `
1. [Crab Fest](https://nam02.safelinks.protection.outlook.com/?url=https%3A%2F%2Fdocs.google.com%2Fdocument%2Fd%2FCRABFESTBILLID123456%2Fedit&data=abc)
   1. RC: motion to pass, passes
`;

check("an outlook-wrapped drive link still resolves", ids(safelink).includes("CRABFESTBILLID123456"), ids(safelink));

console.log("lanes");

check(
    "a resolution in the title is a resolution",
    legislationLane({
        title: "JHU SGA Freedom of Expression Directive (Resolution)",
        kind: "bill.other",
        content: "A Bill this is not.",
    }) === "resolution",
);
check(
    "a captioned resolution is a resolution",
    legislationLane({
        title: "Student opinion",
        kind: "bill.other",
        content: "Senate of the SGA\n{ *S. Resolution 23-24, 1* }\nA Resolution Expressing Support",
    }) === "resolution",
);
check(
    "a funding bill stays a bill",
    legislationLane({
        title: "Canva Pro Funding Bill",
        kind: "bill.funding",
        content: "{ *S. Bill. 26-27* } An SGA Funding Bill. See S. Resolution 23-24 for the policy.",
    }) === "bill",
);
check(
    "a template is neither",
    legislationLane({ title: "Template: Resolution", kind: "template", content: "S. Resolution" }) === null,
);
check(
    "voting records are neither",
    legislationLane({ title: "114th SGA: Bill Voting Records", kind: "bill.other", content: "Name,Vote" }) === null,
);
check(
    "a presentation is neither",
    legislationLane({ title: "SGA Resolution", kind: "presentation", content: "" }) === null,
);

check("an unclassified resolution-named document is excluded", legislationLane({title: "Student Government Resolution regarding ICE", kind: "unknown"}) === null);

check("senior thank-you resolution remains outside homepage highlights", !isHomepageHighlight("1GfPEmdmayF7MwY4R1XQq9YKG3KzIdYz-D1NQr8yPvDo"));
check("other resolutions remain eligible", isHomepageHighlight("another-file"));
check("collective sign-off earns collective credit", collectiveResolutionAuthor("In solidarity with our students,\n\nThe 112th Student Government Association\nJohns Hopkins University") === "112th Student Government Association");
check("mentioning the body is not a signature", collectiveResolutionAuthor("The 112th Student Government Association considered this resolution.") === "");
check("named authors earn legislation credit", authorLine([{role:"author",name:"Honora Muratori"}]) === "Honora Muratori");

console.log("meetings");

const now = new Date("2026-10-13T20:00:00Z");

check("today has occurred", hasOccurred(new Date("2026-10-13T16:00:00Z"), now));
check("tomorrow has not occurred", !hasOccurred(new Date("2026-10-14T16:00:00Z"), now));
check("an earlier month still occurred", hasOccurred(new Date("2026-09-01T16:00:00Z"), now));
check(
    "a dated title is the meeting's day",
    calendarDay(activityDate({ title: "Senate General Body Meeting #2 — Minutes (09/01/26)", datedAt: null })!) ===
        "2026-09-01",
);

const official = {
    meetingKey: "114:senate:7",
    folderPath: "General SGA/General Body Meetings/Minutes",
    title: "Senate General Body Meeting #7 — Minutes (10/06/26)",
    when: Date.parse("2026-10-06T16:00:00Z"),
};
const personal = {
    meetingKey: "114:senate:7",
    folderPath: "Senate/Committees/Internal Affairs/Demarri's Folder/Senate Minutes",
    title: "Senate General Body Meeting — Minutes (10/06/26)",
    when: Date.parse("2026-10-06T16:00:00Z"),
};
const later = {
    meetingKey: "114:committee:ia",
    folderPath: "Senate/Committees/Internal Affairs/Committee Minutes",
    title: "Internal Affairs Committee Meeting — Minutes (10/11/26)",
    when: Date.parse("2026-10-11T16:00:00Z"),
};

const chosen = chooseMeetings([personal, official, later], 3);
check(
    "the body's own minutes win over another copy",
    chosen[1]?.title.startsWith("Senate General Body Meeting #7"),
    chosen.map((item) => item.title),
);
check("the newest meeting is first", chosen[0]?.title.startsWith("Internal Affairs"));

check(
    "a personal copy is not the senate record",
    !countsAsSenateRecord({
        kind: "minutes.senate",
        meetingRole: "minutes",
        title: personal.title,
        folderPath: personal.folderPath,
    }),
);
check(
    "official senate minutes are",
    countsAsSenateRecord({
        kind: "minutes.senate",
        meetingRole: "minutes",
        title: official.title,
        folderPath: official.folderPath,
    }),
);
check(
    "an agenda is not a meeting that occurred",
    !countsAsSenateRecord({
        kind: "minutes.senate",
        meetingRole: "agenda",
        title: "Senate General Body Meeting #8 — Agenda (10/13/26)",
        folderPath: "General SGA/General Body Meetings/Agenda Items",
    }),
);

check(
    "the introducer leads, and a sponsor who introduced is not named twice",
    authorLine([
        { role: "sponsor", name: "Isaac Zhang" },
        { role: "introducer", name: "Shreemann Patel" },
        { role: "sponsor", name: "Shreemann Patel" },
        { role: "present", name: "Honora Muratori" },
    ]) === "Shreemann Patel, Isaac Zhang",
);
check("a bill with nobody named has an empty byline", authorLine([]) === "");

check("completed resolution enactment verifies passage", recordedResolutionPassage("The Resolution hereby **PASSES** by a vote of **23** to **0** with **0** abstentions."));
check("flattened PDF enactment verifies passage", recordedResolutionPassage("Prior text. The Resolution hereby PASSES by a vote of 23 to 0 with 0 abstentions. Signature below."));
check("template votes do not verify passage", !recordedResolutionPassage("The Resolution hereby PASSES by a vote of XX to XX with XX abstentions."));
check("committee recommendation does not verify passage", !recordedResolutionPassage("The committee recommends passage by a vote of 5 to 0."));
check("losing tally does not verify passage", !recordedResolutionPassage("The Resolution hereby PASSES by a vote of 0 to 23 with 0 abstentions."));
console.log(failures === 0 ? "\nall checks passed" : `\n${failures} failure(s)`);
if (failures > 0) process.exit(1);
