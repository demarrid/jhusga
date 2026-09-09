import path from "node:path";
import { defineConfig, env } from "prisma/config";

// Prisma 7 stopped reading .env on its own, and unlike the app this file runs
// outside Next's env loading.
try {
    process.loadEnvFile(path.join(__dirname, ".env"));
} catch {
    // No .env locally is fine; CI and hosts inject real env vars.
}

// Prisma 7 moved the datasource URL out of schema.prisma. This file is only
// read by the CLI (migrate, db push, studio); the running app connects through
// the driver adapter in lib/prisma.ts.
//
// Migrations must not go through Supabase's transaction-mode pooler: DDL and
// advisory locks need a session that persists across statements. DIRECT_URL is
// the session-mode connection (port 5432) for exactly this.
export default defineConfig({
    schema: path.join(__dirname, "schema.prisma"),
    migrations: {
        path: path.join(__dirname, "prisma/migrations"),
    },
    datasource: {
        url: process.env.DIRECT_URL ? env("DIRECT_URL") : env("DATABASE_URL"),
    },
});
