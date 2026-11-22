import { recordMetric } from "@/lib/telemetry";
import { NextResponse, type NextRequest } from "next/server";
import { audience, requestKind, routeGroup } from "@/lib/telemetry-policy";

export function proxy(request: NextRequest) {
    if (process.env.TELEMETRY_ENABLED === "true") {
        const source = audience(request.headers);
        if (source) {
            try {
                recordMetric("request", routeGroup(request.nextUrl.pathname), source, requestKind(request.headers));
            } catch { /* Metrics must never prevent access. */ }
        }
    }
    return NextResponse.next();
}
// Excludes assets, sign-in, and preference changes.
export const config = { matcher: ["/", "/documents/:path*", "/discussion/:path*", "/history/:path*",
    "/about", "/contact", "/community/:path*", "/api/cron/:path*", "/api/sync/:path*",
    "/api/documents/:path*", "/api/search/:path*"] };
