import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { database, closeDatabase, DATABASE_POOL_MAX, DATABASE_IDLE_MS } from "../lib/database-client";
import { prisma } from "../lib/prisma";
import { metricsClient, persistMetrics } from "../lib/telemetry-store";
import { flushMetrics } from "../lib/telemetry";

async function main() {
    const db = new PGlite();
    // The server refuses connections beyond the cap, like the hosted 53300 limit.
    const server = new PGLiteSocketServer({ db, port: 0, host: "127.0.0.1", maxConnections: DATABASE_POOL_MAX });
    await server.start();
    process.env.DATABASE_URL = "postgresql://postgres:postgres@" + server.getServerConn() + "/postgres";
    process.env.TELEMETRY_ENABLED = "true";
    try {
        await db.exec(await readFile("prisma/migrations/20261122090000_aggregate_telemetry/migration.sql", "utf8"));
        assert.equal(metricsClient(), database().client, "metrics must reuse the raw application client");
        const pool = database().pool;
        let peak = 0;
        pool.on("connect", () => { peak = Math.max(peak, pool.totalCount); });
        const results = await Promise.allSettled(Array.from({ length: 40 }, async (_, i) => {
            await prisma.$queryRawUnsafe("SELECT 1::int AS result");
            await persistMetrics("pool-test-" + i, [{ hour: new Date().toISOString().slice(0, 13) + ":00:00.000Z",
                environment: "local", metric: "request", route: "about", source: "unknown", kind: "request",
                count: 1, errors: 0, durationMs: 0 }]);
        }));
        for (const result of results) if (result.status === "rejected") console.error(result.reason?.code, result.reason?.meta ?? result.reason?.message);
        assert.ok(results.every(r => r.status === "fulfilled"));
        assert.equal(await flushMetrics(), true);
        const counts = await db.query<{ metric: string; count: number }>('SELECT metric, SUM(count)::int AS count FROM "TelemetryHour" GROUP BY metric');
        assert.equal(counts.rows.find(x => x.metric === "database")?.count, 40, "telemetry writes must not instrument themselves");
        assert.equal(counts.rows.find(x => x.metric === "request")?.count, 40);
        assert.ok(peak <= DATABASE_POOL_MAX);
        await new Promise(resolve => setTimeout(resolve, DATABASE_IDLE_MS + 500));
        assert.equal(pool.totalCount, 0, "idle sockets must close");
        console.log("Concurrent mixed workload: 40 app queries + 40 metric batches; peak connections =", peak, "; idle connections = 0.");
    } finally { await closeDatabase(); await server.stop(); await db.close(); }
}
main().catch(e => { console.error(e); process.exitCode = 1; });




