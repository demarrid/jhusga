/**
 * Checks that the contact directory can read a jammed email-list export and a
 * roster CSV the way Drive actually ships them.
 */

import {
    buildSessionDirectory,
    directorySubgroup,
    emailNameScore,
    extractGroupInboxes,
    extractOfficerAssignments,
    extractWrittenNames,
    membersByGroup,
    mergeDirectoryMembers,
    pairNamesToEmails,
    parseEmailList,
    parseRosterCsv,
} from "../lib/directory";

let failures = 0;
function check(label: string, condition: boolean, detail?: unknown) {
    if (condition) {
        console.log(`  ok   ${label}`);
    } else {
        failures += 1;
        console.log(`  FAIL ${label}`, detail ?? "");
    }
}

const roster = [
    "Name,,",
    "Exec,,",
    "Vishnu,Dontu,President",
    "Sumire,Sumi,Secretary",
    "Srigouri,Oruganty,President of the Senate & Senior Class President",
    ",,",
    "Senators,,",
    "Jason,Yu,Sophomore Class President",
    "Alan ,Perez Ariza,Senior Class Senator 2",
    "Jibola,Omotoyinbo,KSAS 4",
    "Jibola,Omotoyinbo,KSAS 8",
    "Amy,Xu,WSE 1",
    "Omotola,Alaofin,Black Caucus",
    "Programming,,",
    "Grace,Wang,2028",
    "Adam,Kinderman,2028",
].join("\n");

console.log("parseRosterCsv");
const rosterPeople = parseRosterCsv(roster);
const byName = Object.fromEntries(rosterPeople.map((person) => [person.name, person]));
check("the president is executive", byName["Vishnu Dontu"]?.group === "executive");
check(
    "the secretary's office is kept",
    byName["Sumire Sumi"]?.positions.includes("Secretary") === true,
);
check(
    "a three-word name is joined",
    Boolean(byName["Alan Perez Ariza"]),
    rosterPeople.map((p) => p.name),
);
check(
    // The roster numbers its rows; the seats are not ranked, so "KSAS 4" and
    // "KSAS 8" are the same office written twice.
    "two numbered roster rows are one seat",
    byName["Jibola Omotoyinbo"]?.positions.join() === "KSAS Senator",
    byName["Jibola Omotoyinbo"]?.positions,
);
check(
    "a numbered school seat matches the way the attendance sheet writes it",
    byName["Amy Xu"]?.positions.join() === "WSE Senator",
    byName["Amy Xu"]?.positions,
);
check(
    "a class seat keeps its class and loses its row number",
    byName["Alan Perez Ariza"]?.positions.join() === "Senior Class Senator",
    byName["Alan Perez Ariza"]?.positions,
);
check(
    "two offices in one cell are two offices",
    byName["Srigouri Oruganty"]?.positions.join() ===
    "President of the Senate,Senior Class President",
    byName["Srigouri Oruganty"]?.positions,
);
check("a caucus row is not filed as senate", byName["Omotola Alaofin"]?.group === "caucus");
check(
    "a caucus row names the chair, not the caucus",
    byName["Omotola Alaofin"]?.positions.join() === "Black Caucus Chair",
    byName["Omotola Alaofin"]?.positions,
);
check(
    "a programming class year becomes Programming Council",
    byName["Grace Wang"]?.positions.includes("Programming Council") === true &&
        byName["Grace Wang"]?.group === "programming",
);

console.log("\nemail pairing");
check("ssumi2 is Sumire Sumi", emailNameScore("Sumire Sumi", "ssumi2@jh.edu") === 3);
check("hmurato1 is Honora Muratori", emailNameScore("Honora Muratori", "hmurato1@jh.edu") >= 2);
check("axu22 is Amy Xu, not Amy Li", emailNameScore("Amy Xu", "axu22@jh.edu") === 3);
check("axu22 is not Amy Li", emailNameScore("Amy Li", "axu22@jh.edu") < 3);
check("charlesiii matches Charles Norman III", emailNameScore("Charles Norman III", "charlesiii@jhu.edu") >= 1);

