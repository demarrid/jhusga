import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

/**
 * The approved redacted copy of a document's source file, which "view source"
 * opens in place of the Drive original. Made by scripts/source-redact.ts; a
 * pending copy is never served. See docs/source-redaction.md.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ documentId: string }> }) {
    const { documentId } = await params;
    const copy = await prisma.documentRedactedSource.findFirst({
        where: { documentId, status: "approved" },
        select: { bytes: true, mimeType: true, fileName: true, sha256: true },
    }).catch(() => null);
    if (!copy) return new Response(null, { status: 404 });
    const name = copy.fileName.replace(/["\\\r\n]/g, "");
    return new Response(new Uint8Array(copy.bytes), { headers: {
        "Content-Type": copy.mimeType,
        "Content-Length": String(copy.bytes.length),
        "Content-Disposition": `inline; filename="${name.replace(/[^\x20-\x7e]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(name)}`,
        "ETag": `"${copy.sha256}"`,
        // Browsers recheck after five minutes (a 304 against the ETag). Vercel's
        // CDN keeps the file for a day, so repeat opens don't run this function
        // or count as origin transfer; withdrawing or replacing a copy reaches
        // readers within a day unless the CDN cache is purged.
        "Cache-Control": "public, max-age=300",
        "Vercel-CDN-Cache-Control": "public, max-age=86400, stale-while-revalidate=604800",
        "X-Content-Type-Options": "nosniff",
        "X-Robots-Tag": "noindex",
        // No CSP sandbox: browsers refuse to run their PDF viewer under one.
        // The bytes are our own image-only PDF, with no scripts or forms.
    } });
}
