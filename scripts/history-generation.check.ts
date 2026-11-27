import assert from "node:assert/strict";
import { parseHistoryArgs } from "../lib/history-cli";
import { amendmentRows, editionChanges, generateHistoryTopic, isSgaEdition, rosterOffices } from "../lib/history-generate";
import { historyTopic } from "../config/history";

assert.deepEqual(
    rosterOffices(["Registered Student Organization Senator", "Co-Chair of the Committee on Internal Affairs", "Declared RSO Category: Religious and Spiritual Life"]),
    ["Religious and Spiritual Life RSO Senator", "Co-Chair of the Committee on Internal Affairs"],
    "a roster's RSO seat and category read as one title",
);
assert.deepEqual(rosterOffices(["Transfer Students Caucus Senator"]), ["Transfer Students Caucus Senator"]);

// An edition is read against the one before it, so its findings can say what changed.
const article = (n: number) => `Section ${n}. Unchanged text of section ${n}.`;
const before = [...Array.from({ length: 8 }, (_, i) => article(i + 1)), "5. The signatures of at least 50 interested individuals."].join("\n");
const after = [...Array.from({ length: 8 }, (_, i) => article(i + 1)), "5. The signatures of at least 40   interested individuals."].join("\n");
assert.equal(editionChanges(before, after), "- 5. The signatures of at least 50 interested individuals.\n+ 5. The signatures of at least 40 interested individuals.");
assert.equal(editionChanges(before, before.replace(/\n/g, "\n\n")), "", "blank lines and spacing are no change");
assert.equal(editionChanges(before, "An unrelated document.\nWith other text."), "", "documents too different are not editions of one text");
assert.ok(isSgaEdition({ kind: "guiding.constitution", title: "JHU SGA Constitution (Amended September 18th 2026)" }));
assert.ok(!isSgaEdition({ kind: "guiding.constitution", title: "CSE Constitution" }));
assert.ok(!isSgaEdition({ kind: "guiding.bylaws", title: "Proposed Amendment to SGA Bylaws Word" }));

// A bill's current/proposed tables are read row by row, under their section headings.
assert.deepEqual(amendmentRows([
    "3. **AMENDMENTS**",
    "| Constitution |  |",
    "| ----- | ----- |",
    "| Current Language | Proposed Language |",
    "| Chair of Programming. Shall oversee councils. | Chair of Programming. Shall oversee councils. Shall lead programming. |",
    "",
    "| Bylaws |  |",
    "| ----- | ----- |",
    "| Current Language | Proposed Language |",
    "| [https://docs.google.com/document/d/1BZ9/edit](https://docs.google.com/document/d/1BZ9/edit) | [https://docs.google.com/document/d/1e_1/edit](https://docs.google.com/document/d/1e_1/edit) |",
].join("\n")).map((row) => row.section), ["Constitution", "Bylaws"]);
assert.deepEqual(amendmentRows("| Name | Vote |\n| --- | --- |\n| Amy | Yes |"), [], "other tables are not amendments");

assert.deepEqual(parseHistoryArgs(["sexual-violence"]).slugs, ["sexual-violence"]);
assert.deepEqual(parseHistoryArgs(["one", "--limit", "25", "two"]).slugs, ["one", "two"]);
assert.equal(parseHistoryArgs(["--limit", "0"]).options.limit, 0);
for (const args of [["--limit"], ["--limit", "-1"], ["--limit", "1.5"], ["--limt", "25"]]) {
    assert.throws(() => parseHistoryArgs(args));
}

