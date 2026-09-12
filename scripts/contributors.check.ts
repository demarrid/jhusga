/**
 * Checks the two ingest cleanups: what markdown sanitisation removes, and who
 * the contributor parser is willing to name.
 *
 * The parser's failure mode that matters is a false positive -- inventing a
 * person, or promoting a template placeholder to a real one -- so most of these
 * assert that something is *not* extracted.
 */

import {
    extractContributors,
    nameKey,
} from "../lib/contributors";
import {
    givenNameCandidates,
    isShortForm,
    surnameCandidates,
    tokenCandidates,
    type RegularPerson,
} from "../lib/names";
import { deriveDescription, sanitizeExport, toPlainText } from "../lib/markdown";

let failures = 0;
function check(label: string, condition: boolean, detail?: unknown) {
    if (condition) {
        console.log(`  ok   ${label}`);
    } else {
        failures += 1;
        console.log(`  FAIL ${label}`, detail ?? "");
    }
}

console.log("sanitizeExport");

const withImages = [
    "# Bylaws",
    "",
    "![][image1]",
    "",
    "The Senate shall meet.",
    "",
    "[image1]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB>",
].join("\n");

const sanitized = sanitizeExport(withImages);
check("base64 image definitions are removed", !sanitized.includes("base64"));
check("inline image references are removed", !sanitized.includes("![]"));
check("real text survives", sanitized.includes("The Senate shall meet."));
check("headings survive", sanitized.includes("# Bylaws"));
check(
    "no run of blank lines is left behind",
    !/\n{3,}/.test(sanitized),
    JSON.stringify(sanitized),
);
check(
    "is idempotent",
    sanitizeExport(sanitized) === sanitized,
);
check(
    "a document with no images is untouched",
    sanitizeExport("# Title\n\nBody text.") === "# Title\n\nBody text.",
);

console.log("\ntoPlainText");
check(
    "links collapse to their text",
    toPlainText("See [the charter](https://example.com/x) now") ===
    "See the charter now",
);
check(
    "reference links collapse to their text",
    toPlainText("![][image1] BYLAWS OF THE SENATE") === "BYLAWS OF THE SENATE",
);
check(
    "escaped punctuation is unescaped",
    toPlainText("SECTION 1\\. TITLE") === "SECTION 1. TITLE",
);
check(
    "an empty image yields nothing",
    toPlainText("![]()") === "",
    JSON.stringify(toPlainText("![]()")),
);
check(
    "a leftover empty link yields nothing",
    toPlainText("~[]()") === "",
    JSON.stringify(toPlainText("~[]()")),
);
check(
    "a zoom invite is not used as a description",
    deriveDescription("3:30 PM EDT\n\n[Join Zoom Meeting](https://zoom.us/j/1)\n\nThe committee convened.") ===
    "The committee convened.",
);
check(
    "a flattened attendance header is not used as a description",
    deriveDescription("Attendance Absent Excused Present Faculty\n\nTabling tomorrow at democracy day.") ===
    "Tabling tomorrow at democracy day.",
);
check(
    "runs of stray brackets are dropped",
    toPlainText("Room assignment template\\]\\]\\]\\]") ===
    "Room assignment template",
    JSON.stringify(toPlainText("Room assignment template\\]\\]\\]\\]")),
);
check(
    "a heading nested in a list item loses its marker",
    toPlainText("1. ## **Call to Order and Attendance (1 min)**") ===
    "Call to Order and Attendance (1 min)",
    JSON.stringify(toPlainText("1. ## **Call to Order and Attendance (1 min)**")),
);
check(
    "a hash that is not a heading survives",
    toPlainText("Meeting \\#1") === "Meeting #1",
    JSON.stringify(toPlainText("Meeting \\#1")),
);

console.log("\nderiveDescription");

