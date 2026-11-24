import { invalidateArchiveCache } from "@/lib/archive-cache";
import { demoModeEnabled } from "@/lib/data-mode";
import { consumeRateLimit } from "@/lib/ratelimit";
import { refreshDocument } from "@/server/document-refresh";
import { getLatestPublishedVersionId } from "@/server/document-versions";

export const maxDuration = 60;

export async function POST(request: Request, { params }: {
    params: Promise<{ documentId: string }>;
}) {
    const origin = request.headers.get("origin");
    const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
    try {
        if (!origin || !host || new URL(origin).host !== host) {
            return new Response(null, { status: 403 });
        }
    } catch { return new Response(null, { status: 403 }); }
    if (demoModeEnabled()) return Response.json({ latestVersionId: null });
    const { documentId } = await params;
    try {
        const changed = await refreshDocument(documentId, async () => {
            const verdict = await consumeRateLimit("document_refresh", undefined, { onUnavailable: "deny" });
            return verdict.allowed;
        });
        if (changed === "skipped") return Response.json({ latestVersionId: null });
        if (changed === "limited") return new Response(null, { status: 429 });
        if (changed) invalidateArchiveCache();
        const latestVersionId = await getLatestPublishedVersionId(documentId);
        if (latestVersionId === null) return new Response(null, { status: 404 });
        return Response.json({ latestVersionId });
    } catch (error) {
        console.error("Document source refresh failed", documentId, error);
        return new Response(null, { status: 503 });
    }
}