type Row = Record<string, unknown>;
const document = {
    id: "doc", title: "Minutes", displayTitle: "Minutes", kind: "minutes.senate",
    discoveredVia: "drive", driveFileId: "file", content: "The Senate discussed Title IX.",
    contentHash: "text-v1", datedAt: new Date("2019-03-04T12:00:00Z"), driveCreatedTime: null, sessionNumber: 106,
};
let cache: Row[] = [];
let events: Row[] = [];
let citations: Row[] = [];
let status: Row = { id: "topic", model: "" };
let requests = 0;
let writes = 0;
let mode = "valid";
let failCitation = false;
let register = "";
const storage = {
    $queryRawUnsafe: async () => [{ id: document.id }],
    document: { findMany: async (args: { where: { title?: unknown } }) => args.where.title
        ? [{ title: "Bill Voting Records", content: register }] : [document] },
    historyTopic: {
        // The dry run only reads the stored topic; before the first run there is none.
        findUnique: async () => (cache.length ? status : null),
        upsert: async () => status,
        update: async ({ data }: { data: Row }) => { status = { ...status, ...data }; return status; },
    },
    historyFinding: {
        findMany: async () => cache,
        upsert: async ({ create }: { create: Row }) => { cache = [create]; return create; },
    },
    historyEvent: {
        count: async () => events.length,
        findMany: async () => events,
        deleteMany: async ({ where }: { where: { batchKey: string | { notIn: string[] } } }) => {
            writes++;
            const key = where.batchKey;
            events = events.filter((event) => typeof key === "string" ? event.batchKey !== key : key.notIn.includes(event.batchKey as string));
        },
        create: async ({ data }: { data: Row }) => { const row = { id: `event-${writes}`, ...data }; events.push(row); return row; },
    },
    documentAnnotation: {
        findFirst: async () => null,
        create: async ({ data }: { data: Row }) => ({ id: "annotation", ...data }),
    },
    historyEventCitation: { create: async ({ data }: { data: Row }) => {
        if (failCitation) throw new Error("fixture citation failure");
        citations.push(data);
    } },
};
const db = {
    ...storage,
    $transaction: async <T>(work: (tx: typeof storage) => Promise<T>): Promise<T> => {
        const snapshot = structuredClone({ events, citations, status });
        try { return await work(storage); } catch (error) {
            ({ events, citations, status } = snapshot);
            throw error;
        }
    },
};
(globalThis as unknown as { prisma: unknown }).prisma = db;
process.env.AI_PROVIDER = "openai";
process.env.AI_API_KEY = "fixture";
globalThis.fetch = async (_url, init) => {
    requests++;
    const body = JSON.parse(init?.body as string);
    const extraction = body.messages[0].content.includes("You read one document");
    let response: unknown;
    if (extraction) {
        const corrected = body.messages[1].content.includes("failed validation");
        const quote = mode === "repeated-quote" && !corrected ? "e"
            : mode === "missing-quote" ? "Not in the document." : document.content;
        response = mode === "bad-extraction" ? {} : { findings: [{
            summary: "The Senate discussed Title IX.", quote,
            date: null, thread: "policy", kind: "discussion", involvement: "sga", weight: 1,
        }] };
    } else {
        if (mode === "quota") return new Response(JSON.stringify({ error: { code: "insufficient_quota" } }), { status: 429 });
        response = { events: [{ findings: mode === "bad-members" ? ["unknown", "f1"] : ["f1"],
            title: "Title IX discussion", content: `The Senate discussed Title IX. [${mode === "bad-citation" ||
                (mode === "repair-citation" && !body.messages[1].content.includes("Previous response:")) ? 2 : 1}]`,
            thread: "policy", kind: "discussion", involvement: "sga", weight: 1 }] };
    }
    return new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(response) } }] }));
};

async function main() {
    await generateHistoryTopic("sexual-violence", { dryRun: true });
    assert.equal(requests, 0);
    assert.equal(writes, 0);
    const first = await generateHistoryTopic("sexual-violence");
    assert.equal(first.events, 1);
    assert.equal(citations[0]?.ordinal, 0);
    assert.equal(status.status, "fresh");
    const before = requests;
    await generateHistoryTopic("sexual-violence");
    assert.equal(requests, before, "unchanged inputs reuse both caches");

    document.datedAt = new Date("2020-03-04T12:00:00Z");
    const published = structuredClone(events);
    await generateHistoryTopic("sexual-violence", { limit: 0 });
    assert.deepEqual(events, published, "limited refresh preserves all published events");
    assert.equal(status.status, "stale");
    await generateHistoryTopic("sexual-violence");
    assert.equal(requests, before + 2, "metadata corrections invalidate extraction and merging");
    assert.equal(events[0]?.batchKey, "2019-2020");

    const topic = historyTopic("sexual-violence")!;
    topic.terms.push("fixture-term");
    const beforeTerms = requests;
    await generateHistoryTopic("sexual-violence");
    assert.equal(requests, beforeTerms + 2, "topic match terms invalidate cached excerpts");
    topic.terms.pop();
    await generateHistoryTopic("sexual-violence");
    register = "\fSecond Reading\nDate,Bill #,Link,Status\n3/4/2020,1,Example Act,Adopted";
    const beforeRegister = requests;
    await generateHistoryTopic("sexual-violence");
    assert.equal(requests, beforeRegister + 1, "changed voting records invalidate event outcomes");

    for (mode of ["bad-extraction", "bad-members", "bad-citation", "quota"]) {
        const saved = structuredClone(events);
        const beforeWrites: number = writes;
        const result = await generateHistoryTopic("sexual-violence", { force: true });
        assert.ok(result.extractFailures + result.mergeFailures > 0, mode);
        assert.deepEqual(events, saved, `${mode} preserves published history`);
        assert.equal(writes, beforeWrites, "no event mutations before all merges succeed");
        assert.equal(status.status, "stale");
    }
    mode = "repair-citation";
    const beforeRepair = requests;
    const repaired = await generateHistoryTopic("sexual-violence", { force: true });
    assert.equal(repaired.mergeFailures, 0);
    assert.equal(requests, beforeRepair + 3, "invalid merge receives feedback and retries without re-extraction");
    assert.equal(status.status, "fresh");
    mode = "repeated-quote";
    const beforeQuote = requests;
    const lengthened = await generateHistoryTopic("sexual-violence", { force: true });
    assert.equal(lengthened.extractFailures, 0);
    assert.equal(requests, beforeQuote + 3, "an ambiguous quote receives one correction before merging");
    mode = "missing-quote";
    const beforeMissing = requests;
    const unpublished = structuredClone(events);
    const missing = await generateHistoryTopic("sexual-violence", { force: true });
    assert.equal(missing.extractFailures, 1);
    assert.equal(requests, beforeMissing + 2, "a quote still unanchored after correction fails without merging");
    assert.deepEqual(events, unpublished);
    mode = "valid";
    failCitation = true;
    const saved = structuredClone(events);
    await assert.rejects(generateHistoryTopic("sexual-violence", { force: true }), /fixture citation failure/);
    assert.deepEqual(events, saved, "citation failure rolls back replacements");
    console.log("all history generation checks passed");
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