// The exact shapes that were showing up as gibberish on /documents.
check(
    "a minutes doc that opens with an image does not describe itself as ![]()",
    !deriveDescription("# Senate Meeting\n\n![]()\n\nCall to order.").includes("!["),
);
check(
    "prose is preferred over the heading",
    deriveDescription("# Senate Meeting\n\n![]()\n\nCall to order.") ===
    "Call to order.",
);
check(
    "falls back to a heading when there is no prose",
    deriveDescription("# Only A Heading") === "Only A Heading",
);
check(
    "an image-only document yields an empty description",
    deriveDescription("![]()\n\n![][image1]") === "",
    JSON.stringify(deriveDescription("![]()\n\n![][image1]")),
);
check(
    "long descriptions are cut on a word boundary",
    (() => {
        const text = deriveDescription(`${"word ".repeat(200)}`, 60);
        return text.length <= 60 && text.endsWith("...") && !text.includes("wor.");
    })(),
);

console.log("\nextractContributors");

const bill = [
    "**An SGA Funding Bill**",
    "Introduced by: **Kai Martin**",
    "Sponsored by: **Veda Kommineni** and **Paul Woo**",
].join("\n");

const billPeople = extractContributors(bill);
check(
    "the introducer is found",
    billPeople.some((p) => p.name === "Kai Martin" && p.role === "introducer"),
    billPeople,
);
check(
    "both sponsors are found",
    ["Veda Kommineni", "Paul Woo"].every((name) =>
        billPeople.some((p) => p.name === name && p.role === "sponsor"),
    ),
    billPeople,
);
check("markdown bold is stripped from names", !billPeople.some((p) => p.name.includes("*")));

// The template lives in the same folder as real bills.
const template = [
    "Introduced by: **INTRODUCER**",
    "Sponsored by: **SENATOR \\#1** and **SENATOR \\#2**",
    "Presented for First Reading this **DAY** day of **MONTH** in the year **YEAR**",
].join("\n");

check(
    "template placeholders produce no people",
    extractContributors(template).length === 0,
    extractContributors(template),
);

const minutes = [
    "Title: Civic Engagement Committee Summer Meeting 1",
    "Date: June 15th, 2026",
    "Students Present: Jackson Morris (CE Chair)",
    "Staff Present: Willow Goode (CSC Civic Life Specialist)",
    "Excused: Ishi (leaving early), Abraham Aini (leaving 10 min early)",
].join("\n");

const minutePeople = extractContributors(minutes);
check(
    "an attendee is found with their office",
    minutePeople.some(
        (p) =>
            p.name === "Jackson Morris" &&
            p.role === "present" &&
            p.office === "CE Chair",
    ),
    minutePeople,
);
check(
    "staff are distinguished from students",
    minutePeople.some((p) => p.name === "Willow Goode" && p.role === "staff"),
);
check(
    "an excused absence is recorded as such",
    minutePeople.some((p) => p.name === "Abraham Aini" && p.role === "excused"),
);
check(
    "a parenthetical that is not an office becomes a note, not a role",
    minutePeople.some(
        (p) => p.name === "Abraham Aini" && p.office === null && p.note !== null,
    ),
    minutePeople.find((p) => p.name === "Abraham Aini"),
);
check(
    "a date line is not mistaken for a person",
    !minutePeople.some((p) => p.name.includes("June")),
);
check(
    "a title line is not mistaken for a person",
    !minutePeople.some((p) => p.name.includes("Civic")),
    minutePeople,
);
check(
    "every person carries the line they came from",
    minutePeople.every((p) => p.evidence.length > 0),
);

// Lines that superficially look like labelled lists but are not people.
const notPeople = [
    "Discussion: Adding transportation to fells point",
    "Agenda: Hopkins Engage",
    "Time: 10:30-11:00am ET",
    "Note: the committee will reconvene",
].join("\n");
check(
    "unlabelled prose lines yield no people",
    extractContributors(notPeople).length === 0,
    extractContributors(notPeople),
);

