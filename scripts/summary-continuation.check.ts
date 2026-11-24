import assert from 'node:assert/strict';
import { dispatchSyncContinuation, modelStep, requestSyncContinuation, type Slice } from '../lib/sync-run';
import { summarizeDocument } from '../lib/summarize';
import { emptySyncSummary } from '../lib/sync';
import { hasCronSecret } from '../lib/cron-auth';

async function main() {
    const previousSecret = process.env.CRON_SECRET;
    const originalWarn = console.warn;
    const authLogs: unknown[][] = [];
    console.warn = (...args) => { authLogs.push(args); };
    try {
        process.env.CRON_SECRET = 'private-fixture-token';
        assert.equal(hasCronSecret(new Request('https://example.org', {headers:{authorization:'Bearer private-fixture-token'}})), true);
        assert.equal(authLogs.length, 0);
        assert.equal(hasCronSecret(new Request('https://example.org')), false);
        assert.equal(hasCronSecret(new Request('https://example.org', {headers:{authorization:'Bearer wrong-private-token'}})), false);
        delete process.env.CRON_SECRET;
        assert.equal(hasCronSecret(new Request('https://example.org')), false);
        const serialized = JSON.stringify(authLogs);
        assert.match(serialized, /header-missing/);
        assert.match(serialized, /credential-mismatch/);
        assert.match(serialized, /secret-missing/);
        assert.ok(!serialized.includes('private-fixture-token') && !serialized.includes('wrong-private-token'));
    } finally {
        console.warn = originalWarn;
        if (previousSecret === undefined) delete process.env.CRON_SECRET;
        else process.env.CRON_SECRET = previousSecret;
    }
    let now = Date.now();
    Date.now = () => now;
    let requests = 0;
    let checkpoints = 0;
    const handoffErrors: string[] = [];
    type Summary = { id: string; status: string; promptHash: string; model: string; content: string };
    const documents = ['one', 'two'].map(id => ({
        id, title: id, kind: 'unknown', content: 'A substantive record. '.repeat(40),
        contentHash: id, summary: null as Summary | null,
    }));
    Object.assign(globalThis, { prisma: {
        syncRun: { updateMany: async ({ data }: { data: { error: string } }) => {
            handoffErrors.push(data.error);
            return { count: 1 };
        } },
        document: {
            findMany: async ({ where }: { where: { id?: { notIn: string[] } } }) =>
                documents.filter(doc => !where.id?.notIn.includes(doc.id)),
            findUnique: async ({ where }: { where: { id: string } }) => documents.find(doc => doc.id === where.id),
        },
        documentSummary: {
            upsert: async ({ where, create }: { where: { documentId: string }; create: Summary }) => {
                documents.find(doc => doc.id === where.documentId)!.summary = { ...create, id: where.documentId };
            },
        },
        documentSummaryCitation: { count: async () => 0 },
    } });
    process.env.AI_PROVIDER = 'openai';
    process.env.AI_API_KEY = 'fixture';
    globalThis.fetch = async () => {
        requests++;
        now += 35_000;
        const result = requests === 1 ? { insufficientContent: true } : { content: 'Unsupported claim.', citations: [{ quote: 'Not in the document' }] };
        return Response.json({ choices: [{ message: { content: JSON.stringify(result) }, finish_reason: 'stop' }] });
    };
    const slice: Slice = {
        state: { force: false, modelWork: true, summary: emptySyncSummary('fixture'), lookupsLeft: 0, attempt: { step: 'model', count: 1 }, skipped: [] },
        deadline: now + 40_000,
        beforeDeadline: () => now < slice.deadline,
        takeStuck: () => false,
        files: async () => [], saveFiles: async () => {},
        checkpoint: async () => { checkpoints++; },
    };
    assert.equal(await modelStep(slice), false, 'remaining work must continue, not finish the sync');
    assert.equal(requests, 1, 'do not start a second request with only five seconds left');
    assert.equal(checkpoints, 1);
    // Simulate reloading persisted state in a different function invocation.
    slice.state = structuredClone(slice.state);
    slice.deadline = now + 40_000;
    assert.equal(await modelStep(slice), false);
    assert.deepEqual(slice.state.summaries?.considered, ['one', 'two']);
    assert.equal(requests, 2, 'the next slice must exclude already considered documents');
    assert.equal(documents[1].summary?.status, 'failed');
    slice.deadline = now + 40_000;
    assert.equal(await modelStep(slice), true, 'an exhausted queue finishes without retrying the failed document');
    assert.equal((await summarizeDocument('one')).skipped, true, 'cache an unchanged model-generated empty verdict');
    assert.equal(requests, 2);
    slice.state.summaries!.calls = 25;
    assert.equal(await modelStep(slice), true, 'the cost cap applies across all slices');
    assert.equal(requests, 2);
    const handedOff: string[] = [];
    globalThis.fetch = async (input, init) => {
        const url = String(input);
        handedOff.push(url);
        assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer fixture');
        assert.equal(init?.redirect, 'manual');
        return handedOff.length === 1
            ? new Response(null, { status: 308, headers: { location: 'https://www.jhusga.org/api/sync/continue' } })
            : new Response(null, { status: 202 });
    };
    assert.equal((await requestSyncContinuation('run', 'https://jhusga.org', 'fixture')).status, 202);
    assert.equal(handedOff.length, 2, 'the canonical host receives an authenticated continuation');
    let unsafeCalls = 0;
    globalThis.fetch = async () => {
        unsafeCalls++;
        return new Response(null, { status: 308, headers: { location: 'https://unrelated.example/api/sync/continue' } });
    };
    await assert.rejects(requestSyncContinuation('run', 'https://jhusga.org', 'fixture'), /unexpected redirect/);
    assert.equal(unsafeCalls, 1, 'credentials must never be sent to an unrelated host');
    let dispatches = 0;
    globalThis.fetch = async () => {
        dispatches++;
        return new Response(null, { status: dispatches === 1 ? 503 : 202 });
    };
    await dispatchSyncContinuation('run', 'https://www.jhusga.org', 'fixture');
    assert.equal(dispatches, 2, 'retry a transient hand-off failure within the time margin');
    assert.equal(handoffErrors.length, 0);
    dispatches = 0;
    globalThis.fetch = async () => {
        dispatches++;
        return new Response(null, { status: 401 });
    };
    await assert.rejects(dispatchSyncContinuation('run', 'https://www.jhusga.org', 'fixture'), /HTTP 401/);
    assert.equal(dispatches, 1, 'do not retry invalid credentials');
    assert.match(handoffErrors.at(-1)!, /HTTP 401/, 'persist the reason instead of silently leaving a running job');
    dispatches = 0;
    globalThis.fetch = async () => { dispatches++; throw new Error('network unavailable'); };
    await assert.rejects(dispatchSyncContinuation('run', 'https://www.jhusga.org', 'fixture'), /network unavailable/);
    assert.equal(dispatches, 2, 'network retries are bounded');
    assert.match(handoffErrors.at(-1)!, /network unavailable/);
    console.log('all summary continuation checks passed');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
