import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";
import { audience, routeGroup, requestKind } from "../lib/telemetry-policy";
import { flushMetrics, measureDatabase, measureSync } from "../lib/telemetry";
import { proxy } from "../proxy";
import { NextRequest } from "next/server";

async function main() {
    const original = console.log;
    const lines: string[] = [];
    const previous = process.env.TELEMETRY_ENABLED;
    console.log = (line: string) => { lines.push(line); };
    try {
        process.env.TELEMETRY_ENABLED = "true";
        assert.equal(audience(new Headers({ dnt: "1", "user-agent": "Googlebot" })), null);
        assert.equal(audience(new Headers({ "sec-gpc": "1" })), null);
        assert.equal(audience(new Headers({ "user-agent": "Googlebot" })), "self-declared-automation");
        assert.equal(audience(new Headers({ "user-agent": "Mozilla/5.0" })), "unknown");
        assert.equal(routeGroup("/documents/private-id?secret=search"), "documents");
        assert.equal(routeGroup("/api/documents/private-id/refresh"), "api/documents");
        assert.equal(routeGroup("/secret-person"), "other");
        assert.equal(requestKind(new Headers({ "next-router-prefetch": "1" })), "prefetch");
        const response = proxy(new NextRequest("https://example.org/documents/private-id?search=secret", {
            headers: { "user-agent": "Mozilla/5.0 sensitive", cookie: "session=secret", "x-forwarded-for": "192.0.2.1" },
        }));
        assert.equal(response.status, 200);
        assert.equal(response.headers.get("set-cookie"), null);
        assert.equal(lines.length, 1);
        assert.deepEqual(JSON.parse(lines[0]), { metric: "sga.request.v1", route: "documents", source: "unknown", kind: "request", count: 1 });
        proxy(new NextRequest("https://example.org/documents/private-id", { headers: { "sec-gpc": "1" } }));
        assert.equal(lines.length, 1);
        const secretError = new Error("secret SQL parameters");
        assert.equal(await measureDatabase(async () => 42), 42);
        await assert.rejects(measureDatabase(async () => { throw secretError; }), error => error === secretError);
        await measureSync(async () => measureDatabase(async () => "done"));
        flushMetrics();
        const db = lines.map(x => JSON.parse(x)).filter(x => x.metric === "sga.database.v1");
        assert.equal(db.reduce((n, x) => n + x.count, 0), 3);
        assert.equal(db.reduce((n, x) => n + x.errors, 0), 1);
        assert.equal(db.find(x => x.source === "sync").count, 1);
        assert.ok(!lines.join("").match(/secret|private-id|192\.0\.2|Mozilla|session=/));
        const report = spawnSync(process.execPath, ["node_modules/tsx/dist/cli.mjs", "scripts/telemetry-report.ts"],
            { encoding: "utf8", input: lines.join("\n") + "\n" + JSON.stringify({ metric: "unknown", secret: "do not echo" }) });
        assert.equal(report.status, 0, report.stderr);
        const parsed = JSON.parse(report.stdout);
        assert.equal(parsed.totals.find((x: { group: string }) => x.group.startsWith("requests")).count, 1);
        assert.equal(parsed.totals.filter((x: { group: string }) => x.group.startsWith("database"))
            .reduce((n: number, x: { count: number }) => n + x.count, 0), 3);
        assert.ok(!report.stdout.includes("do not echo"));
        const before = lines.length;
        process.env.TELEMETRY_ENABLED = "false";
        await measureDatabase(async () => 1);
        proxy(new NextRequest("https://example.org/"));
        flushMetrics();
        assert.equal(lines.length, before);
    } finally {
        console.log = original;
        if (previous === undefined) delete process.env.TELEMETRY_ENABLED;
        else process.env.TELEMETRY_ENABLED = previous;
    }
    console.log("Telemetry privacy, opt-out signals, error preservation, aggregation, and kill switch passed.");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