// The report sections of the GBM agenda template, as Drive exports them:
// sub-items numbered in roman, offices before the colon, senators on their own.
const agenda = [
    "5.  **Reports**",
    "   ---",
    "",
    "1. Cabinet Reports:",
    "",
    "   i. Student Body President: Jason Yu",
    "",
    "   iv. Treasurer: Amy Xu",
    "",
    "   v. Chair of Programming: Grace Guan",
    "",
    "   vii. President of the Senate: Jazzlyn Fernandez",
    "",
    "- [2026-2027 SGA Initiative Tracksheet](https://docs.google.com/spreadsheets/d/1DU/edit)",
    "2. Advisor Report:",
    "",
    "   i. SGA Advisor: Tekeya Peterson",
    "",
    "3. Senator Reports Initiatives Updates:",
    "",
    "   i. Oluwanifemi Ajayi",
    "",
    "   ii. Kai Martin",
    "",
    "6.  **Non-Legislative Business**",
    "   ---",
    "",
    "1. Confirmation of the CSE: Grace Yang",
].join("\n");

const reporters = extractContributors(agenda);
const reporter = (name: string) => reporters.find((p) => p.name === name);

check(
    "an officer named before the colon is the person, not the office",
    reporter("Amy Xu")?.role === "reporting" &&
    reporter("Amy Xu")?.office === "Treasurer",
    reporter("Amy Xu"),
);
check(
    "a compound office is kept as the office it is",
    reporter("Grace Guan")?.office === "Chair of Programming",
    reporter("Grace Guan"),
);
check(
    "every officer the agenda schedules is named",
    ["Jason Yu", "Grace Guan", "Jazzlyn Fernandez"].every(
        (name) => reporter(name)?.role === "reporting",
    ),
    reporters,
);
check(
    "a senator listed on their own is a person",
    reporter("Kai Martin")?.role === "reporting" &&
    reporter("Oluwanifemi Ajayi")?.role === "reporting",
    reporters,
);
check(
    "the advisor stays staff rather than becoming a reporter",
    reporter("Tekeya Peterson")?.role === "staff",
    reporter("Tekeya Peterson"),
);
check(
    // Two Title Case words under a report heading, and nobody at all.
    "the heading that ends the reports is not a person",
    !reporters.some((p) => /Business|Legislative/.test(p.name)),
    reporters,
);
check(
    "a linked tracksheet is not a person",
    !reporters.some((p) => /Tracksheet|Initiative/.test(p.name)),
    reporters,
);
check(
    // She is read, but as somebody the CSE confirmed, not as a reporter the
    // section above ran on into.
    "a report section does not run on past its own items",
    !reporters.some((p) => p.name === "Grace Yang" && p.role === "reporting"),
    reporters,
);
check(
    "a sentence about somebody reporting is not a report list",
    extractContributors(
        "Jason reports Jay Games this weekend!\nBig Show Tickets\nSpring Fair Planning",
    ).length === 0,
    extractContributors(
        "Jason reports Jay Games this weekend!\nBig Show Tickets\nSpring Fair Planning",
    ),
);
check(
    "nobody is called Nothing To Report",
    !extractContributors("Senator Reports:\n   i. Nothing To Report").some((p) =>
        /Nothing/i.test(p.name),
    ),
    extractContributors("Senator Reports:\n   i. Nothing To Report"),
);

// A title in front of a name must not fork one person into two.
const titled = extractContributors(
    "Present: Chair Angela Xiong, Vice Chair Alan Perez, Senators Daarian Rouhani",
);
check(
    "a leading title is stripped from the name",
    titled.some((p) => p.name === "Angela Xiong"),
    titled,
);
check(
    "the stripped title is kept as an office",
    titled.find((p) => p.name === "Angela Xiong")?.office === "Chair",
    titled.find((p) => p.name === "Angela Xiong"),
);
check(
    "a two-word title is stripped and normalised",
    titled.find((p) => p.name === "Alan Perez")?.office === "Vice Chair",
    titled.find((p) => p.name === "Alan Perez"),
);
check(
    "a plural title is singularised",
    titled.find((p) => p.name === "Daarian Rouhani")?.office === "Senator",
    titled.find((p) => p.name === "Daarian Rouhani"),
);
check(
    "titled and untitled mentions collapse to one person",
    extractContributors("Present: Chair Angela Xiong, Angela Xiong").length === 1,
);

