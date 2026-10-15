import assert from "node:assert/strict";
import { AsyncLocalStorage } from "node:async_hooks";

async function main() {
    // Exercise Next's actual cache wrapper with an in-memory persistence fixture.
    // No credentials, database connections, or live cache entries are used.
    Object.assign(globalThis, { AsyncLocalStorage });
    const entries = new Map<string, { value: unknown; tags: string[]; expires: number }>();
    let clock = 0;
    const backend = {
        generateSimpleCacheKey: async (key: string) => key,
        get: async (key: string) => {
            const entry = entries.get(key);
            return entry ? { value: entry.value, isStale: clock >= entry.expires } : null;
        },
        set: async (key: string, value: { revalidate: number }, options: { tags: string[] }) => {
            entries.set(key, { value, tags: options.tags, expires: clock + value.revalidate });
        },
    };
    let reads = 0;
    const documents = { findMany: async () => { reads++; return []; } };
    Object.assign(globalThis, {
        __incrementalCache: backend,
        prisma: { document: documents, hopkinsAffiliate: documents },
    });
    delete process.env.JHUSGA_DATA_MODE;
    const { getRecentActivity } = await import("../api/activity");
    const { getContactDirectory } = await import("../api/contact");
    const { ARCHIVE_CACHE_SECONDS, ARCHIVE_CACHE_TAG, invalidateArchiveCache } = await import("../lib/archive-cache");
    const { workAsyncStorage } = await import("next/dist/server/app-render/work-async-storage.external");

    async function renderHomepage() {
        const requestStore = {
            incrementalCache: backend,
            forceDynamic: true,
            pendingRevalidates: {} as Record<string, Promise<unknown>>,
        };
        const result = await workAsyncStorage.run(
            requestStore as unknown as Parameters<typeof workAsyncStorage.run>[0],
            getRecentActivity,
        );
        await Promise.all(Object.values(requestStore.pendingRevalidates));
        return result;
    }
    const first = await renderHomepage();
    const coldReads = reads;
    assert.ok(coldReads > 0);
    await new Promise(resolve => setTimeout(resolve, 5));
    assert.deepEqual(await renderHomepage(), first);
    assert.equal(reads, coldReads, "a new request/time must reuse the carousel without database reads");

    assert.equal((await getContactDirectory(114)).sessionNumber, 114);
    const directoryReads = reads;
    assert.equal((await getContactDirectory(114)).sessionNumber, 114);
    assert.equal(reads, directoryReads, "directory cache hits must avoid database reads");
    assert.equal((await getContactDirectory(113)).sessionNumber, 113);
    assert.ok(reads > directoryReads, "different sessions must have different cache entries");

    // Next records tags in the route context; its response lifecycle applies them.
    const store = { incrementalCache: backend, pendingRevalidatedTags: [] as { tag: string; profile: unknown }[] };
    workAsyncStorage.run(store as unknown as Parameters<typeof workAsyncStorage.run>[0], invalidateArchiveCache);
    assert.equal(store.pendingRevalidatedTags.length, 1);
    assert.equal(store.pendingRevalidatedTags[0].tag, ARCHIVE_CACHE_TAG);
    assert.deepEqual(store.pendingRevalidatedTags[0].profile, { expire: 0 });
    for (const [key, entry] of entries) {
        if (entry.tags.includes(ARCHIVE_CACHE_TAG)) entries.delete(key);
    }
    const beforeInvalidation = reads;
    await getRecentActivity();
    await getContactDirectory(114);
    assert.ok(reads > beforeInvalidation, "archive invalidation must refresh derived data");

    const beforeExpiry = reads;
    clock += ARCHIVE_CACHE_SECONDS + 1;
    await getRecentActivity();
    await getContactDirectory(114);
    assert.ok(reads > beforeExpiry, "TTL must pick up CLI updates without a sync webhook");
    process.env.JHUSGA_DATA_MODE = "demo";
    const beforeDemo = reads;
    await getRecentActivity();
    await getContactDirectory();
    assert.equal(reads, beforeDemo, "demo mode must bypass live cached data and database reads");
    console.log("all archive cache checks passed");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
