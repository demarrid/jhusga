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
 *
 * The client is built on first query rather than on import, and that is the
 * interesting thing about this file.
 *
 * Constructing it as a module side effect made the missing-credentials error
 * fire at import time, which meant importing anything that transitively
 * reached this module required a database -- whether or not the code being run
 * would ever open a connection. lib/names.ts is the case that showed it up:
 * most of it is string handling with no database in sight, but three
 * check suites could not so much as load it, and because `npm run check`
 * chains its suites, the six after them never ran either. A module cannot be
 * tested apart from a database it does not use, and that was a defect here
 * rather than in the tests.
 *
 * So the export below is a stand-in that builds the real client the first time
 * a property is read off it. Every call site is unchanged, a process that
 * never queries never needs DATABASE_URL, and one that does still fails on the
 * first query with the same message it used to fail on at import.
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

let client: ReturnType<typeof createPrismaClient> | undefined;

function connected(): ReturnType<typeof createPrismaClient> {
    // Memoised unconditionally, not only in development: the proxy resolves
    // this on every property read, so building a client here would mean a pool
    // per query.
    client ??= globalForPrisma.prisma ?? createPrismaClient();

    if (process.env.NODE_ENV !== "production") {
        globalForPrisma.prisma = client;
    }

    return client;
}

export const prisma = new Proxy({} as ReturnType<typeof createPrismaClient>, {
    get(_target, property) {
        const value = Reflect.get(connected(), property);

        // The client's methods read private state off it, so they have to stay
        // bound to the client rather than to this proxy.
        return typeof value === "function" ? value.bind(connected()) : value;
    },
});