const compound = extractContributors(
    "Sponsored by: **Finance Chair Peter Tarpley** and **VPOTS and Chair of IA Shreemann Patel**",
);
check(
    "a committee chair's title is not part of their name",
    compound.some((p) => p.name === "Peter Tarpley" && p.office === "Finance Chair"),
    compound,
);
check(
    "nobody is named Finance Chair Peter Tarpley",
    !compound.some((p) => /finance chair/i.test(p.name)),
    compound,
);
check(
    "a compound office before a name is still one person",
    compound.some(
        (p) => p.name === "Shreemann Patel" && /chair of ia/i.test(p.office ?? ""),
    ),
    compound,
);
check(
    "a three-word name is not split after its first word",
    extractContributors("Introduced by: Mary Ann Smith").some(
        (p) => p.name === "Mary Ann Smith" && p.office === null,
    ),
);

check(
    "the same person in two roles is kept once per role",
    extractContributors("Present: Kai Martin\nExcused: Kai Martin").length === 2,
);
check(
    "a repeated name in one role is deduplicated",
    extractContributors("Present: Kai Martin, Kai Martin").length === 1,
);

const table = [
    "| Shreemann Patel, Chair | Present | Ella Chon | Present |",
    "| :---- | :---- | :---- | :---- |",
    "| Sumire Sumi, Co-Chair | Absent | Rosanne Duenas | Excused |",
].join("\n");
const tablePeople = extractContributors(table);
check(
    "a name/status table yields attendees",
    tablePeople.some((p) => p.name === "Shreemann Patel" && p.role === "present" && p.office === "Chair"),
    tablePeople,
);
check(
    "an excused cell in a table is recorded as excused",
    tablePeople.some((p) => p.name === "Rosanne Duenas" && p.role === "excused"),
    tablePeople,
);

check(
    "faculty are recorded as staff",
    extractContributors("Faculty: Charles, Tekeya").some(
        (p) => p.name === "Charles" && p.role === "staff",
    ),
);
check(
    "permanent members are present",
    extractContributors(
        "Permanent Members: Jackson Morris (JM), Sophia Baleeiro (SB)",
    ).some((p) => p.name === "Jackson Morris" && p.note === "JM"),
);
check(
    "a Here: first-name roll is split into people",
    extractContributors("Here: Kai Veda Mahima").length === 3,
    extractContributors("Here: Kai Veda Mahima"),
);

// The same meeting as the agenda above, written up afterwards. The minutes
// template drops the colon after a report heading, writes a dash where the
// agenda writes a colon, and files what each person said underneath them.
const senateMinutes = [
    "5. ## **Reports (5 min)**",
    "",
    "   1. Cabinet Reports (4 mins)",
    "      1. Student Body President \\- *Jason*",
    "      2. Student Body Vice President \\- *Sumi*",
    "         1. How was Agora cafe?",
    "         2. Secret buddy",
    "      3. Secretary \\- Nora",
    "   2. Advisor Report (2 min)",
    "   3. Senator reports",
    "      1. Oluwanifemi",
    "         1. Increase black visibility and retention of black students",
    "      2. Kai",
    "         1. Working on finance and event grants",
    "      3. Mamadou",
    "6. **Non-Legislative Business (30 min)**",
    "   1. Confirmation of the CSE",
    "      1. Motion to vote, passed",
].join("\n");

const minuted = extractContributors(senateMinutes);
const reported = (name: string) =>
    minuted.find((p) => p.name === name && p.role === "reporting");

