import {
    answerQuestion,
    documentsBeingRead,
    retrieve,
    sourceDocumentsForQuestion,
    type MatchedDocument,
    type RetrievedPassage,
} from "../lib/search";
import { SESSION_NUMBER } from "../config/sga";

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

async function retrievalChecks() {
    console.log("\narchive retrieval");
    const fixture = (id: string, kind: string, session: number | null, rank = 1) => ({
        id: `${id}-passage`, documentId: id, heading: "Elections", content: "Election dispute evidence.",
        title: kind === "guiding.constitution" ? "SGA Constitution" : id,
        displayTitle: "", kind, sessionNumber: session, rank, contentHash: id,
        datedAt: new Date(id === "latest" ? "2026-09-01T12:00:00Z" : "2024-09-01T12:00:00Z"),
        driveCreatedTime: null, driveModifiedTime: null,
    });
    const rows = [
        fixture("old-minutes", "minutes.senate", SESSION_NUMBER - 2, 1.3),
        fixture("old-decision", "judicial.opinion", SESSION_NUMBER - 2, 1.2),
        fixture("old-resolution", "resolution", SESSION_NUMBER - 2),
        fixture("old-bill", "bill.other", SESSION_NUMBER - 2),
        fixture("undated-record", "unknown", null),
        fixture("reporting", "newsletter.article", null),
        // Same session: session membership alone must not make an edition current.
        fixture("older", "guiding.constitution", SESSION_NUMBER),
        fixture("latest", "guiding.constitution", SESSION_NUMBER),
    ];
    let searches = 0;
    Object.assign(globalThis, { prisma: {
        $queryRaw: async () => { searches += 1; return rows; },
        document: { findMany: async () => rows
            .filter(row => row.kind === "guiding.constitution")
            .map(row => ({ ...row, id: row.documentId, lineageKey: "" })) },
        documentSummary: { findMany: async () => [] },
        searchAnswer: { findUnique: async () => null },
    } });

    const question = "tell me about election disputes";
    const broad = await retrieve(question);
    check("open-ended questions use archive focus", broad.focus === "archive");
    check("older primary records and undated records survive retrieval",
        rows.every(row => broad.passages.some(p => p.documentId === row.documentId)));
    check("minutes outrank weaker constitutional matches for open-ended questions",
        broad.passages[0]?.documentId === "old-minutes");
    check("older governing edition is labelled even in the current session",
        broad.passages.find(p => p.documentId === "older")?.governingEdition === "older");
    check("latest governing edition is labelled independently of session",
        broad.passages.find(p => p.documentId === "latest")?.governingEdition === "latest");

    const current = await retrieve("what are the current election rules");
    check("explicit current rules prioritize the latest governing edition",
        current.focus === "current" && current.passages[0]?.documentId === "latest");
    check("current rules retain older minutes and judicial context",
        current.passages.some(p => p.documentId === "old-minutes") &&
        current.passages.some(p => p.documentId === "old-decision"));
    check("current rules keep older editions as labelled context",
        current.passages.some(p => p.documentId === "older" && p.governingEdition === "older"));

    const forced = await retrieve(question, { focus: "current" });
    check("a mistaken or overridden intent cannot cut historical sources",
        forced.passages.length === broad.passages.length);

    const apiKey = process.env.AI_API_KEY;
    delete process.env.AI_API_KEY;
    try {
        const before = searches;
        const [answer, sources] = await Promise.all([
            answerQuestion(question), sourceDocumentsForQuestion(question),
        ]);
        check("answer and progress share the same broad retrieval", searches === before + 1);
        check("source progress names the documents actually retrieved",
            sources.map(s => s.id).join(",") === answer.matches.map(m => m.id).join(","));
        check("no model key still returns historical matches with archive reading",
            answer.status === "unavailable" && answer.reading === "archive" &&
            answer.matches.some(m => m.id === "old-decision"));
    } finally {
        if (apiKey !== undefined) process.env.AI_API_KEY = apiKey;
    }
}

retrievalChecks().catch(error => {
    failures += 1;
    console.error(error);
}).finally(() => {
    console.log(failures === 0 ? "\nall checks passed" : `\n${failures} failure(s)`);
    process.exitCode = failures === 0 ? 0 : 1;
});
