import { NextResponse, type NextRequest } from "next/server";
import { audience, requestKind, routeGroup } from "@/lib/telemetry-policy";

export function proxy(request: NextRequest) {
    if (process.env.TELEMETRY_ENABLED === "true") {
        const source = audience(request.headers);
        if (source) {
            try {
                console.log(JSON.stringify({ metric: "sga.request.v1", route: routeGroup(request.nextUrl.pathname),
                    source, kind: requestKind(request.headers), count: 1 }));
            } catch { /* Metrics must never prevent access. */ }
        }
    }
    return NextResponse.next();
}
// Excludes assets, sign-in, and preference changes.
export const config = { matcher: ["/", "/documents/:path*", "/discussion/:path*", "/history/:path*",
    "/about", "/contact", "/community/:path*", "/api/cron/:path*", "/api/sync/:path*",
    "/api/documents/:path*", "/api/search/:path*"] };
