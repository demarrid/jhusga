import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { attachDatabasePool } from "@vercel/functions";
import { demoModeEnabled } from "./data-mode";

// One pool per JS runtime, shared by instrumented application queries and raw
// telemetry writes. Vercel instances still each need their own bounded pool.
export const DATABASE_POOL_MAX = 2;
export const DATABASE_IDLE_MS = 1000;
type Database = { pool: Pool; client: PrismaClient };
const state = globalThis as unknown as { sgaDatabase?: Database };

export function database() {
    if (state.sgaDatabase) return state.sgaDatabase;
    const connectionString = process.env.DATABASE_URL ?? (demoModeEnabled()
        ? "postgresql://demo:demo@127.0.0.1:1/demo" : undefined);
    if (!connectionString) throw new Error("DATABASE_URL is not set; copy .env.example to .env");
    if (connectionString.startsWith("file:")) throw new Error("DATABASE_URL must be a Postgres connection string.");
    const pool = new Pool({ connectionString, max: DATABASE_POOL_MAX,
        idleTimeoutMillis: DATABASE_IDLE_MS, connectionTimeoutMillis: 5000 });
    // Ensure Vercel does not freeze the runtime before idle sockets can close.
    attachDatabasePool(pool);
    pool.on("error", () => console.warn("Idle database connection failed; pool will replace it."));
    const client = new PrismaClient({ adapter: new PrismaPg(pool, { disposeExternalPool: true }) });
    state.sgaDatabase = { pool, client };
    return state.sgaDatabase;
}

/** CLI/test shutdown only. Never disconnect at the end of a web request. */
export async function closeDatabase() {
    const current = state.sgaDatabase;
    if (!current) return;
    await current.client.$disconnect();
    if (state.sgaDatabase === current) delete state.sgaDatabase;
}
