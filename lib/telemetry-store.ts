import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

export type Metric = { hour: string; environment: string; metric: string; route: string; source: string; kind: string; count: number; errors: number; durationMs: number };
let client: PrismaClient | undefined;
// Intentionally uninstrumented: writing metrics must not generate more metrics.
export function metricsClient() {
    return client ??= new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL, max: 1,
        connectionTimeoutMillis: 3000, statement_timeout: 5000 }) });
}
export const MERGE_METRICS_SQL = `
WITH accepted AS (
 INSERT INTO "TelemetryBatch" ("id", "createdAt") VALUES ($1, NOW())
 ON CONFLICT DO NOTHING RETURNING "id"
), payload AS (
 SELECT * FROM jsonb_to_recordset($2::jsonb) AS x(
 hour timestamptz, environment text, metric text, route text, source text, kind text,
 count integer, errors integer, "durationMs" double precision)
)
INSERT INTO "TelemetryHour" ("hour","environment","metric","route","source","kind","count","errors","durationMs")
 SELECT hour, environment, metric, route, source, kind, count, errors, "durationMs"
 FROM payload WHERE EXISTS (SELECT 1 FROM accepted)
ON CONFLICT ("hour","environment","metric","route","source","kind")
DO UPDATE SET "count" = "TelemetryHour"."count" + EXCLUDED."count",
 "errors" = "TelemetryHour"."errors" + EXCLUDED."errors",
 "durationMs" = "TelemetryHour"."durationMs" + EXCLUDED."durationMs"
`;
export async function persistMetrics(id: string, rows: Metric[]) {
    await metricsClient().$executeRawUnsafe(MERGE_METRICS_SQL, id, JSON.stringify(rows));
}
export async function pruneMetrics() {
    // Called by existing scheduled sync, no new scheduler or per-request cleanup.
    await metricsClient().$executeRaw`DELETE FROM "TelemetryHour" WHERE "hour" < NOW() - INTERVAL '90 days'`;
    await metricsClient().$executeRaw`DELETE FROM "TelemetryBatch" WHERE "createdAt" < NOW() - INTERVAL '2 days'`;
}
export async function closeMetrics() { await client?.$disconnect(); }
