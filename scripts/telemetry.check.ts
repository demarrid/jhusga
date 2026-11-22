import { MetricRetry, metricFailure, metricDiagnostics } from "../lib/telemetry-retry";
import { POST } from "../app/api/metrics/reach/route";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { MERGE_METRICS_SQL } from "../lib/telemetry-store";
import { audience, routeGroup, requestKind } from "../lib/telemetry-policy";
import { measureDatabase } from "../lib/telemetry";

async function main() {
    const wrapped = { name: "PrismaClientKnownRequestError", code: "P2010",
        meta: { driverAdapterError: { cause: { originalCode: "42P01", message: "secret SQL" } } } };
    assert.equal(metricFailure(wrapped), "schema-missing");
    assert.deepEqual(metricDiagnostics(wrapped), { type: "PrismaClientKnownRequestError", codes: ["P2010", "42P01"] });
    assert.deepEqual(metricDiagnostics({ name: "secret-name", code: "secret-credential", message: "secret SQL" }), { type: "other", codes: [] });
    const cycle = { cause: {} }; cycle.cause = cycle;
    assert.deepEqual(metricDiagnostics(cycle).codes, []);
    assert.equal(metricFailure(new Error("unsupported startup parameter: secret")), "unsupported-connection-option");
    const retry = new MetricRetry();
    assert.equal(retry.failed(0), 60_000);
    assert.equal(retry.ready(59_999), false);
    assert.equal(retry.ready(60_000), true);
    assert.equal(retry.failed(60_000), 120_000);
    retry.failed(180_000);
    assert.equal(retry.failed(420_000), 300_000);
    retry.succeeded();
    assert.equal(retry.ready(0), true);
    assert.equal(retry.failed(0), 60_000);
    assert.equal(metricFailure({ code: "P2010", meta: { code: "42P01" }, message: "sensitive SQL" }), "schema-missing");
    assert.equal(metricFailure(new Error("secret credentials")), "unknown");
    assert.equal(metricFailure(new Error("Cannot find module secret/path")), "runtime-module");
    process.env.TELEMETRY_ENABLED = "false";
    assert.equal(audience(new Headers({ dnt: "1", "user-agent": "Googlebot" })), null);
    assert.equal(audience(new Headers({ "sec-gpc": "1" })), null);
    assert.equal(audience(new Headers({ "user-agent": "Googlebot" })), "self-declared-automation");
    assert.equal(audience(new Headers({ "user-agent": "Mozilla" })), "unknown");
    assert.equal(routeGroup("/documents/private-id?secret=search"), "documents");
    assert.equal(requestKind(new Headers({ "next-router-prefetch": "1" })), "prefetch");
    assert.equal(await measureDatabase(async () => 42), 42);
    const failure = new Error("sensitive query");
    await assert.rejects(measureDatabase(async () => { throw failure; }), e => e === failure);
    process.env.TELEMETRY_ENABLED = "true";
    assert.equal((await POST(new Request("https://example.org/api/metrics/reach", { method: "POST",
        headers: { origin: "https://evil.example" } }))).status, 403);
    assert.equal((await POST(new Request("https://example.org/api/metrics/reach", { method: "POST",
        headers: { origin: "https://example.org", "sec-gpc": "1" } }))).status, 204);
    assert.equal((await POST(new Request("https://example.org/api/metrics/reach", { method: "POST",
        headers: { origin: "https://example.org", "user-agent": "Googlebot" } }))).status, 204);
    process.env.TELEMETRY_ENABLED = "false";
    const db = new PGlite();
    try {
        await db.exec(await readFile("prisma/migrations/20261122090000_aggregate_telemetry/migration.sql", "utf8"));
        const rows = [{ hour: "2026-11-22T01:00:00Z", environment: "production", metric: "request", route: "documents",
            source: "unknown", kind: "request", count: 3, errors: 1, durationMs: 12.5 }];
        await db.query(MERGE_METRICS_SQL, ["batch-a", JSON.stringify(rows)]);
        await db.query(MERGE_METRICS_SQL, ["batch-a", JSON.stringify(rows)]);
        let result = await db.query<{count: number; errors: number; durationMs: number}>('SELECT * FROM "TelemetryHour"');
        assert.equal(Number(result.rows[0].count), 3, "retry must not double-count");
        await db.query(MERGE_METRICS_SQL, ["batch-b", JSON.stringify(rows)]);
        result = await db.query('SELECT * FROM "TelemetryHour"');
        assert.equal(Number(result.rows[0].count), 6, "distinct instances must add, not overwrite");
        assert.equal(Number(result.rows[0].errors), 2);
        assert.equal(result.rows[0].durationMs, 25);
        await db.query(MERGE_METRICS_SQL, ["batch-c", JSON.stringify([{...rows[0], environment: "preview"}])]);
        assert.equal((await db.query('SELECT * FROM "TelemetryHour"')).rows.length, 2);
        await assert.rejects(db.query(MERGE_METRICS_SQL, ["failed-batch", "invalid json"]));
        assert.equal((await db.query('SELECT * FROM "TelemetryBatch" WHERE id = $1', ["failed-batch"])).rows.length, 0,
            "receipt and counters must commit atomically");
        await db.exec('DELETE FROM "TelemetryHour" WHERE "hour" < TIMESTAMPTZ \'2027-03-01\' - INTERVAL \'90 days\'');
        assert.equal((await db.query('SELECT * FROM "TelemetryHour"')).rows.length, 0);
    } finally { await db.close(); }
    console.log("Telemetry privacy, SQL persistence, idempotency, isolation, rollback, retention, and error propagation passed.");
}
main().catch(e => { console.error(e); process.exitCode = 1; });