const pairs = pairNamesToEmails(
    ["Sumire Sumi", "Amy Xu", "Amy Li", "Honora Muratori"],
    ["ssumi2@jh.edu", "axu22@jh.edu", "hmurato1@jh.edu"],
);
check(
    "each address lands on one person",
    pairs.map((p) => `${p.name}:${p.email}`).sort().join(" | ") ===
        "Amy Xu:axu22@jh.edu | Honora Muratori:hmurato1@jh.edu | Sumire Sumi:ssumi2@jh.edu",
    pairs,
);

console.log("\nparseEmailList");
const jammed = [
    "114th Contact list",
    "",
    "| Name | Email | Role |",
    "| :---- | :---- | :---- |",
    "| Sumire Sumi Honora Muratori Amy Xu PROGRAMMING COUNCIl Adam Kinderman | [ssumi2@jh.edu](mailto:ssumi2@jh.edu) [hmurato1@jh.edu](mailto:hmurato1@jh.edu) [axu22@jh.edu](mailto:axu22@jh.edu) [akinder2@jh.edu](mailto:akinder2@jh.edu) |  |",
    "",
    "Jessica Snell",
    "[jsnell11@jh.edu](mailto:jsnell11@jh.edu)",
    "",
    "Charles Norman III",
    "[charlesiii@jhu.edu](mailto:charlesiii@jhu.edu)",
].join("\n");

check(
    "jammed names are split",
    extractWrittenNames(jammed).includes("Sumire Sumi"),
    extractWrittenNames(jammed),
);

const listed = parseEmailList(jammed);
const listedBy = Object.fromEntries(listed.map((person) => [person.name, person]));
check("Sumi gets ssumi2", listedBy["Sumire Sumi"]?.email === "ssumi2@jh.edu");
check(
    "Jessica is staff",
    listedBy["Jessica Snell"]?.group === "staff" &&
        listedBy["Jessica Snell"]?.email === "jsnell11@jh.edu",
);
check("Charles is staff", listedBy["Charles Norman III"]?.email === "charlesiii@jhu.edu");

console.log("\nmerge");
const merged = mergeDirectoryMembers([rosterPeople, listed]);
const sumi = merged.find((person) => person.name === "Sumire Sumi");
check("roster office survives the email list", sumi?.positions.includes("Secretary") === true);
check("roster person gains their email", sumi?.email === "ssumi2@jh.edu");
check(
    "a roster-only name is not on the roll",
    !merged.some((person) => person.name === "Vishnu Dontu"),
    merged.map((person) => person.name),
);

const folded = mergeDirectoryMembers([
    [{ name: "Grace Guan", email: null, positions: ["Programming Council"], group: "programming" }],
    [{ name: "Gracee Guan", email: "gguan1@jh.edu", positions: [], group: "other" }],
    [{ name: "Name Email Role", email: "ssumi2@jh.edu", positions: [], group: "staff" }],
]);
check(
    "a roster spelling absorbs the email-list typo",
    folded.length === 1 && folded[0]?.name === "Grace Guan" && folded[0]?.email === "gguan1@jh.edu",
    folded,
);

console.log("\nofficers and current roll");
const officers = extractOfficerAssignments(
    [
        "4. Treasurer \\- *Amy Xu*",
        "5. Chair of Programming \\- *Grace Guan*",
        "6. President of the Senate \\- *Jazzlyn Fernandez*",
        "Treasurer \\- *Name*",
    ].join("\n"),
);
check(
    "student-body titles still resolve",
    extractOfficerAssignments("1. Student Body President \\- *Jason Yu*").some(
        (row) => row.office === "President" && row.name === "Jason Yu",
    ),
);
check(
    "minutes name Amy Xu treasurer",
    officers.some((row) => row.office === "Treasurer" && row.name === "Amy Xu"),
    officers,
);
check("a template Name is ignored", !officers.some((row) => row.name === "Name"));

