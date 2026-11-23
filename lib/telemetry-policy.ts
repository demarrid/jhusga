/** Only fixed categories may leave this module. Never raw paths or headers. */

export function routeGroup(path: string): string {
    const first = path.split("/")[1];
    if (path === "/") return "home";
    if (first === "api") {
        const area = path.split("/")[2];
        return ["cron", "sync", "documents", "search"].includes(area) ? `api/${area}` : "api/other";
    }
    return ["documents", "discussion", "history", "about", "contact", "community"].includes(first) ? first : "other";
}
export function audience(headers: Headers): string | null {
    if (headers.get("dnt") === "1" || headers.get("sec-gpc") === "1") return null;

    if (/bot|crawler|spider|slurp|facebookexternalhit|meta-externalagent|headless|curl|wget|python|playwright/i.test(headers.get("user-agent") ?? "")) return "self-declared-automation";
    return "unknown";
}
export function requestKind(headers: Headers): string {
    if (headers.has("next-router-prefetch") || /prefetch/i.test(headers.get("purpose") ?? "")) return "prefetch";
    return headers.get("rsc") === "1" ? "rsc" : "request";
}

/** UTC bucket start; no per-request timestamps are persisted. */
export function metricBucketStart(now = new Date()): string {
    return new Date(Math.floor(now.getTime() / 900000) * 900000).toISOString();
}
