import assert from "node:assert/strict";

async function main() {
    process.env.NEWSLETTER_REQUEST_DELAY_MS = "0";
    const held = new Set<string>();
    let writes = 0;
    let checkedThrough = new Date("2026-11-10T12:00:00Z");
    let checkpointWrites = 0;
    const searchUrls: URL[] = [];
    const db = {
        newsletterCheckpoint: {
            upsert: async () => ({ checkedThrough }),
            updateMany: async ({ data }: { data: { checkedThrough: Date } }) => {
                checkedThrough = data.checkedThrough;
                checkpointWrites++;
                return { count: 1 };
            },
        },
        document: {
            findMany: async () => [...held].map(driveFileId => ({ driveFileId })),
            findUnique: async () => null,
            upsert: async ({ create }: { create: { driveFileId: string } }) => {
                writes++;
                held.add(create.driveFileId);
                return { id: "article" };
            },
        },
        newsletterMiss: { findMany: async () => [], deleteMany: async () => ({ count: 0 }) },
        documentRevision: { upsert: async () => ({ id: "revision" }) },
        documentVersion: { upsert: async () => ({}) },
        documentPassage: { deleteMany: async () => ({}), createMany: async () => ({}) },
        $transaction: async (work: ((tx: unknown) => unknown) | Promise<unknown>[]) =>
            typeof work === "function" ? work(db) : Promise.all(work),
    };
    Object.assign(globalThis, { prisma: db });
    const { ingestNewsletterCoverage } = await import("../lib/coverage");
    const { fetchPage, NewsletterBudgetReached, searchWindow, yearRange } = await import("../lib/newsletter");
    const originalFetch = globalThis.fetch;
    let requests = 0;
    const listing = `<strong>1 item</strong><article class="clearfix"><h4><a href="/article/2026/11/sga-test">SGA test</a></h4></article>`;
    globalThis.fetch = async (input) => {
        requests++;
        if (String(input).includes("/search")) searchUrls.push(new URL(String(input)));
        return new Response(String(input).includes("/search") ? listing :
            `<h1 class="headline">SGA test</h1><div class="article-content"><p>The SGA discussed student government plans.</p></div>`);
    };
    try {
        const first = await ingestNewsletterCoverage({ runBudgetMs: 1000 });
        assert.equal(first.articlesCreated, 1, "cron saves articles without an onEvent logger");
        assert.equal(writes, 1);
        assert.equal(searchUrls[0]!.searchParams.get("ts_day"), "10", "search resumes from the stored check date");
        assert.equal(checkpointWrites, 1, "complete run advances checkpoint");
        assert.equal(requests, 3, "two searches and one article; no empty pagination requests");
        const catchup = await ingestNewsletterCoverage({ runBudgetMs: 1000, since: new Date("2026-10-27T00:00:00Z") });
        assert.equal(catchup.alreadyHeld, 1);
        assert.equal(checkpointWrites, 1, "one-time catch-up preserves the daily checkpoint");
        assert.equal(searchUrls.at(-1)!.searchParams.get("ts_month"), "10");
        assert.equal(searchUrls.at(-1)!.searchParams.get("ts_day"), "27");
        requests -= 2; // Keep the subsequent routine-run request assertions independent.
        const second = await ingestNewsletterCoverage({ runBudgetMs: 1000 });
        assert.equal(second.alreadyHeld, 1);
        assert.equal(requests, 5, "held articles are not fetched again");
        const expired = await ingestNewsletterCoverage({ runBudgetMs: 0 });
        assert.equal(expired.budgetReached, true);
        assert.equal(checkpointWrites, 2, "budget-limited runs retain the previous checkpoint");
        assert.equal(requests, 5, "expired runs make no network requests");

        globalThis.fetch = async () => new Response("failed", { status: 403 });
        await assert.rejects(ingestNewsletterCoverage({ runBudgetMs: 1000 }), /search failed/);
        assert.equal(checkpointWrites, 2, "failed searches cannot advance the checkpoint");

        held.clear();
        globalThis.fetch = async (input) => new Response(String(input).includes("/search") ? listing : "");
        const unreadable = await ingestNewsletterCoverage({ runBudgetMs: 1000 });
        assert.equal(unreadable.articlesUnreadable, 1);
        assert.equal(checkpointWrites, 2, "unreadable articles remain eligible for retry");
        const limited = await ingestNewsletterCoverage({ runBudgetMs: 1000, limit: 0 });
        assert.equal(limited.budgetReached, true);
        assert.equal(checkpointWrites, 2, "article limits do not skip pending candidates");
        await ingestNewsletterCoverage({ runBudgetMs: 1000, years: [2026] });
        assert.equal(checkpointWrites, 2, "manual year searches leave the daily checkpoint alone");

        globalThis.fetch = async () => new Response("busy", { status: 503 });
        await assert.rejects(fetchPage("https://example.test", Date.now() + 20), NewsletterBudgetReached,
            "retry backoff cannot exceed the run deadline");

        globalThis.fetch = async (_input, init) => new Promise<Response>((_resolve, reject) => {
            init!.signal!.addEventListener("abort", () => reject(init!.signal!.reason), { once: true });
        });
        // AbortSignal timers are unref'd; keep the test alive while the request hangs.
        const keepAlive = setInterval(() => {}, 100);
        try {
            await assert.rejects(fetchPage("https://example.test", Date.now() + 25), NewsletterBudgetReached);
        } finally { clearInterval(keepAlive); }

        let pages = 0;
        globalThis.fetch = async () => { pages++; return new Response(pages === 1 ? listing.replace("1 item", "2 items") : ""); };
        await searchWindow("sga", yearRange(2026), { maxPages: 3 });
        assert.equal(pages, 2, "incomplete result counts still paginate");
        console.log("newsletter ingestion checks passed");
    } finally { globalThis.fetch = originalFetch; }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
