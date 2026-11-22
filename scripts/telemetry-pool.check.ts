import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import net from "node:net";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { database, closeDatabase, DATABASE_POOL_MAX, DATABASE_IDLE_MS, CONNECTION_LIMIT_RETRY_MS } from "../lib/database-client";
import { prisma } from "../lib/prisma";
import { metricsClient, persistMetrics } from "../lib/telemetry-store";
import { metricFailure } from "../lib/telemetry-retry";
import { flushMetrics } from "../lib/telemetry";

/** The startup-time refusal a full server sends: FATAL 53300. */
function tooManyClients() {
    const fields = Buffer.from("SFATAL\0VFATAL\0C53300\0Msorry, too many clients already\0\0");
    const header = Buffer.alloc(5);
    header.write("E");
    header.writeInt32BE(fields.length + 4, 1);
    return Buffer.concat([header, fields]);
}

async function main() {
    const db = new PGlite();
    // The server refuses connections beyond the cap, like the hosted 53300 limit.
    const server = new PGLiteSocketServer({ db, port: 0, host: "127.0.0.1", maxConnections: DATABASE_POOL_MAX });
    await server.start();
    const [host, port] = server.getServerConn().split(":");
    let refuseNext = 0, refused = 0;
    const proxy = net.createServer(socket => {
        if (refuseNext > 0) {
            refuseNext--; refused++;
            socket.once("data", () => socket.end(tooManyClients()));
            return;
        }
        const upstream = net.connect(Number(port), host);
        socket.pipe(upstream).pipe(socket);
        socket.on("error", () => upstream.destroy());
        upstream.on("error", () => socket.destroy());
    });
    await new Promise<void>(resolve => proxy.listen(0, "127.0.0.1", resolve));
    process.env.DATABASE_URL = `postgresql://postgres:postgres@127.0.0.1:${(proxy.address() as net.AddressInfo).port}/postgres`;
    process.env.TELEMETRY_ENABLED = "true";
    const idle = () => new Promise(resolve => setTimeout(resolve, DATABASE_IDLE_MS + 500));
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
        await idle();
        assert.equal(pool.totalCount, 0, "idle sockets must close");
        console.log("Concurrent mixed workload: 40 app queries + 40 metric batches; peak connections =", peak, "; idle connections = 0.");

        refuseNext = 2;
        await prisma.$executeRawUnsafe(`INSERT INTO "TelemetryBatch" ("id", "createdAt") VALUES ('retry-write', NOW())`);
        assert.equal(refused, 2);
        const written = await db.query<{ n: number }>(`SELECT COUNT(*)::int AS n FROM "TelemetryBatch" WHERE "id" = 'retry-write'`);
        assert.equal(written.rows[0].n, 1, "a write retried after refusals must run exactly once");
        await idle();

        refused = 0;
        refuseNext = CONNECTION_LIMIT_RETRY_MS.length + 1;
        const failure = await prisma.$queryRawUnsafe("SELECT 1").then(() => undefined, (error: unknown) => error);
        assert.equal(metricFailure(failure), "connection-limit", "a refusal that outlasts the retries must still surface");
        assert.equal(refused, CONNECTION_LIMIT_RETRY_MS.length + 1);
        refuseNext = 0;
        assert.equal(await flushMetrics(), true);
        console.log("Connection-limit refusals: 2 refusals retried into one write; persistent refusal surfaced after",
            CONNECTION_LIMIT_RETRY_MS.length, "retries.");
    } finally { await closeDatabase(); proxy.close(); await server.stop(); await db.close(); }
}
main().catch(e => { console.error(e); process.exitCode = 1; });
