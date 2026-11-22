/** Only bounded technical codes and fixed labels leave this module. */
export function metricDiagnostics(error: unknown) {
    const nodes: Record<string, unknown>[] = [];
    const seen = new Set<unknown>();
    function visit(value: unknown, depth: number) {
        if (!value || typeof value !== "object" || depth > 5 || seen.has(value)) return;
        seen.add(value);
        const node = value as Record<string, unknown>;
        nodes.push(node);
        for (const key of ["cause", "meta", "driverAdapterError", "error"]) visit(node[key], depth + 1);
    }
    visit(error, 0);
    const codes = [...new Set(nodes.flatMap(node =>
        ["code", "originalCode", "sqlState"].flatMap(key => {
            const value = node[key];
            return typeof value === "string" && /^(?:P[0-9]{4}|[0-9A-Z]{5}|ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENOTFOUND)$/.test(value) ? [value] : [];
        })))].slice(0, 6);
    const name = (error as { name?: unknown })?.name;
    const type = ["PrismaClientKnownRequestError", "PrismaClientUnknownRequestError",
        "PrismaClientInitializationError", "PrismaClientValidationError", "TypeError", "Error"].includes(String(name))
        ? String(name) : "other";
    return { type, codes };
}

/** Inspect messages only to select a fixed label; never emit the message. */
export function metricFailure(error: unknown): string {
    const codes: Record<string, string> = {
        "42P01": "schema-missing", "42501": "permission-denied", "28P01": "authentication",
        "53300": "connection-limit", "57014": "query-timeout", "P1000": "authentication",
        "P1001": "connection-unreachable", "P1002": "connection-timeout",
        "P2024": "pool-timeout", "P2021": "schema-missing", "P1011": "tls",
        "ECONNRESET": "connection-reset", "ECONNREFUSED": "connection-refused",
        "ETIMEDOUT": "connection-timeout", "ENOTFOUND": "dns",
    };
    const diagnostic = metricDiagnostics(error);
    for (const code of diagnostic.codes) if (Object.hasOwn(codes, code)) return codes[code];
    const e = error as { message?: unknown };
    const message = typeof e?.message === "string" ? e.message : "";
    if (/unsupported startup parameter/i.test(message)) return "unsupported-connection-option";
    if (/tenant or user not found/i.test(message)) return "connection-identity";
    if (/timeout|timed out/i.test(message)) return "timeout";
    if (/Cannot find module|module not found|dynamic import/i.test(message)) return "runtime-module";
    if (/certificate|SSL|TLS/i.test(message)) return "tls";
    if (/does not exist/i.test(message)) return "schema-missing";
    if (/Invalid URL/i.test(message)) return "invalid-connection-url";
    if (diagnostic.type === "PrismaClientValidationError") return "client-validation";
    if (diagnostic.type === "PrismaClientInitializationError") return "client-initialization";
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