const assembled = buildSessionDirectory([
    {
        id: "email",
        title: "114th email list",
        content: jammed,
        driveModifiedTime: "2026-09-01T00:00:00Z",
    },
    {
        id: "roster",
        title: "114th SGA Roster",
        content: roster,
        driveModifiedTime: "2026-04-03T00:00:00Z",
    },
    {
        id: "minutes",
        title: "MINUTES #2",
        kind: "minutes.senate",
        content: [
            "1. Student Body President \\- *Jason Yu*",
            "2. Student Body Vice President \\- *Sumire Sumi*",
            "3. Secretary \\- *Honora Muratori*",
            "4. Treasurer \\- *Amy Xu*",
            "5. Chair of Programming \\- *Grace Guan*",
            "6. President of the Senate \\- *Jazzlyn Fernandez*",
        ].join("\n"),
        driveModifiedTime: "2026-09-02T00:00:00Z",
    },
]);
const amy = assembled.members.find((person) => person.name === "Amy Xu");
const jason = assembled.members.find((person) => person.name === "Jason Yu");
const sumiNow = assembled.members.find((person) => person.name === "Sumire Sumi");
check("Amy Xu is treasurer, not a senator", amy?.positions.join() === "Treasurer", amy);
check("Jason Yu is president, not a leftover Jason's office", jason?.positions.join() === "President", jason);
check("Sumi is vice president from minutes", sumiNow?.positions.join() === "Vice President", sumiNow);
check("Amy Xu is filed as executive", amy?.group === "executive", amy);
check(
    "Justin Pokrant is not invented from the old roster",
    !assembled.members.some((person) => person.name === "Justin Pokrant"),
);
check(
    "Jazzlyn is added from current minutes",
    assembled.members.some(
        (person) =>
            person.name === "Jazzlyn Fernandez" &&
            person.positions.includes("President of the Senate"),
    ),
);
check("a treasurer chip points at minutes", amy?.positionSources?.[0]?.documentId === "minutes", amy);
check(
    "an email chip points at the contact list",
    amy?.emailSource?.documentId === "email",
    amy,
);

check(
    "sophomore class is a senate subgroup",
    directorySubgroup("senate", ["Sophomore Class Senator 2"]) === "Sophomore Class",
);
const senate = membersByGroup([
    {
        name: "Kevin Xu",
        email: null,
        positions: ["Sophomore Class Senator 2"],
        group: "senate",
        subgroup: "Sophomore Class",
    },
    {
        name: "Amy Xu",
        email: null,
        positions: ["WSE Senator"],
        group: "senate",
        subgroup: "WSE",
    },
    {
        name: "Caraline Sommer",
        email: null,
        positions: ["Sophomore Class Senator 1"],
        group: "senate",
        subgroup: "Sophomore Class",
    },
    {
        name: "Jason Yu",
        email: null,
        positions: ["Sophomore Class President"],
        group: "senate",
        subgroup: "Sophomore Class",
    },
]).find((section) => section.group === "senate");
const sophomores =
    senate?.subgroups.find((sub) => sub.key === "Sophomore Class Senators")?.rows.map((row) => row.member) ?? [];
check(
    "class senators sit in one subsection, president first",
    sophomores.map((person) => person.name).join() ===
        "Jason Yu,Caraline Sommer,Kevin Xu",
    sophomores.map((person) => person.name),
);
check(
    "WSE is a separate subsection",
    senate?.subgroups.some((sub) => sub.key === "Whiting School of Engineering Senators") === true,
    senate?.subgroups.map((sub) => sub.key),
);

