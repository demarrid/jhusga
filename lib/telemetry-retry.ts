/** Never return database messages, SQL, addresses, or connection strings. */
export function metricFailure(error: unknown): string {
    const e = error as { code?: unknown; message?: unknown; meta?: { code?: unknown } };
    const code = e?.meta?.code ?? e?.code;
    const codes: Record<string, string> = {
        "42P01": "schema-missing", "42501": "permission-denied", "28P01": "authentication",
        "53300": "connection-limit", "57014": "query-timeout", "P1001": "connection-unreachable",
        "P1002": "connection-timeout", "P2024": "pool-timeout", "P2021": "schema-missing",
        "ECONNRESET": "connection-reset", "ECONNREFUSED": "connection-refused", "ETIMEDOUT": "connection-timeout",
    };
    if (typeof code === "string" && Object.hasOwn(codes, code)) return codes[code];
    const message = typeof e?.message === "string" ? e.message : "";
    if (/timeout|timed out/i.test(message)) return "timeout";
    if (/Cannot find module|module not found|dynamic import/i.test(message)) return "runtime-module";
    if (/certificate|SSL|TLS/i.test(message)) return "tls";
    if (/does not exist/i.test(message)) return "schema-missing";
    return "unknown";
}

/** Instance-local circuit breaker; a failed save is never retried per request. */
export class MetricRetry {
    private failures = 0;
    private next = 0;
    ready(now = Date.now()) { return now >= this.next; }
    failed(now = Date.now()) {
        const delay = Math.min(300_000, 60_000 * 2 ** Math.min(this.failures++, 3));
        this.next = now + delay;
        return delay;
    }
    succeeded() { this.failures = 0; this.next = 0; }
}
