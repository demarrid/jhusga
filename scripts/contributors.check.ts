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