console.log("\npositions document");
const positions = [
    "1. Executive Branch",
    "   1. Treasurer",
    "      1. Amy Xu",
    "         1. Co-Chair of Finance Committee",
    "   2. Chair of Programming",
    "      1. Grace Guan",
    "         1. No committees",
    "         2. Member of Junior Class Programming Council",
    "   3. Director of Communications",
    "      1. Sienna Sian Kim",
    "         1. Committees: None",
    "   4. President of the Senate",
    "      1. Jazzlyn Fernandez",
    "         1. No councils",
    "2. Legislative Branch",
    "   1. Sophomore Class Senators",
    "      1. Veda Kommineni",
    "         1. Sophomore Class President",
    "         2. Chair of Commitee on Student Services",
    "      2. Kai Martin",
    "         1. .",
    "      3. …",
    "   2. Academic Senators",
    "      1. Krieger School of Arts and Sciences",
    "         1. Boyi Chen",
    "            1. Member of Committee on Internal Affairs",
    "            2. Member of Committee ofon Academic Affairs",
    "      2. Whiting School of Engineering",
    "         1. Paul Woo",
    "   3. Representative Senators",
    "      1. Cultural Identity",
    "         1. Arjun Jasuja",
    "      10. First-Generation Limited Income",
    "          1. Jazzlyn Fernandez",
    "3. Judiciary Branch",
    "   1. Justices",
    "      1. Felix Titre",
    "         1. Chief Justice",
    "      2. Katherine Zhu",
    "   2. Committee on Student Elections",
    "      1. Sajiv Harikrishnar",
    "         1. Chair",
    "      2.",
].join("\n");

const fromPositions = buildSessionDirectory([
    { id: "positions", title: "114th SGA Roster", content: positions, driveModifiedTime: "2026-10-08T00:00:00Z" },
    { id: "email", title: "114th email list", content: jammed, driveModifiedTime: "2026-09-01T00:00:00Z" },
    { id: "roster", title: "114th SGA Roster", content: roster, driveModifiedTime: "2026-04-03T00:00:00Z" },
    {
        id: "minutes",
        title: "MINUTES #2",
        kind: "minutes.senate",
        content: "1. Student Body Vice President \\- *Sumire Sumi*\n2. Treasurer \\- *Vishnu Dontu*",
        driveModifiedTime: "2026-09-02T00:00:00Z",
    },
]);
const held = (name: string) => fromPositions.members.find((person) => person.name === name);

check("a nested branch outline is a positions document", fromPositions.sources[0]?.id === "positions", fromPositions.sources);
check(
    "only the positions document and the email list are read",
    fromPositions.sources.map((source) => source.id).join() === "positions,email",
    fromPositions.sources,
);
check(
    "the email list adds an address but not a member",
    held("Amy Xu")?.email === "axu22@jh.edu" && !held("Sumire Sumi") && !held("Jessica Snell"),
    fromPositions.members.map((person) => person.name),
);
check(
    "minutes cannot hand an office to someone else",
    !held("Vishnu Dontu") && held("Amy Xu")?.positions[0] === "Treasurer",
    held("Amy Xu"),
);
check(
    "a committee chair is an office and a committee",
    held("Amy Xu")?.positions.includes("Co-Chair of the Committee on Finance") === true &&
        held("Amy Xu")?.committees?.join() === "Finance",
    held("Amy Xu"),
);
check(
    "misspelled committee names land on the bylaws' names",
    held("Veda Kommineni")?.committees?.join() === "Student Services" &&
        held("Boyi Chen")?.committees?.join() === "Internal Affairs,Academic Affairs",
    [held("Veda Kommineni"), held("Boyi Chen")],
);
check("No committees and . are not offices", held("Kai Martin")?.positions.join() === "Sophomore Class Senator", held("Kai Martin"));
check("Committees: None is not an office", held("Sienna Sian Kim")?.positions.join() === "Director of Communications", held("Sienna Sian Kim"));
check(
    "a council membership is an office",
    held("Grace Guan")?.positions.join() === "Chair of Programming,Junior Class Programming Council",
    held("Grace Guan"),
);
check("a school heading is the school seat", held("Boyi Chen")?.subgroup === "KSAS" && held("Paul Woo")?.positions.join() === "WSE Senator");
check(
    "a constituency shaped like a name is a heading, not a person",
    !held("Cultural Identity") && held("Arjun Jasuja")?.positions.join() === "Cultural Identity Senator",
    fromPositions.members.map((person) => person.name),
);
check(
    "one person under two seats holds both",
    held("Jazzlyn Fernandez")?.positions.join() === "President of the Senate,First-Generation Limited Income Senator" &&
        held("Jazzlyn Fernandez")?.group === "executive",
    held("Jazzlyn Fernandez"),
);
check("Chief Justice refines the Justice seat", held("Felix Titre")?.positions.join() === "Chief Justice", held("Felix Titre"));
check("a justice with no detail is a Justice", held("Katherine Zhu")?.positions.join() === "Justice");
check(
    "an elections committee chair is that committee's chair",
    held("Sajiv Harikrishnar")?.positions.join() === "Chair of the Committee on Student Elections" &&
        held("Sajiv Harikrishnar")?.group === "cse",
    held("Sajiv Harikrishnar"),
);

