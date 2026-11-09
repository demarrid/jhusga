import { loadPublishedImage } from "@/lib/document-media";

export const runtime = "nodejs";
export async function GET(_request: Request, { params }: { params: Promise<{ imageId: string }> }) {
    const { imageId } = await params;
    const image = await loadPublishedImage(imageId);
    if (!image) return new Response(null, { status: 404 });
    return new Response(new Uint8Array(image.bytes), { headers: {
        "Content-Type": image.mimeType,
        "Content-Length": String(image.bytes.length),
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "no-store",
        "Content-Security-Policy": "default-src 'none'; sandbox",
    } });
}
