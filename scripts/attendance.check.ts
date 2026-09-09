/**
 * Checks the attendance sheet is read as the roster it is: the right people
 * in the right seats, and nothing invented from a tally row.
 *
 * The fixture is a trimmed copy of the real "Official SGA Attendance Sheet
 * (2026-2027)", keeping every shape that made the parser hard -- side-by-side
 * column blocks that fall out of step, a section heading that appears in the
 * right block while the left is mid-list, "Senior Class" meaning two
 * different seats, a seat label written where a name should be, and #REF!
 * errors throughout.
 */
import { parseAttendanceSheet, type AttendanceMember } from "../lib/attendance";

let failures = 0;
function check(label: string, condition: boolean, detail?: unknown) {
    if (condition) {
        console.log(`  ok   ${label}`);
    } else {
        failures += 1;
        console.log(`  FAIL ${label}`, detail ?? "");
    }
}

const SHEET = [
    ",,,,,,,,,,,",
    "Executive Branch,,,,,,,,,,,",
    ",,,,,,,,,,,",
    "Jason Yu,Totals,GBM,Exec,IA,,,Jazzlyn Fernandez,Totals,GBM,Exec,IA",
    "Excused,0.0,0.0,0.0,3.0,,,Excused,1.0,0.0,0.0,1.0",
    "Unexcused,0.0,0.0,0.0,0.0,,,Unexcused,,0.0,0.0,3.0",
    "Sumire Sumi,Totals,GBM,Exec,,,,X,Totals,GBM,Exec,",
    "Excused,0.0,0.0,0.0,,,,Excused,#REF!,#REF!,#REF!,",
    "Unexcused,0.0,0.0,0.0,,,,Unexcused,#REF!,#REF!,#REF!,",
    "Senate,,,,,,,,,,,",
    "Class Councils,,,,,,,,,,,",
    "Senior Class,,,,,,,Sophomore Class,,,,",
    "Tanisha Taneja,Totals,GBM,CE,,,,Veda Kommineni,Totals,GBM,SS,",
    "Excused,#REF!,#REF!,#REF!,,,,Excused,0.0,0.0,0.0,",
    "Unexcused,#REF!,#REF!,,,,,Unexcused,0.0,0.0,0.0,",
    ",Totals,GBM,SS,HSS,,,Kai Martin,Totals,GBM,,",
    "Excused,0.0,0.0,0.0,0.0,,,Excused,0.5,0.5,,",
    "Unexcused,0.0,0.0,0.0,0.0,,,Unexcused,0.0,0.0,,",
    "School Representatives,,,,,,,,,,,",
    "KSAS,,,,,,,WSE,,,,",
    "Grace Wang,Totals,GBM,IA,,,,Demarri Dosunmu,Totals,GBM,Finance,",
    "Excused,#REF!,0.0,0.0,#REF!,,,Excused,#REF!,#REF!,,",
    "Unexcused,#REF!,0.0,0.0,#REF!,,,Unexcused,#REF!,#REF!,0.0,",
    "RSO Senators,,,,,,,,,,,",
    "Speical Interest and Hobby Senator,,,,,,,,,,,",
    "Peter Tarpley,Totals,GBM,AA,,,,,,,,",
    "Excused,2.0,0.0,2.0,,,,,,,,",
    "Unexcused,0.0,0.0,0.0,,,,,,,,",
    "Civic Engagement and Service Senator,,,,,,,,,,,",
    "Civic Engagement and Service Senator,Totals,GBM,AA,CE,,,,,,,",
    "Excused,#REF!,0.0,#REF!,0.0,,,,,,,",
    "Unexcused,#REF!,0.0,#REF!,0.0,,,,,,,",
    "RSO 5,,,,,,,,,,,",
    ",Totals,GBM,AA,,,,,,,,",
    "Excused,0.0,0.0,,,,,,,,,",
    "Unexcused,0.0,0.0,,,,,,,,,",
    "Caucus Chairs,,,,,,,,,,,",
    "Black,,,,,,,,,,,",
    "Oluwanifemi Ajayi,Totals,GBM,AA,CE,,,,,,,",
    "Excused,0.0,0.0,0.0,0.0,,,,,,,",
    "Unexcused,0.0,,0.0,0.0,,,,,,,",
    "Hispanic/Latinx,,,,,,,,,,,",
    "Kayla Gonzalez,Totals,GBM,Finance,CSO,,,,,,,",
    "Excused,2.0,0.0,2.0,0.0,,,,,,,",
    "Unexcused,0.0,0.0,0.0,0.0,,,,,,,",
    "FLI Caucus,,,,,,,,,,,",
    "Jazzlyn Fernandez,Totals,GBM,HSS,CE,,,,,,,",
    "Excused,0.0,0.0,0.0,,,,Programming Councils,,,,",
    "Unexcused,0.0,0.0,0.0,,,,Senior Class ,,,,",
    ",,,,,,,,,,,",
    "Chief Justice,,,,,,,Tyler Turner,Totals,PC,,",
    "Felix Titre,Totals,JC,,,,,Excused,0.0,0.0,,",
    "Excused,0.0,0.0,,,,,Unexcused,0.0,0.0,,",
    "Unexcused,0.0,0.0,,,,,Junior Class ,,,,",
    "Justice,,,,,,,Grace Guan,Totals,PC,,",
    "Katherin Zhu,Totals,JC,,,,,Excused,#REF!,0.0,,",
    "Excused,0.0,0.0,,,,,Unexcused,0.0,0.0,,",
    "Committee on Student Elections (CSE),,,,,,,,,,,",
    ",,,,,,,,,,,",
    "Emily Hong,Totals,JC,,,,,,,,,",
    "Excused,0.0,0.0,,,,,,,,,",
    "Unexcused,0.0,0.0,,,,,,,,,",
].join("\n");

