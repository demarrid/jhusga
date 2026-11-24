import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
try { process.loadEnvFile(".env"); } catch { /* Injected environment also works. */ }

async function main() {
    const port = Number(process.env.METRICS_PORT ?? 4318);
    if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("Invalid METRICS_PORT");
    const origin = `http://127.0.0.1:${port}`;
    const { metricsClient, closeMetrics } = await import("../lib/telemetry-store");
    const html = await readFile(new URL("./metrics-live.html", import.meta.url), "utf8");
    const server = createServer(async (request, response) => {
        response.setHeader("Cache-Control", "no-store");
        response.setHeader("X-Content-Type-Options", "nosniff");
        if (request.headers.host !== `127.0.0.1:${port}` ||
            (request.headers.origin && request.headers.origin !== origin) ||
            request.headers["sec-fetch-site"] === "cross-site") {
            response.writeHead(403).end("Local access only"); return;
        }
        if (request.method !== "GET") { response.writeHead(405).end(); return; }
        const url = new URL(request.url ?? "/", origin);
        if (url.pathname === "/") { response.setHeader("Content-Type", "text/html; charset=utf-8"); response.end(html); return; }
        if (url.pathname !== "/data") { response.writeHead(404).end(); return; }
        const start = new Date(url.searchParams.get("start") ?? "");
        const end = new Date(url.searchParams.get("end") ?? "");
        const interval = url.searchParams.get("interval") ?? "hour";
        const environment = url.searchParams.get("environment") ?? "production";
        const minutes = ({ "15m": 15, hour: 60, day: 1440 } as Record<string, number>)[interval];
        // Two hours of slack keeps a 90-day preset valid across one daylight-saving change.
        if (!Number.isFinite(+start) || !Number.isFinite(+end) || +end <= +start || +end - +start > 90 * 86400000 + 2 * 3600000 ||
            !minutes || !["production", "preview", "local"].includes(environment)) {
            response.writeHead(400).end("Choose a valid range of at most 90 days."); return;
        }
        try {
            // Read-only, uninstrumented client: no visitor data or telemetry writes.
            const rows = await metricsClient().$queryRaw`
                WITH counters AS (
                    SELECT * FROM "TelemetryQuarter"
                    UNION ALL SELECT * FROM "TelemetryHour" WHERE ${interval} <> '15m'
                )
                SELECT date_bin(${minutes} * INTERVAL '1 minute', "hour", TIMESTAMPTZ '2000-01-01') AS time,
                    metric, source, kind, SUM(count)::bigint AS count, SUM(errors)::bigint AS errors
                FROM counters WHERE environment = ${environment} AND "hour" >= ${start} AND "hour" < ${end}
                GROUP BY 1,2,3,4 ORDER BY 1,2,3,4`;
            response.setHeader("Content-Type", "application/json");
            response.end(JSON.stringify({ rows, fetchedAt: new Date().toISOString() }, (_, v) => typeof v === "bigint" ? Number(v) : v));
        } catch {
            response.writeHead(503).end("Could not read metrics. Check DATABASE_URL, connectivity, and migrations.");
        }
    });
    server.on("error", error => { console.error(error.message); process.exitCode = 1; });
    server.listen(port, "127.0.0.1", () => console.log(`Activity dashboard: ${origin}\nRefreshes every 60 seconds while visible. Ctrl+C to stop.`));
    const stop = () => { server.close(() => { void closeMetrics().finally(() => process.exit()); }); server.closeIdleConnections(); };
    process.once("SIGINT", stop); process.once("SIGTERM", stop);
}
main().catch(() => { console.error("Could not start metrics dashboard."); process.exitCode = 1; });
