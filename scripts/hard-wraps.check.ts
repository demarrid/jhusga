import { reflowHardWraps, reflowRuns } from "../lib/hard-wraps";

let failures = 0;
function check(label: string, condition: boolean, detail?: unknown) {
    if (condition) {
        console.log(`  ok   ${label}`);
    } else {
        failures += 1;
        console.log(`  FAIL ${label}`, detail ?? "");
    }
}

console.log("reflowHardWraps");

// Senate Meeting #23 minutes, as the PDF printed them.
const minutes = [
    "Chair Tim Huang",
    "i. They will be in charge of SGA general events. The chair",
    "programming will still have a major role but it will be",
    "feasible. Considering the recent Writ of Certiorari SGA",
    "received, Huang believes that the executive board should",
    "not be open to the public. Committee meetings can still be",
    "kept open if wanted.",
].join("\n");
const flowed = reflowHardWraps(minutes);
check("keeps the length, so offsets hold", flowed.length === minutes.length);
check("joins a sentence the PDF wrapped",
    flowed.includes("Certiorari SGA received, Huang believes that the executive board should not be open"), flowed);
check("keeps the break before an item marker", flowed.includes("Huang\ni. They"), flowed);

const items = [
    "iii. Huang said that this is just for the continuation of the",
    "SGA.",
    "iv. Tiamiyu clarified if this closes the executive board",
    "meetings but keeps the rest open.",
    "v. Huang said that this was the question, and it depends on",
    "what everyone prefers.",
].join("\n");
const itemsFlowed = reflowHardWraps(items);
check("joins a capitalized word that would not fit", itemsFlowed.includes("of the SGA."), itemsFlowed);
check("keeps every sub-item on its own line", itemsFlowed.split("\n").length === 3, itemsFlowed);

const hawthorne = [
    "i. Hawthorne visited the meeting a month ago, and she is",
    "visiting again to provide more updates. They made the",
    "decision for the fall semester to open it for only Hopkins",
    "affiliates. It will open to the public after. Swipe access",
    "only. Hopkins students are free to bring outside guests,",
    "but they will be responsible for the actions of their guests.",
    "iv. They are setting up the meeting rooms at Hopkins",
    "Student Center. There are students who are helping out.",
].join("\n");
const hawthorneFlowed = reflowHardWraps(hawthorne);
check("a short word ending a sentence is not an item marker", hawthorneFlowed.includes("Swipe access only."), hawthorneFlowed);
check("joins a near-full line that stops mid-sentence", hawthorneFlowed.includes("at Hopkins Student Center"), hawthorneFlowed);
check("still breaks before the next item", hawthorneFlowed.includes("guests.\niv. They"), hawthorneFlowed);

const bylaws = [
    "3.2.1.3.3 Failure to send minutes in a timely manner shall be noted on the",
    "SGA website, along with the name of the committee chair responsible for them",
    "and the date the minutes were due to the Executive Secretary of the Senate.",
    "3.2.1.3.4 Creates and maintains the record of every standing committee chair",
].join("\n");
check("keeps the break before a bylaw clause number", reflowHardWraps(bylaws).includes("Senate.\n3.2.1.3.4"), reflowHardWraps(bylaws));
const bullets = [
    "* Communicate clearly about where moving carts are available during move-in",
    "* Provide more assistance to students moving their belongings into the dorms",
    "▪ Off campus housing survey sent in November to all upperclassmen students",
    "● Financial wellness webinars held each month on budgeting and saving money",
].join("\n");
check("keeps every bullet on its own line", reflowHardWraps(bullets) === bullets, reflowHardWraps(bullets));
const form = "**Gmail Address:** someone.long.address@example.com, reachable most days\n**Phone Number:** [REDACTED]\n**Year:** 2027";
check("keeps a form's labelled lines", reflowHardWraps(form) === form, reflowHardWraps(form));

const contents = [
    "Recognition of Student Groups........................................... 4",
    "Funding of Student Groups............................................... 5",
    "The Poster Policy....................................................... 6",
].join("\n");
check("keeps a table of contents a line an entry", reflowHardWraps(contents) === contents, reflowHardWraps(contents));
check("keeps a link on its own line",
    reflowHardWraps("Discussion of the campus tabling funding bill (fast-forward finance)\nhttps://docs.google.com/document/d/x").includes("\nhttps"));

check("keeps a title's short lines",
    reflowHardWraps("112th Johns Hopkins Student Government Association\nSenate Meeting #23\nMarch 25, 2025 / 07:20 PM / Hackerman B17\nAGENDA")
        .split("\n").length === 4);
check("keeps a letterhead", reflowHardWraps("Senate\nof the\nStudent Government Association\nof\nThe Johns Hopkins University").split("\n").length === 5);
check("keeps a break after a colon",
    reflowHardWraps("The following senators were present at the meeting today:\nmost of the class councils").includes(":\n"));
check("keeps a typed break after a long sentence",
    reflowHardWraps("This is a long sentence that someone typed in a Google Doc and then pressed enter.\nThen another one.").includes("\n"));

console.log("reflowRuns");
const runs = [
    { text: "Considering the recent Writ of Certiorari SGA\n", id: 1 },
    { text: "received, Huang believes that the executive board should", id: 2 },
];
const flowedRuns = reflowRuns(runs);
check("joins a wrap at a run boundary", flowedRuns[0]!.text.endsWith("SGA "), flowedRuns);
check("keeps each run's length", flowedRuns.every((run, index) => run.text.length === runs[index]!.text.length));
check("leaves untouched runs as they were", flowedRuns[1] === runs[1]);

if (failures > 0) {
    console.log(`\n${failures} failure(s)`);
    process.exit(1);
}
console.log("\nall passed");
