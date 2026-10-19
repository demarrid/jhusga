/**
 * Read-only, full-row comparison after a migration. Keep writers stopped while
 * running: independent database snapshots cannot rule out concurrent writes.
 * Supply SOURCE_DATABASE_URL and TARGET_DATABASE_URL through a private env file.
 * Only table names, counts and equality results are printed, never row contents.
 */
import { Client } from "pg";
import { createHash } from "node:crypto";

const quote = (name) => `"${name.replaceAll('"', '""')}"`;

async function fingerprint(connectionString) {
    const client = new Client({ connectionString });
    try {
        await client.connect();
        await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
        await client.query("SET LOCAL timezone = 'UTC'");
        const { rows: tables } = await client.query(
            "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename",
        );
        const result = {};
        for (const { tablename } of tables) {
            // Hash in Postgres so full document content never crosses the wire.
            // jsonb normalizes column ordering; sorting retains duplicate rows.
            const { rows } = await client.query(
                `SELECT md5(to_jsonb(t)::text) AS digest FROM public.${quote(tablename)} t`,
            );
            const hash = createHash("sha256");
            for (const digest of rows.map((row) => row.digest).sort()) hash.update(digest);
            result[tablename] = { count: rows.length, digest: hash.digest("hex") };
        }
        await client.query("COMMIT");
        return result;
    } finally {
        await client.end();
    }
}

async function main() {
    const sourceUrl = process.env.SOURCE_DATABASE_URL;
    const targetUrl = process.env.TARGET_DATABASE_URL;
    if (!sourceUrl || !targetUrl) throw new Error("Both database URLs are required");
    if (sourceUrl === targetUrl) throw new Error("Source and target must differ");
    const [source, target] = await Promise.all([
        fingerprint(sourceUrl), fingerprint(targetUrl),
    ]);
    let failures = 0;
    for (const table of [...new Set([...Object.keys(source), ...Object.keys(target)])].sort()) {
        const matches = Boolean(source[table] && target[table]
            && source[table].count === target[table].count
            && source[table].digest === target[table].digest);
        if (!matches) failures++;
        console.log(JSON.stringify({ table, sourceRows: source[table]?.count,
            targetRows: target[table]?.count, matches }));
    }
    if (failures) throw new Error(`${failures} tables differ; do not cut over`);
    console.log("All public table row counts and content fingerprints match.");
}

main().catch((error) => {
    // Database errors may include connection details; do not dump the object.
    console.error(error instanceof Error ? error.message : "Verification failed");
    process.exitCode = 1;
});