check(
    "a report heading without a colon still opens a report section",
    reported("Oluwanifemi") !== undefined,
    minuted,
);
check(
    "an office and its holder are read across a dash as well as a colon",
    reported("Jason")?.office === "Student Body President",
    reported("Jason"),
);
check(
    "what a reporter said underneath their name does not end the reports",
    ["Oluwanifemi", "Kai", "Mamadou"].every((name) => reported(name) !== undefined),
    minuted,
);
check(
    "a reporter's own bullet is not read as another reporter",
    !minuted.some((p) => /Agora|Secret|Increase|Working/.test(p.name)),
    minuted,
);
check(
    "the heading that ends the reports is still not a person",
    !minuted.some((p) => /Business|Confirmation|Motion/.test(p.name)),
    minuted,
);

// What the minutes are mostly made of, and the only record that most of the
// people at the meeting were there.
const caucus = [
    "3. Moderated caucus",
    "   1. Peter: no impeachment trial and replace with a meeting with the Advisor",
    "   2. Kai: do absences need to be supplemented with a reason (Yes)",
    "   3. Sienna: is leaving early an absence or something else",
    "4. Cole: Motion to move to IA, passed (no abstentions, no opposed)",
    "5. Venue: Levering (free) or the Rec Center",
    "6. Timeline: no specific date was mentioned",
    "7. Two changes were made in IA: the cap moved from $500 to $1000",
    "8. Total Budget: $19,000",
].join("\n");

const spoke = extractContributors(caucus);
const speaker = (name: string) => spoke.find((p) => p.name === name);

check(
    // Not "present". Being in the room is the weaker of the two things the
    // line witnesses, and the only one the old role could say.
    "somebody named as speaking is recorded as having spoken",
    ["Peter", "Kai", "Sienna", "Cole"].every(
        (name) => speaker(name)?.role === "interlocutor",
    ),
    spoke,
);
check(
    "a remark is only believed once the archive recognises the speaker",
    spoke.every((p) => p.onlyIfKnown),
    spoke,
);
check(
    "a name read off the roll is believed outright",
    extractContributors("Present: Kai Martin").every((p) => !p.onlyIfKnown),
);
check(
    "being on the roll and taking the floor are two separate claims",
    (() => {
        const both = extractContributors("Present: Kai\n1. Kai: seconded the motion");
        return (
            both.length === 2 &&
            both.some((p) => p.role === "present" && !p.onlyIfKnown) &&
            both.some((p) => p.role === "interlocutor" && p.onlyIfKnown)
        );
    })(),
    extractContributors("Present: Kai\n1. Kai: seconded the motion"),
);
check(
    "a sentence introducing a list of people is not one of them",
    !spoke.some((p) => /Two changes/.test(p.name)),
    spoke,
);
check(
    "a figure the line is filed under is not a remark",
    !spoke.some((p) => /Budget/.test(p.name)),
    spoke,
);
check(
    // These are dropped later, by the resolver, for being nobody the archive
    // holds a full name for -- the parser has no way to know. What it must not
    // do is claim them outright.
    "a document field that reads like a speaker is never claimed outright",
    ["Venue", "Timeline"].every((name) => speaker(name)?.onlyIfKnown !== false),
    spoke,
);
check(
    "a header field outside a list is not read as a speaker at all",
    extractContributors("Venue: Levering (free) or the Rec Center").length === 0,
);

check(
    "an office and a surname are two things, not a two-word name",
    (() => {
        const named = extractContributors("Present: VP Morris, Chair Xiong, Dean Chow");
        return (
            named.length === 3 &&
            named.every((p) => p.office !== null) &&
            named.some((p) => p.name === "Morris" && p.office === "VP")
        );
    })(),
    extractContributors("Present: VP Morris, Chair Xiong, Dean Chow"),
);
check(
    "an ordinary two-word name keeps both of its words",
    extractContributors("Present: Mary Smith").some((p) => p.name === "Mary Smith"),
);

