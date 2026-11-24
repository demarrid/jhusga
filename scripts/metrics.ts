try { process.loadEnvFile(".env"); } catch { /* Injected environment also works. */ }
async function main() {
    const days = Number(process.argv[2] ?? 7);
    const environment = process.argv[3] ?? "production";
    const interval = process.argv[4] ?? "day";
    const minutes = interval === "15m" ? 15 : interval === "hour" ? 60 : 1440;
    if (!["15m", "hour", "day"].includes(interval) || !Number.isInteger(days) || days < 1 || days > 90 || !["production", "preview", "local"].includes(environment))
        throw new Error("Usage: npm run metrics -- [1-90 days] [production|preview|local] [15m|hour|day]");
    // This client is not instrumented; reporting does not inflate the totals.
    const { metricsClient, closeMetrics } = await import("../lib/telemetry-store");
    try {
        const rows = await metricsClient().$queryRaw<Array<{ bucketStart: Date; metric: string; route: string; source: string; kind: string; count: bigint; errors: bigint; durationMs: number }>>`
            WITH counters AS (
                SELECT * FROM "TelemetryQuarter"
                UNION ALL SELECT * FROM "TelemetryHour" WHERE ${interval} <> '15m'
            )
            SELECT date_bin(${minutes} * INTERVAL '1 minute', "hour", TIMESTAMPTZ '2000-01-01 00:00:00+00') AS "bucketStart", metric, route, source, kind,
              SUM(count)::bigint AS count, SUM(errors)::bigint AS errors, SUM("durationMs") AS "durationMs"
            FROM counters
            WHERE "hour" >= date_trunc('day', NOW() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' - (${days - 1} * INTERVAL '1 day')
              AND environment = ${environment}
            GROUP BY "bucketStart", metric, route, source, kind ORDER BY "bucketStart", metric, route, source, kind`;
        console.error("UTC " + interval + " totals; current bucket is partial. Daily browsers are NOT unique people.");
        if (interval === "15m") console.error("Legacy hourly counters excluded: they cannot be split accurately into 15-minute intervals.");
        console.error("Do not sum daily browsers into monthly uniques. Unknown requests are NOT confirmed humans.");
        console.error("Database counts are ORM calls, not billed SQL operations. Metrics writes are excluded.");
        console.error("database-error counts break down failed calls by fixed category; do not add them to database totals. Older data has no category breakdown.");
        if (!rows.length) console.error("No saved metrics in this window/environment.");
        for (const row of rows) console.log(JSON.stringify(row, (_, v) => typeof v === "bigint" ? v.toString() : v));
    } finally { await closeMetrics(); }
}
main().catch(error => { console.error(error instanceof Error && error.message.startsWith("Usage:") ? error.message : "Could not read metrics. Check DATABASE_URL and apply migrations."); process.exitCode = 1; });

export {};