console.log("\npositions document as the contact page lists it");
const laidOut = [
    "1. Executive Branch",
    "   1. Student Body President",
    "      1. Jason Yu",
    "   2. Chair of Programming",
    "      1. Grace Guan",
    "         1. Member of Junior Class Programming Council",
    "   3. President of the Senate",
    "      1. Jazzlyn Fernandez",
    "         1. First-Generation Limited Income Students Caucus Senator",
    "   4. Programming Council",
    "      1. Senior Class",
    "         1. Tyler Runer",
    "         2. Elizabeth Abatan",
    "      2. Junior Class",
    "         1. Kekeli Woyome",
    "         2. Grace Guan",
    "2. Legislative Branch",
    "   1. Freshman Class Senators",
    "      1. Royce Willis",
    "         1. Freshman Class President",
    "      2. Zoe Adams",
    "      3. Ben Carter",
    "   2. Academic Senators",
    "      1. Whiting School of Engineering",
    "         1. Paul Woo",
    "         2. Luke Holmes",
    "   3. Registered Student Organization Senators",
    "      1. Special Interest and Hobby",
    "         1. Peter Tarpley",
    "      2. Religious and Spiritual Life",
    "         1. Cole Liazos-Coffey",
    "   4. Caucus Senators",
    "      1. Disabled Students",
    "         1. Jackson Morris",
    "      2. First-Generation Limited Income Students",
    "         1. Jazzlyn Fernandez",
    "3. Judiciary Branch",
    "   1. Justices",
    "      1. Felix Titre",
    "         1. Chief Justice",
    "      2. Katherine Zhu",
    "      3. Aryun Guatam",
    "   2. Committee on Student Elections",
    "      1. Sajiv Harikrishnar",
    "         1. Chair",
    "      2. Alysa Peng",
    "         1. Financial Chair",
].join("\n");
const listing = membersByGroup(
    buildSessionDirectory([
        { id: "positions", title: "114th SGA Roster", content: laidOut, driveModifiedTime: "2026-10-08T00:00:00Z" },
    ]).members,
);
const sectionOf = (group: string) => listing.find((section) => section.group === group);
const rowsUnder = (group: string, key: string) =>
    sectionOf(group)?.subgroups.find((sub) => sub.key === key)?.rows ?? [];
const describe = (rows: { member: { name: string }; title: string | null; offices: string[] }[]) =>
    rows.map((row) => [row.member.name, row.title, ...row.offices].filter(Boolean).join(": "));

