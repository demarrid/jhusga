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
    return versionRewrite(request) ?? NextResponse.next();
}

/**
 * The plain document page is cached; a chosen version or open version history
 * is rendered on request by a sibling route. The address bar keeps its URL.
 */
function versionRewrite(request: NextRequest): NextResponse | null {
    const { pathname, searchParams } = request.nextUrl;
    const match = /^\/documents\/([^/]+)$/.exec(pathname);
    if (!match || (!searchParams.has("version") && !searchParams.has("diff"))) return null;
    const url = request.nextUrl.clone();
    url.pathname = `/documents/${match[1]}/version`;
    return NextResponse.rewrite(url);
}
// Excludes assets, sign-in, and preference changes.
export const config = { matcher: ["/", "/documents/:path*", "/discussion/:path*", "/history/:path*",
    "/about", "/contact", "/community/:path*", "/api/cron/:path*", "/api/sync/:path*",
    "/api/documents/:path*", "/api/search/:path*"] };
