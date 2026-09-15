import {
    documentsBeingRead,
    type MatchedDocument,
    type RetrievedPassage,
} from "../lib/search";

let failures = 0;
function check(label: string, condition: boolean, detail?: unknown) {
    if (condition) {
        console.log(`  ok   ${label}`);
    } else {
        failures += 1;
        console.log(`  FAIL ${label}`, detail ?? "");
    }
}

function passage(documentId: string, title: string): RetrievedPassage {
    return {
        id: `${documentId}-passage`,
        documentId,
        documentTitle: title,
        kind: "guiding.constitution",
        sessionNumber: 114,
        contentHash: "hash",
        heading: "",
        content: "A clause.",
        score: 1,
        date: null,
    };
}

function match(id: string, title: string): MatchedDocument {
    return {
        id,
        title,
        kind: "minutes.senate",
        sessionNumber: 114,
        date: null,
        summary: "",
        excerpt: "",
        heading: "",
    };
}

console.log("documentsBeingRead");

const fromPassages = documentsBeingRead([
    passage("constitution", "SGA Constitution"),
    passage("constitution", "SGA Constitution"),
    passage("bylaws", "SGA Bylaws"),
]);

check(
    "keeps each document once, in first-seen order",
    fromPassages.map((document) => document.id).join(",") === "constitution,bylaws",
    fromPassages,
);

check(
    "uses the passage title",
    fromPassages[0]?.title === "SGA Constitution",
    fromPassages[0],
);

const fromMatches = documentsBeingRead(
    [],
    [match("minutes", "Senate Minutes"), match("minutes", "Senate Minutes")],
);

check(
    "falls back to listed matches when there are no passages",
    fromMatches.map((document) => document.id).join(",") === "minutes",
    fromMatches,
);

check(
    "does not mix matches in when passages already named the documents",
    documentsBeingRead(
        [passage("constitution", "SGA Constitution")],
        [match("minutes", "Senate Minutes")],
    ).map((document) => document.id).join(",") === "constitution",
);

check("an empty retrieval is an empty list", documentsBeingRead([], []).length === 0);

console.log(failures === 0 ? "\nall checks passed" : `\n${failures} failure(s)`);
process.exitCode = failures === 0 ? 0 : 1;
