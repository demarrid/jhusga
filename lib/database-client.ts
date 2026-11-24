import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { attachDatabasePool } from "@vercel/functions";
import { demoModeEnabled } from "./data-mode";
import { metricFailure } from "./telemetry-retry";

// One pool per JS runtime, shared by instrumented application queries and raw
// telemetry writes. Each Fluid instance is its own process, and Prisma
// Postgres counts every open session against the prisma_migration role.
// Two sessions per instance exhausted that role in production (P2037).
// Queries on one instance queue on the single session.
export const DATABASE_POOL_MAX = 1;
// Long enough for a follow-up cache refresh to reuse the open socket. Vercel
// waits this long after the last query before it is allowed to freeze.
export const DATABASE_IDLE_MS = 5_000;
// pg uses this both for a new handshake and for waiting on a busy socket.
// Five seconds was shorter than Prisma Postgres handshakes and document reads,
// which produced the acquisition timeouts in production logs.
export const DATABASE_CONNECT_MS = 15_000;
export const CONNECTION_LIMIT_RETRY_MS = [100, 300, 900];
type Database = { pool: Pool; client: PrismaClient };
const state = globalThis as unknown as { sgaDatabase?: Database };

export function database() {
    if (state.sgaDatabase) return state.sgaDatabase;
    const connectionString = process.env.DATABASE_URL ?? (demoModeEnabled()
        ? "postgresql://demo:demo@127.0.0.1:1/demo" : undefined);
    if (!connectionString) throw new Error("DATABASE_URL is not set; copy .env.example to .env");
    if (connectionString.startsWith("file:")) throw new Error("DATABASE_URL must be a Postgres connection string.");
    warnIfDirectPrismaHost(connectionString);
    const pool = new Pool({ connectionString, max: DATABASE_POOL_MAX,
        idleTimeoutMillis: DATABASE_IDLE_MS, connectionTimeoutMillis: DATABASE_CONNECT_MS });
    // Ensure Vercel does not freeze the runtime before idle sockets can close.
    attachDatabasePool(pool);
    pool.on("error", () => console.warn("Idle database connection failed; pool will replace it."));
    const client = new PrismaClient({ adapter: new PrismaPg(pool, { disposeExternalPool: true }) });
    state.sgaDatabase = { pool, client };
    return state.sgaDatabase;
}

/**
 * Retry startup refusals and the exact pg-pool acquisition timeout errors.
 * Both happen before any statement runs. Acquisition timeouts get at most one
 * retry; ambiguous failures do not, because a statement may already have committed.
 */
export async function retryConnectionLimit<T>(run: () => Promise<T>, delays = CONNECTION_LIMIT_RETRY_MS): Promise<T> {
    for (let attempt = 0; ; attempt++) {
        try { return await run(); } catch (error) {
            const category = metricFailure(error);
            const retryable = category === "connection-limit" ||
                ((category === "connection-acquire-timeout" || category === "upstream-unavailable") && attempt < 1);
            if (attempt >= delays.length || !retryable) throw error;
            await new Promise(resolve => setTimeout(resolve, delays[attempt] * (0.5 + Math.random())));
        }
    }
}

let warnedDirectHost = false;

/** The direct host takes one server session per client. Serverless needs the pooler. */
function warnIfDirectPrismaHost(connectionString: string) {
    if (warnedDirectHost) return;
    let host = "";
    try { host = new URL(connectionString).hostname; } catch { return; }
    if (host !== "db.prisma.io") return;
    warnedDirectHost = true;
    console.warn(
        "DATABASE_URL uses the direct Prisma Postgres host db.prisma.io. Serverless handlers need the pooled host, or each instance holds a prisma_migration session until the role limit is exhausted.",
    );
}

/** CLI/test shutdown only. Never disconnect at the end of a web request. */
export async function closeDatabase() {
    const current = state.sgaDatabase;
    if (!current) return;
    await current.client.$disconnect();
    if (state.sgaDatabase === current) delete state.sgaDatabase;
}
