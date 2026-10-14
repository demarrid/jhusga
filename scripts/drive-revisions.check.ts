import assert from "node:assert/strict";
import { listDriveRevisions, revisionOAuthConfigured, revisionText } from "../lib/drive-revisions";
const originalFetch = globalThis.fetch;
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
        assert.equal(tokens, 2, "reuse unexpired token");
        globalThis.fetch = async () => Response.json({revisions:[], nextPageToken:"repeat"});
        await assert.rejects(listDriveRevisions("file"), /repeated/);
        console.log("all OAuth revision checks passed");
    } finally {
        globalThis.fetch = originalFetch;
        keys.forEach((key, index) => {
            if (originalEnv[index] === undefined) delete process.env[key];
            else process.env[key] = originalEnv[index];
        });
    }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
