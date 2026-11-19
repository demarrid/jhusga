import assert from "node:assert/strict";
import { parseHistoryArgs } from "../lib/history-cli";
import { generateHistoryTopic } from "../lib/history-generate";
import { historyTopic } from "../config/history";

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
    if (extraction) response = mode === "bad-extraction" ? {} : { findings: [{
        summary: "The Senate discussed Title IX.", quote: document.content,
        date: null, thread: "policy", kind: "discussion", involvement: "sga", weight: 1,
    }] };
    else {
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
    mode = "valid";
    failCitation = true;
    const saved = structuredClone(events);
    await assert.rejects(generateHistoryTopic("sexual-violence", { force: true }), /fixture citation failure/);
    assert.deepEqual(events, saved, "citation failure rolls back replacements");
    console.log("all history generation checks passed");
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
