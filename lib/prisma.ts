import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { demoModeEnabled } from "@/lib/data-mode";

/**
 * Prisma 7 connects through a driver adapter rather than a URL in the schema.
 *
 * DATABASE_URL points at Supabase's transaction-mode pooler (port 6543), which
 * is what serverless request handlers should use -- each invocation borrows a
 * connection instead of holding one open. Migrations go through DIRECT_URL
 * (port 5432) instead; see prisma.config.ts.
 */
function createPrismaClient() {
    // Demo reads return before touching Prisma; the inert URL only allows the
    // modules to load when local credentials have not been configured.
    const url = process.env.DATABASE_URL ?? (demoModeEnabled()
        ? "postgresql://demo:demo@127.0.0.1:1/demo"
        : undefined);
    if (!url) {
        throw new Error("DATABASE_URL is not set; copy .env.example to .env");
    }

    if (url.startsWith("file:")) {
        throw new Error(
            "DATABASE_URL points at a SQLite file, but the schema is now postgresql. Use the Supabase connection string.",
        );
    }

    return new PrismaClient({ adapter: new PrismaPg(url) });
}

// Next's dev server re-evaluates modules on every edit, which would otherwise
// open a new pool each time.
const globalForPrisma = globalThis as unknown as {
    prisma?: ReturnType<typeof createPrismaClient>;
};

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
    globalForPrisma.prisma = prisma;
}