// The two lines in the minutes that say the most about a person, and that a
// parser reading only rolls and remarks throws away.
const business = [
    "6. **Non-Legislative Business (30 min)**",
    "   1. Confirmation of Senate Parliamentarian: Shreemann Patel, confirmed with majority vote",
    "   2. Senator of the month:",
    "      1. Nominees: Jackson and Peter, Winner: Peter (21 votes; 56.76%) Jackson (14 votes, 37.84%)",
].join("\n");

const business_ = extractContributors(business);
const confirmee = business_.find((p) => p.name === "Shreemann Patel");

check(
    "somebody the Senate votes into a seat is recorded as confirmed",
    confirmee?.role === "confirmed" && !confirmee.onlyIfKnown,
    business_,
);
check(
    "the seat they were confirmed to comes with them",
    confirmee?.office === "Senate Parliamentarian",
    confirmee,
);
check(
    "the rest of the sentence is not a second person",
    !business_.some((p) => /confirmed|majority|vote/i.test(p.name)),
    business_,
);
check(
    "both names on a Senator of the Month ballot are read",
    ["Jackson", "Peter"].every((name) =>
        business_.some((p) => p.name === name && p.role === "nominee"),
    ),
    business_,
);
check(
    "a vote tally is not mistaken for a candidate",
    !business_.some((p) => /Winner|votes|\d/.test(p.name)),
    business_,
);

check(
    "a report heading that carries on in Title Case is still a heading",
    (() => {
        const senators = extractContributors(
            [
                "   3. Senator Reports Initiatives Updates",
                "      1. Veda Kommineni",
                "         1. Got picnic blankets for rent at the beach",
                "      2. Jackson Morris",
                "      3. Shreemann Patel",
            ].join("\n"),
        );
        return ["Veda Kommineni", "Jackson Morris", "Shreemann Patel"].every((name) =>
            senators.some((p) => p.name === name && p.role === "reporting"),
        );
    })(),
    extractContributors(
        "   3. Senator Reports Initiatives Updates\n      1. Veda Kommineni",
    ),
);
check(
    "a heading that carries on in a sentence is still a sentence",
    extractContributors(
        "Jason reports Jay Games this weekend\nBig Show Tickets\nSpring Fair Planning",
    ).length === 0,
);

console.log("\nshort-form resolution");

const regular = (id: string, name: string, documentCount: number): RegularPerson => ({
    id,
    name,
    nameKey: name.toLowerCase(),
    documentCount,
    // Offices are what scripts/names.check.ts is about; here only the names
    // matter.
    positions: [],
    bodies: [],
});

const regulars: RegularPerson[] = [
    regular("1", "Sumire Sumi", 5),
    regular("2", "Grace Wang", 4),
    regular("3", "Grace Lee", 3),
    regular("4", "Jackson Morris", 6),
];

check("a single token is a short form", isShortForm("Sumi"));
check("a full name is not a short form", !isShortForm("Sumire Sumi"));
check(
    "Sumi matches Sumire Sumi by surname",
    surnameCandidates("Sumi", regulars).map((p) => p.id).join() === "1",
);
check(
    "Jackson matches Jackson Morris by given name",
    givenNameCandidates("Jackson", regulars).map((p) => p.id).join() === "4",
);
check(
    "Grace is ambiguous across two regulars",
    givenNameCandidates("Grace", regulars).length === 2,
);
check(
    "Jazz matches nobody by token, so only the model may pick",
    tokenCandidates("Jazz", regulars).length === 0,
);

console.log("\nnameKey");
check("case is ignored", nameKey("Kai Martin") === nameKey("kai martin"));
check(
    "punctuation and accents are ignored",
    nameKey("Rocío Garduno-Castaneda") === nameKey("Rocio Garduno Castaneda"),
    nameKey("Rocío Garduno-Castaneda"),
);
check(
    "different people stay different",
    nameKey("Kai Martin") !== nameKey("Kai Martins"),
);

console.log(failures === 0 ? "\nall checks passed" : `\n${failures} failure(s)`);
process.exitCode = failures === 0 ? 0 : 1;
