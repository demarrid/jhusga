import { invalidateArchiveCache } from "@/lib/archive-cache";
import { demoModeEnabled } from "@/lib/data-mode";
import { consumeRateLimit } from "@/lib/ratelimit";
import { refreshDocument } from "@/server/document-refresh";
import { getVersionedDocument } from "@/server/document-versions";

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
    const verdict = await consumeRateLimit("document_refresh");
    if (!verdict.allowed) return new Response(null, { status: 429 });
    const { documentId } = await params;
    try {
        const changed = await refreshDocument(documentId);
        const view = await getVersionedDocument(documentId, "latest");
        if (!view) return new Response(null, { status: 404 });
        if (changed) invalidateArchiveCache();
        return Response.json({ latestVersionId: view.latest.id });
    } catch (error) {
        console.error("Document source refresh failed", documentId, error);
        return new Response(null, { status: 503 });
    }
}
