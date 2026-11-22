try { process.loadEnvFile(".env"); } catch { /* Injected environment also works. */ }
async function main() {
    const days = Number(process.argv[2] ?? 7);
    const environment = process.argv[3] ?? "production";
    if (!Number.isInteger(days) || days < 1 || days > 90 || !["production", "preview", "local"].includes(environment))
        throw new Error("Usage: npm run metrics -- [1-90 days] [production|preview|local]");
    // This client is not instrumented; reporting does not inflate the totals.
    const { metricsClient, closeMetrics } = await import("../lib/telemetry-store");
    try {
        const rows = await metricsClient().$queryRaw<Array<{ day: string; metric: string; route: string; source: string; kind: string; count: bigint; errors: bigint; durationMs: number }>>`
            SELECT TO_CHAR("hour" AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day, metric, route, source, kind,
              SUM(count)::bigint AS count, SUM(errors)::bigint AS errors, SUM("durationMs") AS "durationMs"
            FROM "TelemetryHour"
            WHERE "hour" >= date_trunc('day', NOW() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' - (${days - 1} * INTERVAL '1 day')
              AND environment = ${environment}
            GROUP BY day, metric, route, source, kind ORDER BY day, metric, route, source, kind`;
        console.log("UTC daily totals (today is partial). Daily browsers are estimates, NOT unique people.");
        console.log("Do not sum daily browsers into monthly uniques. Unknown requests are NOT confirmed humans.");
        console.log("Database counts are ORM calls, not billed SQL operations. Metrics writes are excluded.");
        if (!rows.length) console.log("No saved metrics in this window/environment.");
        for (const row of rows) console.log(JSON.stringify(row, (_, v) => typeof v === "bigint" ? v.toString() : v));
    } finally { await closeMetrics(); }
}
main().catch(error => { console.error(error instanceof Error && error.message.startsWith("Usage:") ? error.message : "Could not read metrics. Check DATABASE_URL and apply migrations."); process.exitCode = 1; });

export {};
