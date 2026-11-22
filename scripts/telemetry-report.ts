import { createInterface } from "node:readline";

// Feed only JSON metric messages, one per line; export the hosting log message field.
// Unknown fields and malformed rows are discarded, never echoed.
async function main() {
    const groups = new Map<string, { count: number; errors: number; durationMs: number }>();
    for await (const line of createInterface({ input: process.stdin })) {
        try {
            const row = JSON.parse(line);
            let key: string;
            if (row.metric === "sga.request.v1") {
                if (!["home", "documents", "discussion", "history", "about", "contact", "community", "other", "api/cron", "api/sync", "api/documents", "api/search", "api/other"].includes(row.route)
                    || !["unknown", "self-declared-automation"].includes(row.source)
                    || !["prefetch", "rsc", "request"].includes(row.kind)) continue;
                key = `requests / ${row.route} / ${row.source} / ${row.kind}`;
            } else if (row.metric === "sga.database.v1") {
                if (!["application", "sync", "local"].includes(row.source) || !["production", "preview", "local"].includes(row.environment)) continue;
                key = `database / ${row.environment} / ${row.source}`;
            } else continue;
            if (!Number.isSafeInteger(row.count) || row.count < 0) continue;
            const totals = groups.get(key) ?? { count: 0, errors: 0, durationMs: 0 };
            totals.count += row.count;
            if (row.metric === "sga.database.v1") {
                if (Number.isSafeInteger(row.errors) && row.errors >= 0) totals.errors += row.errors;
                if (Number.isFinite(row.durationMs) && row.durationMs >= 0) totals.durationMs += row.durationMs;
            }
            groups.set(key, totals);
        } catch { /* Ignore unrelated / malformed logs. */ }
    }
    console.log(JSON.stringify({ note: "Observed counters, not unique visitors or provider-billed operations. Use one environment and time window. Missing or repeated logs bias totals.",
        totals: [...groups].map(([group, totals]) => ({ group, ...totals })) }, null, 2));
}
main().catch(() => { console.error("Could not read metrics input."); process.exitCode = 1; });
