import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import net from "node:net";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { database, closeDatabase, DATABASE_POOL_MAX, DATABASE_IDLE_MS, CONNECTION_LIMIT_RETRY_MS, retryConnectionLimit } from "../lib/database-client";
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
    let refuseNext = 0, refused = 0, stallNext = 0, stalled = 0;
    const proxy = net.createServer(socket => {
        if (stallNext > 0) {
            stallNext--; stalled++;
            socket.on("data", () => { /* Accept TCP but never finish the handshake. */ });
            socket.on("error", () => socket.destroy());
            socket.on("end", () => socket.end());
            return;
        }
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
        await db.exec(await readFile("prisma/migrations/20261122200000_quarter_hour_telemetry/migration.sql", "utf8"));
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
        const counts = await db.query<{ metric: string; count: number }>('SELECT metric, SUM(count)::int AS count FROM "TelemetryQuarter" GROUP BY metric');
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

        await idle();
        pool.options.connectionTimeoutMillis = 100;
        stallNext = 1;
        await prisma.$executeRawUnsafe(`INSERT INTO "TelemetryBatch" ("id", "createdAt") VALUES ('timeout-retry-write', NOW())`);
        assert.equal(stalled, 1);
        assert.equal((await db.query<{n: number}>(`SELECT COUNT(*)::int AS n FROM "TelemetryBatch" WHERE id = 'timeout-retry-write'`)).rows[0].n, 1);
        await idle();
        stallNext = 2;
        const timeout = await prisma.$queryRawUnsafe("SELECT 1").then(() => undefined, (e: unknown) => e);
        assert.equal(metricFailure(timeout), "connection-acquire-timeout");
        assert.equal(stalled, 3, "persistent acquisition timeout gets only one retry");
        pool.options.connectionTimeoutMillis = 5000;
        assert.equal(await flushMetrics(), true);
        const categories = await db.query<{kind: string; count: number}>(`SELECT kind, SUM(count)::int AS count FROM "TelemetryQuarter" WHERE metric = 'database-error' GROUP BY kind`);
        assert.equal(categories.rows.find(r => r.kind === 'connection-acquire-timeout')?.count, 1);

        for (const message of ["query timeout", "Connection terminated unexpectedly", "timeout exceeded when trying to connect: private data"]) {
            let attempts = 0;
            const error = new Error(message);
            await assert.rejects(retryConnectionLimit(async () => { attempts++; throw error; }, [0, 0]), e => e === error);
            assert.equal(attempts, 1, "ambiguous errors must never replay writes");
        }
        let queued = 0;
        assert.equal(await retryConnectionLimit(async () => {
            if (++queued === 1) throw new Error("timeout exceeded when trying to connect");
            return 42;
        }, [0]), 42);
        console.log("Acquisition timeout recovered into exactly one write; persistent and ambiguous failures surfaced; anonymous error category saved.");
    } finally { await closeDatabase(); proxy.close(); await server.stop(); await db.close(); }
}
main().catch(e => { console.error(e); process.exitCode = 1; });
