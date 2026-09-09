/**
 * Checks that the links SGA authors actually type resolve into references,
 * including the escaped form Google Docs exports.
 */
import { extractDocumentLinks, extractDriveLinks, resolveReferences } from "../lib/links";

let failures = 0;
function check(label: string, condition: boolean, detail?: unknown) {
    if (condition) {
        console.log(`  ok   ${label}`);
    } else {
        failures += 1;
        console.log(`  FAIL ${label}`, detail ?? "");
    }
}

const BILL = "1NNHnw-qawZSntKNthrRZInx0Z6qQrw64t7C6zW-4JQQ";
const BYLAWS = "1_X1PhkHiaV0CukRs1sfmKzqcOYUM_AHsmDAcE6qoW5I";
const SHEET = "1Qvz2Vtg0eAS2Wk-13HdvF76Nx6Ic3OK_yMa4ysxH_Ok";

console.log("extraction");

const agenda = [
    "## Second Reading",
    `* [S.B.26-27.01 Rules Bill](https://docs.google.com/document/d/${BILL}/edit?usp=sharing) - Shreemann`,
    "* An attendance sheet:",
    `  https://docs.google.com/spreadsheets/d/${SHEET}/edit?gid=0#gid=0`,
    "* Something off-site: https://jhu.campusgroups.com/sga",
].join("\n");

const links = extractDriveLinks(agenda);

check("a markdown link yields its target", links.some((link) => link.fileId === BILL), links);
check(
    "the author's link text is kept as the label",
    links.find((link) => link.fileId === BILL)?.text === "S.B.26-27.01 Rules Bill",
    links,
);
check("a bare pasted URL counts too", links.some((link) => link.fileId === SHEET), links);
check("a non-Drive link is ignored", links.length === 2, links);

// The reason this module exists: the export escapes underscores inside URLs,
// and the unescaped and escaped forms of one URL are the same document.
const escaped = `See [the bylaws](https://docs.google.com/document/d/1\\_X1PhkHiaV0CukRs1sfmKzqcOYUM\\_AHsmDAcE6qoW5I/edit?usp=sharing).`;
check(
    "an escaped URL resolves to the same file",
    extractDriveLinks(escaped)[0]?.fileId === BYLAWS,
    extractDriveLinks(escaped),
);

check(
    "one target linked twice is one reference",
    extractDriveLinks(
        `[first](https://docs.google.com/document/d/${BILL}/edit) and ` +
        `[again](https://docs.google.com/document/d/${BILL}/edit?tab=t.0)`,
    ).length === 1,
);

check(
    "an /u/0/ link still resolves",
    extractDriveLinks(`https://docs.google.com/document/u/0/d/${BILL}/mobilebasic`)[0]
        ?.fileId === BILL,
);
check(
    "a folder link is not a document reference",
    extractDriveLinks("https://drive.google.com/drive/folders/1FNVLX3o1QAulNi0JY7XwOxHpQ6Oa0KIg")
        .length === 0,
);

// A file ID is only a file ID on Drive. The SGA runs its committee placements
// through Microsoft Forms, whose URLs carry an `id` parameter of their own, and
// reading a Drive file out of one invents a document that was never linked --
// which then costs a Drive lookup every sync for a file that cannot exist.
check(
    "an id= parameter on somebody else's host is not a Drive file",
    extractDriveLinks(
        "[Committee Placements](https://forms.office.com/Pages/ResponsePage.aspx" +
        "?id=OPSkn-axO0eAP4b4rt8N7J5clWe5QddKkhzk9GCNplJURVUyVlhVR0RCRU8yTkhRMDlO)",
    ).length === 0,
    extractDriveLinks(
        "[Committee Placements](https://forms.office.com/Pages/ResponsePage.aspx" +
        "?id=OPSkn-axO0eAP4b4rt8N7J5clWe5QddKkhzk9GCNplJURVUyVlhVR0RCRU8yTkhRMDlO)",
    ),
);
check(
    "but Drive's own open?id= form still resolves",
    extractDriveLinks(`https://drive.google.com/open?id=${BILL}`)[0]?.fileId === BILL,
);

const SHAREPOINT =
    "https://livejohnshopkins-my.sharepoint.com/:w:/g/personal/axu22_jh_edu/IQBIz_DFKoCuRadSv0FTT5duAQNOCqzXUwsLgrEPlLtYn-E?e=BXlWoM";

console.log("\nsharepoint");

const treasurer = extractDocumentLinks(
    `v. Treasurer: Amy Xu\n* <${SHAREPOINT.replace(/_/g, "%5F")}>`,
);
check(
    "a SharePoint sharing URL is a document link",
    treasurer.some((link) => link.source === "sharepoint"),
    treasurer,
);
check(
    "the SharePoint token is stable across ?e= and percent-encoding",
    treasurer[0]?.fileId ===
        "sharepoint:IQBIz_DFKoCuRadSv0FTT5duAQNOCqzXUwsLgrEPlLtYn-E",
    treasurer[0]?.fileId,
);
check(
    "a SharePoint folder is not a document",
    extractDocumentLinks(
        "https://livejohnshopkins-my.sharepoint.com/:f:/g/personal/axu22_jh_edu/IQBIz_DFKoCuRadSv0FTT5duAQNOCqzXUwsLgrEPlLtYn-E",
    ).length === 0,
);
check(
    "Drive extraction still ignores SharePoint",
    extractDriveLinks(SHAREPOINT).length === 0,
);

console.log("\nresolution");

const documents = [
    { id: "agenda", driveFileId: "agenda-file", content: agenda },
    { id: "bill", driveFileId: BILL, content: "A bill." },
    {
        id: "minutes",
        driveFileId: "minutes-file",
        // Minutes routinely link to their own Drive file.
        content: `Read [the bill](https://docs.google.com/document/d/${BILL}/edit) at [this doc](https://docs.google.com/document/d/minutes-file/edit)`,
    },
];

const edges = resolveReferences(documents);

check(
    "a link to an ingested document becomes an edge",
    edges.some((edge) => edge.fromDocumentId === "agenda" && edge.toDocumentId === "bill"),
    edges,
);
check(
    "a link to a document we do not hold is dropped",
    !edges.some((edge) => edge.toDocumentId === SHEET),
    edges,
);
check(
    "a self-link is not a reference",
    !edges.some((edge) => edge.fromDocumentId === edge.toDocumentId),
    edges,
);
check(
    "backlinks are the same edges read the other way",
    edges.filter((edge) => edge.toDocumentId === "bill").map((edge) => edge.fromDocumentId)
        .sort().join(",") === "agenda,minutes",
    edges,
);

console.log(failures === 0 ? "\nall checks passed" : `\n${failures} failure(s)`);
process.exitCode = failures === 0 ? 0 : 1;
