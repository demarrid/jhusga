import assert from "node:assert/strict";
import { summarizeStaleDocuments } from "../lib/summarize";
import { generateJson, isAiQuotaExhausted } from "../lib/ai";

async function main() {
    let requests = 0;
    const writes: { update: { status: string; content?: string } }[] = [];
    const document = {
        id: "minutes", title: "Minutes", kind: "minutes.senate",
        content: "A substantive record of a meeting. ".repeat(30), contentHash: "changed",
        summary: { id: "summary", status: "stale", promptHash: "old", model: "old", content: "Existing verified summary." },
    };
    // All persistence and provider calls are fixtures; this suite never connects.
    (globalThis as unknown as { prisma: unknown }).prisma = {
        document: {
            findMany: async () => [{ id: "minutes", title: "Minutes" }, { id: "next", title: "Next" }],
            findUnique: async () => document,
        },
        documentSummary: { upsert: async (data: typeof writes[number]) => { writes.push(data); } },
    };
    process.env.AI_PROVIDER = "openai";
    process.env.AI_API_KEY = "fixture";
    globalThis.fetch = async () => {
        requests++;
        return new Response(JSON.stringify({ error: { code: "insufficient_quota", message: "credit_balance_exhausted" } }), { status: 429 });
    };
    const results = await summarizeStaleDocuments({ limit: 25 });
    assert.equal(requests, 1, "billing exhaustion must stop subsequent provider calls");
    assert.equal(results.length, 1, "unattempted documents remain queued");
    assert.equal(writes[0]?.update.status, "stale", "existing summaries remain visible");
    assert.equal(writes[0]?.update.content, undefined, "refresh failure must not replace cached text");
    document.summary.content = "";
    await summarizeStaleDocuments({ limit: 25 });
    assert.equal(writes[1]?.update.status, "failed", "missing summaries carry a failure rather than usable stale status");
    assert.equal(isAiQuotaExhausted("429 rate_limit_exceeded"), false, "ordinary throttling is distinct from billing exhaustion");
    const beforeDeadlineCheck = requests;
    await assert.rejects(generateJson({ system: "fixture", user: "fixture", deadline: Date.now() - 1 }), /deadline reached/);
    assert.equal(requests, beforeDeadlineCheck, "expired pipeline deadline prevents provider calls");
    console.log("all summary failure checks passed");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
