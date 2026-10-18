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
    let directoryReads = 0;
    const meeting = { id: "meeting-fixture", title: "Committee Minutes", displayTitle: "", kind: "minutes.committee",
        meetingRole: "minutes", meetingKey: "114:committee:fixture", folderPath: "Committees/Minutes",
        datedAt: new Date("2026-01-01T12:00:00Z"), content: "", sessionNumber: 114, summary: null,
        driveOwnerName: "Jane Example", driveOwnerEmail: "" };
    const documents = {
        findMany: async () => { reads++; return []; },
        groupBy: async () => { reads++; return []; },
    };
    const archiveDocuments = { ...documents, findMany: async (query: { where?: { meetingRole?: string; sessionNumber?: number }; select?: Record<string, unknown> }) => {
        reads++;
        if (query.where?.meetingRole === "minutes") return [meeting];
        if (query.where?.sessionNumber !== undefined) { directoryReads++; return []; }
        if (query.select?.driveOwnerName) return [meeting];
        if (query.select?.id && query.select?.sessionNumber && Object.keys(query.select).length === 2) return [{id: meeting.id, sessionNumber: 114}];
        return [];
    } };
    Object.assign(globalThis, {
        __incrementalCache: backend,
        prisma: { document: archiveDocuments, driveRevision: documents, hopkinsAffiliate: documents, hopkinsCategory: documents, documentContributor: documents },
    });
    delete process.env.JHUSGA_DATA_MODE;
    const { getRecentActivity } = await import("../server/activity");
    const { getPeopleInUse, getOfficesInUse, getContributorRolesInUse, getDocumentKindsInUse } = await import("../server/documents");
    const filters = [getPeopleInUse, getOfficesInUse, getContributorRolesInUse, getDocumentKindsInUse];
    const { getContactDirectory } = await import("../server/contact");
    const { ARCHIVE_CACHE_SECONDS, DIRECTORY_CACHE_SECONDS, ARCHIVE_CACHE_TAG, invalidateArchiveCache } = await import("../lib/archive-cache");
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
    assert.equal(first[0]?.cards[0]?.authors, "Jane Example");
    assert.equal(directoryReads, 1, "a populated carousel must resolve its directory");
    const coldReads = reads;
    assert.ok(coldReads > 0);
    await new Promise(resolve => setTimeout(resolve, 5));
    assert.deepEqual(await renderHomepage(), first);
    assert.equal(reads, coldReads, "a new request/time must reuse the carousel without database reads");

    assert.equal((await getContactDirectory(114)).sessionNumber, 114);
    const directoryReadCount = reads;
    assert.equal((await getContactDirectory(114)).sessionNumber, 114);
    assert.equal(reads, directoryReadCount, "directory cache hits must avoid database reads");
    assert.equal((await getContactDirectory(113)).sessionNumber, 113);
    assert.ok(reads > directoryReadCount, "different sessions must have different cache entries");

    for (const filter of filters) {
        await filter(114);
        const cold = reads;
        await filter(114);
        assert.equal(reads, cold, "filter options must be shared across requests");
        await filter("all");
        assert.equal(reads, cold + 1, "archive scope must have a separate cache entry");
    }

    const beforeActivityRefresh = directoryReads;
    clock += ARCHIVE_CACHE_SECONDS + 1;
    await renderHomepage();
    await renderHomepage();
    assert.equal(directoryReads, beforeActivityRefresh, "refreshing homepage activity must reuse the independent directory cache");

    // Next records tags in the route context; its response lifecycle applies them.
    const store = { incrementalCache: backend, pendingRevalidatedTags: [] as { tag: string; profile: unknown }[] };
    workAsyncStorage.run(store as unknown as Parameters<typeof workAsyncStorage.run>[0], invalidateArchiveCache);
    assert.equal(store.pendingRevalidatedTags.length, 1);
    assert.equal(store.pendingRevalidatedTags[0].tag, ARCHIVE_CACHE_TAG);
    assert.deepEqual(store.pendingRevalidatedTags[0].profile, { expire: 0 });
    for (const [key, entry] of entries) {
        if (entry.tags.includes(ARCHIVE_CACHE_TAG)) entries.delete(key);
    }
    for (const filter of filters) {
        const before = reads;
        await filter(114);
        assert.equal(reads, before + 1, "sync invalidation must refresh each filter");
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
    for (const filter of filters) {
        const before = reads;
        await filter(114);
        assert.equal(reads, before + 1, "filter TTL must pick up CLI updates");
    }
    clock += DIRECTORY_CACHE_SECONDS + 1;
    const beforeDirectoryExpiry = directoryReads;
    await getContactDirectory(114);
    assert.equal(directoryReads, beforeDirectoryExpiry + 1, "directory fallback TTL must pick up CLI updates");
    process.env.JHUSGA_DATA_MODE = "demo";
    const beforeDemo = reads;
    await getRecentActivity();
    await getContactDirectory();
    for (const filter of filters) await filter(114);
    assert.equal(reads, beforeDemo, "demo mode must bypass live cached data and database reads");
    console.log("all archive cache checks passed");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