check(
    "the Programming Council is listed inside Executive",
    !sectionOf("programming") &&
        sectionOf("executive")?.subgroups.map((sub) => sub.key).join(" | ") ===
            " | Programming Council / Senior Class | Programming Council / Junior Class",
    sectionOf("executive")?.subgroups.map((sub) => sub.key),
);
check(
    "the council heading opens once, its classes beneath it",
    JSON.stringify(sectionOf("executive")?.subgroups.map((sub) => sub.headings)) ===
        JSON.stringify([
            [],
            [
                { text: "Programming Council", depth: 0 },
                { text: "Senior Class", depth: 1 },
            ],
            [{ text: "Junior Class", depth: 1 }],
        ]),
    sectionOf("executive")?.subgroups.map((sub) => sub.headings),
);
check(
    "distinct offices keep the document's order",
    describe(rowsUnder("executive", "")).join(" | ") ===
        "Jason Yu: Student Body President | Grace Guan: Chair of Programming | Jazzlyn Fernandez: President of the Senate",
    describe(rowsUnder("executive", "")),
);
check(
    "one council's members are by surname",
    describe(rowsUnder("executive", "Programming Council / Senior Class")).join() === "Elizabeth Abatan,Tyler Runer",
    describe(rowsUnder("executive", "Programming Council / Senior Class")),
);
check(
    "a class president is listed as that class's senator, first",
    describe(rowsUnder("senate", "Freshman Class Senators")).join(" | ") ===
        "Royce Willis: Freshman Class President (Senator) | Zoe Adams | Ben Carter",
    describe(rowsUnder("senate", "Freshman Class Senators")),
);
check(
    "a school's senators are under the school, without the seat repeated",
    describe(rowsUnder("senate", "Whiting School of Engineering Senators")).join() === "Luke Holmes,Paul Woo",
    describe(rowsUnder("senate", "Whiting School of Engineering Senators")),
);
check(
    "Registered Student Organization senators are their own subsection",
    describe(rowsUnder("senate", "Registered Student Organization Senators")).join(" | ") ===
        "Peter Tarpley: Special Interest and Hobby | Cole Liazos-Coffey: Religious and Spiritual Life",
    sectionOf("senate")?.subgroups.map((sub) => sub.key),
);
check(
    "caucus senators are their own subsection, a second seat listed there too",
    describe(rowsUnder("senate", "Caucus Senators")).join(" | ") ===
        "Jackson Morris: Disabled Students | Jazzlyn Fernandez: First-Generation Limited Income Students",
    describe(rowsUnder("senate", "Caucus Senators")),
);
check(
    "the Chief Justice leads, the justices follow by surname",
    describe(rowsUnder("judiciary", "")).join(" | ") ===
        "Felix Titre: Chief Justice | Aryun Guatam: Justice | Katherine Zhu: Justice",
    describe(rowsUnder("judiciary", "")),
);
check(
    "elections committee roles drop the committee's name",
    describe(rowsUnder("cse", "")).join(" | ") === "Sajiv Harikrishnar: Chair | Alysa Peng: Financial Chair",
    describe(rowsUnder("cse", "")),
);
check(
    "the full office names stay on the record",
    listing
        .flatMap((section) => section.subgroups.flatMap((sub) => sub.rows))
        .find((row) => row.member.name === "Alysa Peng")
        ?.member.positions.join() === "Financial Chair of the Committee on Student Elections",
);

check(
    "a roster spreadsheet is not mistaken for one",
    buildSessionDirectory([
        { id: "email", title: "114th email list", content: jammed },
        { id: "roster", title: "114th SGA Roster", content: roster },
    ]).sources.some((source) => source.id === "roster"),
);

console.log("\ngroup inboxes");
const inboxes = extractGroupInboxes([
    {
        id: "1",
        title: "Bylaws",
        content: "Students should email sga@jhu.edu with questions about the Association.",
    },
    {
        id: "2",
        title: "Minutes",
        content: "Graham said graham@jhu.edu would follow up.",
    },
    {
        id: "3",
        title: "Email list",
        content: "Charles Norman III charlesiii@jhu.edu",
    },
]);
check("sga@jhu.edu is kept when the text says to email it", inboxes.some((row) => row.email === "sga@jhu.edu"));
check("a personal address is not an inbox", !inboxes.some((row) => row.email.includes("graham") || row.email.includes("charles")));

console.log(failures === 0 ? "\nall checks passed" : `\n${failures} failure(s)`);
process.exitCode = failures === 0 ? 0 : 1;
