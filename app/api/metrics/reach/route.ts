import { audience } from "@/lib/telemetry-policy";
import { flushMetrics, recordMetric, telemetryEnabled } from "@/lib/telemetry";
export async function POST(request: Request) {
    if (!telemetryEnabled()) return new Response(null, { status: 204 });
    // No client-supplied counters or IDs. This is a public, spoofable counter,
    // never an authentication or billing signal.
    if (request.headers.get("origin") !== new URL(request.url).origin) return new Response(null, { status: 403 });
    if (audience(request.headers) !== "unknown") return new Response(null, { status: 204 });
    if (request.headers.get("content-length") && request.headers.get("content-length") !== "0") return new Response(null, { status: 400 });
    recordMetric("daily-browser", "all", "browser-estimate", "daily");
    return new Response(null, { status: await flushMetrics() ? 204 : 503 });
}
