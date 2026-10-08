import { currentEditions, editionDate, isSetAside, type EditionCandidate } from "../lib/editions";

let failures = 0;
function check(label: string, condition: boolean, detail?: unknown) {
    if (condition) {
        console.log(`  ok   ${label}`);
    } else {
        failures += 1;
        console.log(`  FAIL ${label}`, detail ?? "");
    }
}

function doc(
    id: string,
    title: string,
    kind: string,
    folderPath: string,
    datedAt: string | null,
    driveModifiedTime: string,
): EditionCandidate {
    return {
        id,
        title,
        kind,
        folderPath,
        datedAt: datedAt ? new Date(datedAt) : null,
        driveModifiedTime: new Date(driveModifiedTime),
    };
}

// The 114th's Guiding Documents as synced in September 2026.
const corpus = [
    doc("bylaws-edited", "Edited (Sep) JHU SGA Bylaws 2026-2027", "guiding.bylaws", "Guiding Documents", null, "2026-09-13T19:52:58Z"),
    doc("bylaws-template-a", "JHU SGA Bylaws (Amended April 2026)", "guiding.bylaws", "Template Bills", null, "2026-09-08T23:42:09Z"),
    doc("bylaws-template-b", "JHU SGA Bylaws (Amended April 2026)", "guiding.bylaws", "Template Bills", null, "2026-09-18T17:58:37Z"),
    doc("bylaws-sep18", "JHU SGA Bylaws (Amended September 18th 2026)", "guiding.bylaws", "Guiding Documents", "2026-09-18T12:00:00Z", "2026-09-20T19:34:14Z"),
    doc("bylaws-2627-a", "JHU SGA Bylaws 2026-2027", "guiding.bylaws", "Guiding Documents/Previous Revisions", null, "2026-09-15T00:23:40Z"),
    doc("bylaws-2627-b", "JHU SGA Bylaws 2026-2027", "guiding.bylaws", "Guiding Documents/Previous Revisions", null, "2026-06-11T23:26:55Z"),
    doc("cse", "CSE Constitution Feb. 2024", "guiding.constitution", "", null, "2024-09-09T19:08:33Z"),
    doc("constitution-sep18", "JHU SGA Constitution (Amended September 18th 2026)", "guiding.constitution", "Guiding Documents", "2026-09-18T12:00:00Z", "2026-09-23T13:58:04Z"),
    doc("constitution-apr", "JHU SGA Constitution April 2026", "guiding.constitution", "113th SGA Master Folder 2025-2026/Guiding Documents", "2026-04-01T12:00:00Z", "2026-09-13T02:41:26Z"),
    doc("constitution-sep", "JHU SGA Constitution September 2026", "guiding.constitution", "Guiding Documents/Previous Revisions", "2026-09-15T12:00:00Z", "2026-09-16T14:37:08Z"),
    doc("rules", "S.B.26-27.21.04-1 Rules Bill", "bill.senate_rules", "", "2026-04-21T12:00:00Z", "2026-09-02T00:53:08Z"),
    doc("finance", "Governing Guidelines for the SGA Finance Committee.pdf", "guiding.other", "Guiding Documents", null, "2026-04-03T03:13:43Z"),
];

console.log("currentEditions");

const kept = currentEditions(corpus).map((document) => document.id);
const keptOf = (kind: string) =>
    currentEditions(corpus).filter((document) => document.kind === kind).map((document) => document.id);

check("one SGA bylaws edition: the September 18th amendment", JSON.stringify(keptOf("guiding.bylaws")) === JSON.stringify(["bylaws-sep18"]), keptOf("guiding.bylaws"));
check(
    "the SGA constitution amended September 18th, and the CSE's own constitution",
    JSON.stringify(keptOf("guiding.constitution").sort()) === JSON.stringify(["constitution-sep18", "cse"]),
    keptOf("guiding.constitution"),
);
check("other authoritative kinds pass through", kept.includes("rules") && kept.includes("finance"), kept);
check("input order is preserved", kept.join() === corpus.filter((d) => kept.includes(d.id)).map((d) => d.id).join());

check(
    "a template copy modified after the amendment does not win",
    !kept.includes("bylaws-template-b"),
);

const onlySetAside = [corpus[4]!, corpus[5]!];
check(
    "a lineage with only set-aside copies still keeps one",
    currentEditions(onlySetAside).length === 1,
    currentEditions(onlySetAside).map((d) => d.id),
);

check(
    "a dated edition beats an undated one",
    currentEditions([
        doc("undated", "JHU SGA Bylaws 2026-2027", "guiding.bylaws", "Guiding Documents", null, "2026-10-01T00:00:00Z"),
        doc("dated", "JHU SGA Bylaws (Amended April 2026)", "guiding.bylaws", "Guiding Documents", null, "2026-04-02T00:00:00Z"),
    ]).map((d) => d.id).join() === "dated",
);

console.log("isSetAside");

check("drafts are set aside", isSetAside({ title: "Bylaws Draft", folderPath: "Guiding Documents" }));
check("edited copies are set aside", isSetAside({ title: "Edited (Sep) JHU SGA Bylaws", folderPath: "Guiding Documents" }));
check("comments copies are set aside", isSetAside({ title: "Comments for JHU SGA Constitution April 2026", folderPath: "" }));
check("Previous Revisions is set aside", isSetAside({ title: "JHU SGA Bylaws 2026-2027", folderPath: "Guiding Documents/Previous Revisions" }));
check("Template Bills is set aside", isSetAside({ title: "JHU SGA Bylaws", folderPath: "Template Bills" }));
check("the live folder is not", !isSetAside({ title: "JHU SGA Bylaws (Amended September 18th 2026)", folderPath: "Guiding Documents" }));
check("an amended edition is not a draft", !isSetAside({ title: "JHU SGA Constitution (Amended April 2026)", folderPath: "" }));

console.log("editionDate");

check("the stated date wins", editionDate({ title: "Bylaws April 2026", datedAt: new Date("2026-09-18T12:00:00Z") })?.toISOString() === "2026-09-18T12:00:00.000Z");
check("a month in the filename", editionDate({ title: "JHU SGA Bylaws (Amended April 2026)", datedAt: null })?.toISOString() === "2026-04-01T12:00:00.000Z");
check("a season in the filename", editionDate({ title: "Constitution Fall 2025", datedAt: null })?.toISOString() === "2025-08-01T12:00:00.000Z");
check("an academic year is not an edition", editionDate({ title: "JHU SGA Bylaws 2026-2027", datedAt: null }) === null);

console.log(failures === 0 ? "\nall checks passed" : `\n${failures} failure(s)`);
process.exitCode = failures === 0 ? 0 : 1;
