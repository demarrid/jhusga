import assert from "node:assert/strict";
import { listDriveRevisions, minutesMissingRevisionHistory, refreshRevisionAuthors, revisionOAuthConfigured, revisionText, revisionRetryDelay } from "../lib/drive-revisions";
const originalFetch = globalThis.fetch;
const originalNow = Date.now;
const originalTimeout = globalThis.setTimeout;
let clock = Date.now();
const waits: number[] = [];
Date.now = () => clock;
globalThis.setTimeout = ((callback: () => void, delay = 0) => {
    waits.push(delay); clock += delay; callback(); return 0;
}) as unknown as typeof setTimeout;
const keys = ["GOOGLE_OAUTH_CLIENT_ID", "GOOGLE_OAUTH_CLIENT_SECRET", "GOOGLE_OAUTH_REFRESH_TOKEN"];
const originalEnv = keys.map(key => process.env[key]);
async function main() {
    try {
        for (const key of keys) delete process.env[key];
        assert.equal(revisionOAuthConfigured(), false);
        process.env.GOOGLE_OAUTH_CLIENT_ID = "fake-client";
        assert.throws(revisionOAuthConfigured, /all three/);
        process.env.GOOGLE_OAUTH_CLIENT_SECRET = "fake-secret";
        process.env.GOOGLE_OAUTH_REFRESH_TOKEN = "fake-refresh";
        let tokens = 0;
        const pages: string[] = [];
        let unauthorized = true;
        globalThis.fetch = async (input, init) => {
            const url = new URL(String(input));
            if (url.hostname === "oauth2.googleapis.com") {
                tokens += 1;
                assert.equal(new URLSearchParams(String(init?.body)).get("grant_type"), "refresh_token");
                return Response.json({access_token: "fake-access", expires_in: 3600});
            }
            assert.equal((init?.headers as Record<string,string>).Authorization,
                url.hostname.endsWith(".googleusercontent.com") ? undefined : "Bearer fake-access");
            assert.equal(init?.redirect, "manual");
            if (url.pathname.endsWith("/revisions")) {
                if (unauthorized) { unauthorized = false; return new Response("", {status:401}); }
                const page = url.searchParams.get("pageToken") ?? "first";
                pages.push(page);
                const revision = {id: page, modifiedTime: "2026-10-01T00:00:00Z", lastModifyingUser: {displayName:"Some Person"}};
                return Response.json({revisions:[revision], ...(page === "first" ? {nextPageToken:"second"} : {})});
            }
            if (url.pathname === "/gone") return new Response("", {status:410});
            if (url.pathname === "/broken") return new Response("", {status:400});
            if (url.pathname === "/redirect") return new Response("", {status:302, headers:{location:"https://download.googleusercontent.com/text"}});
            if (url.pathname === "/unsafe") return new Response("", {status:302, headers:{location:"https://evil.example/export"}});
            return new Response("historic text");
        };
        const revisions = await listDriveRevisions("file/with-special-chars");
        assert.deepEqual(pages, ["first", "second"]);
        assert.equal(tokens, 2);
        assert.equal(revisions.length, 2);
        const revision = {id:"r", modifiedTime:"2026-10-01T00:00:00Z"};
        assert.equal(await revisionText(revision), null);
        assert.equal(await revisionText({...revision, exportLinks:{"text/plain":"https://docs.google.com/gone"}}), null);
        assert.equal(await revisionText({...revision, exportLinks:{"text/plain":"https://docs.google.com/text"}}), "historic text");
        assert.equal(await revisionText({...revision, exportLinks:{"text/plain":"https://docs.google.com/redirect"}}), "historic text");
        await assert.rejects(revisionText({...revision, exportLinks:{"text/plain":"https://docs.google.com/unsafe"}}), /Untrusted/);
        await assert.rejects(revisionText({...revision, exportLinks:{"text/plain":"https://evil.example/export"}}), /Untrusted/);
        await assert.rejects(revisionText({...revision, exportLinks:{"text/plain":"https://docs.google.com/broken"}}), /400/);
        assert.equal(await revisionText({...revision, exportLinks:{"text/plain":"https://docs.google.com/broken",
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document":"https://docs.google.com/gone"}}), null,
            "a failed plain-text export falls back to the DOCX export");
        assert.equal(tokens, 2, "reuse unexpired token");
        globalThis.fetch = async () => Response.json({revisions:[], nextPageToken:"repeat"});
        await assert.rejects(listDriveRevisions("file"), /repeated/);
        assert.equal(revisionRetryDelay("90", 0), 90_000);
        assert.equal(revisionRetryDelay(new Date(clock + 120_000).toUTCString(), 0, clock),
            Date.parse(new Date(clock + 120_000).toUTCString()) - clock);
        assert.equal(revisionRetryDelay("invalid", 2), 20_000);
        assert.equal(revisionRetryDelay(null, 4), 80_000);
        const starts: number[] = [];
        globalThis.fetch = async () => {
            starts.push(clock);
            return starts.length < 3 ? new Response("", {status: 429, headers: {"retry-after": "12"}})
                : new Response("retried text");
        };
        assert.equal(await revisionText({...revision, exportLinks:{"text/plain":"https://docs.google.com/retry"}}), "retried text");
        assert.ok(starts[1] - starts[0] >= 12_000);
        assert.ok(starts[2] - starts[1] >= 12_000);
        assert.ok(waits.some(wait => wait === 1500), "requests are paced even without errors");
        globalThis.fetch = async input => String(input).includes("/revisions?")
            ? Response.json({revisions: []})
            : Response.json({capabilities: {canReadRevisions: false}});
        await assert.rejects(listDriveRevisions("reader-only"), /Editor access/);
        globalThis.fetch = async input => String(input).includes("/revisions?")
            ? Response.json({revisions: []})
            : Response.json({capabilities: {canReadRevisions: true}});
        assert.deepEqual(await listDriveRevisions("empty-history"), []);
        const importedFiles: string[] = [];
        const access = { configured: () => true, importFile: async (fileId?: string) => {
            assert.ok(fileId, "sync never requests a full-corpus revision backfill");
            importedFiles.push(fileId);
            return { imported: 2, failed: 0 };
        } };
        assert.deepEqual(await refreshRevisionAuthors([], { ...access, configured: () => { throw new Error("must not check OAuth for unchanged files"); } }),
            { imported: 0, failed: 0, skipped: 0 });
        assert.deepEqual(await refreshRevisionAuthors(["new-minutes", "changed-minutes", "new-minutes"], access),
            { imported: 4, failed: 0, skipped: 0 });
        assert.deepEqual(importedFiles, ["new-minutes", "changed-minutes"]);
        assert.deepEqual(await refreshRevisionAuthors(["unconfigured"], { ...access, configured: () => false }),
            { imported: 0, failed: 0, skipped: 1 });
        assert.equal(importedFiles.length, 2);
        const originalError = console.error;
        try {
            console.error = () => {};
            assert.deepEqual(await refreshRevisionAuthors(["broken", "healthy"], { ...access, importFile: async id => {
                if (id === "broken") throw new Error("access denied");
                return { imported: 1, failed: 0 };
            } }), { imported: 1, failed: 1, skipped: 0 });
        } finally { console.error = originalError; }
        clock += 24 * 60 * 60_000;
        globalThis.fetch = async () => Response.json({ error: "invalid_grant", error_description: "private details" }, { status: 400 });
        await assert.rejects(listDriveRevisions("expired"), error => {
            assert.ok(error instanceof Error);
            assert.match(error.message, /npm run drive:connect/);
            assert.match(error.message, /seven days/);
            assert.ok(!error.message.includes("private details"));
            return true;
        });
        type Query = { take?: number; where: Record<string, unknown>; orderBy: unknown[] };
        const queries: Query[] = [];
        (globalThis as { prisma?: unknown }).prisma = { document: { findMany: async (query: Query) => {
            queries.push(query);
            return [{ driveFileId: "uncredited-minutes" }];
        } } };
        assert.deepEqual(await minutesMissingRevisionHistory(0), [], "a zero cap reads nothing");
        assert.equal(queries.length, 0);
        assert.deepEqual(await minutesMissingRevisionHistory(10, ["changed-minutes"]), ["uncredited-minutes"]);
        const [query] = queries;
        assert.equal(query!.take, 10);
        assert.deepEqual(query!.where.driveRevisions, { none: {} }, "only files with no stored history are retried");
        assert.deepEqual(query!.where.driveFileId, { notIn: ["changed-minutes"] }, "this run's changed files are not double-counted");
        assert.equal(query!.where.meetingRole, "minutes");
        assert.equal(query!.where.reviewState, "published", "held edits never have history read");
        assert.deepEqual(query!.orderBy[0], { sessionNumber: { sort: "desc", nulls: "last" } }, "current session first");
        console.log("all OAuth revision checks passed");
    } finally {
        globalThis.fetch = originalFetch;
        Date.now = originalNow;
        globalThis.setTimeout = originalTimeout;
        keys.forEach((key, index) => {
            if (originalEnv[index] === undefined) delete process.env[key];
            else process.env[key] = originalEnv[index];
        });
    }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