const members = parseAttendanceSheet(SHEET);
const find = (name: string): AttendanceMember[] =>
    members.filter((member) => member.name === name);
const one = (name: string): AttendanceMember | undefined => find(name)[0];

console.log("seats");

check(
    "an executive board member is executive",
    one("Jason Yu")?.group === "executive" &&
    one("Jason Yu")?.position === "Executive Board",
    one("Jason Yu"),
);
check(
    "the right-hand column of a section is read too",
    find("Jazzlyn Fernandez").some((row) => row.position === "Executive Board"),
    find("Jazzlyn Fernandez"),
);
check(
    "a class senator gets their class",
    one("Tanisha Taneja")?.position === "Senior Class Senator" &&
    one("Tanisha Taneja")?.subgroup === "Senior Class",
    one("Tanisha Taneja"),
);
check(
    "the two blocks keep their own seats",
    one("Veda Kommineni")?.position === "Sophomore Class Senator",
    one("Veda Kommineni"),
);
check(
    "school representatives are split by school",
    one("Grace Wang")?.position === "KSAS Senator" &&
    one("Demarri Dosunmu")?.position === "WSE Senator",
    [one("Grace Wang"), one("Demarri Dosunmu")],
);
check(
    "the sheet's spelling of an RSO seat is corrected",
    one("Peter Tarpley")?.position === "Special Interest and Hobby Senator",
    one("Peter Tarpley"),
);
check(
    "a caucus chair is named as one",
    one("Oluwanifemi Ajayi")?.position === "Black Caucus Chair" &&
    one("Oluwanifemi Ajayi")?.group === "caucus",
    one("Oluwanifemi Ajayi"),
);
check(
    "both halves of a caucus name are capitalised",
    one("Kayla Gonzalez")?.position === "Hispanic/Latinx Caucus Chair",
    one("Kayla Gonzalez"),
);
check(
    "the two spellings of the FLI caucus agree",
    find("Jazzlyn Fernandez").some(
        (row) => row.position === "First-Generation, Limited-Income Caucus Chair",
    ),
    find("Jazzlyn Fernandez"),
);
check(
    "a justice is in the judiciary, by their own title",
    one("Felix Titre")?.position === "Chief Justice" &&
    one("Felix Titre")?.group === "judiciary" &&
    one("Katherin Zhu")?.position === "Justice",
    [one("Felix Titre"), one("Katherin Zhu")],
);
check(
    "CSE members are their own group",
    one("Emily Hong")?.group === "cse" &&
    one("Emily Hong")?.position === "Committee on Student Elections",
    one("Emily Hong"),
);

console.log("\nblocks that fall out of step");

check(
    "a heading in the right block does not move the left block",
    one("Tyler Turner")?.position === "Senior Class Programming Council" &&
    one("Tyler Turner")?.group === "programming",
    one("Tyler Turner"),
);
check(
    "the right block keeps advancing on its own",
    one("Grace Guan")?.position === "Junior Class Programming Council",
    one("Grace Guan"),
);
check(
    "'Senior Class' means the council here and the seat there",
    one("Tanisha Taneja")?.group === "senate" &&
    one("Tyler Turner")?.group === "programming",
);

console.log("\nnot people");

check("a vacant seat adds nobody", find("").length === 0);
check("a resigned member's placeholder is skipped", find("X").length === 0);
check(
    "a seat label written in the name column is not a person",
    find("Civic Engagement and Service Senator").length === 0,
    members.map((member) => member.name),
);
check(
    "tally rows are not people",
    !members.some((member) => /excused/i.test(member.name)),
);
check(
    "an unfilled RSO seat adds nobody",
    !members.some((member) => /^RSO/.test(member.position)),
);

console.log("\ncommittees");

check(
    "committee codes are expanded",
    one("Jason Yu")?.committees.join(", ") === "Internal Affairs",
    one("Jason Yu"),
);
check(
    "several committees are kept in order",
    one("Oluwanifemi Ajayi")?.committees.join(", ") === "Academic Affairs, Civic Engagement",
    one("Oluwanifemi Ajayi"),
);
check(
    "meeting columns are not committees",
    !members.some((member) =>
        member.committees.some((committee) => /^(GBM|Exec|PC|JC)$/i.test(committee)),
    ),
);
check(
    "the long committee name survives",
    one("Kai Martin")?.committees.length === 0 &&
    one("Grace Wang")?.committees.join() === "Internal Affairs",
    [one("Kai Martin"), one("Grace Wang")],
);
check(
    "a person holding two seats is listed twice",
    find("Jazzlyn Fernandez").length === 2,
    find("Jazzlyn Fernandez"),
);
check(
    "every member carries the row it was read from",
    members.every((member) => member.evidence.includes(member.name)),
);

console.log(failures === 0 ? "\nall checks passed" : `\n${failures} failure(s)`);
process.exitCode = failures === 0 ? 0 : 1;
