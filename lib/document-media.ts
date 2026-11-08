import { createHash } from "node:crypto";
import sharp from "sharp";
import type { Prisma } from "@prisma/client";
import { sanitizeExportWithOffsets } from "@/lib/markdown";
import { prisma } from "@/lib/prisma";
import type { DocumentImage } from "@/lib/document-images";

export type CapturedImage = Omit<DocumentImage, "src"> & { bytes: Uint8Array; mimeType: string };
export type CapturedDocument = { content: string; images: CapturedImage[] };
export const mediaTextHash = (text: string) => createHash("sha256").update(text).digest("hex");

/** Read embedded raster images only: no source URL fetches or executable SVG. */
export async function captureDocumentMedia(markdown: string): Promise<CapturedDocument> {
    const definitions = new Map(Array.from(markdown.matchAll(/^\s*\[([^\]\n]+)\]:\s*<(data:image\/[^>]+)>[^\n]*$/gm), match => [match[1].toLowerCase(), match[2]]));
    const markers = Array.from(markdown.matchAll(/!\[([^\]\n]*)\](?:\[([^\]\n]*)\]|\(([^)\n]*)\))/g));
    const positions = markers.map(match => {
        const start = markdown.lastIndexOf("\n", match.index - 1) + 1;
        const end = markdown.indexOf("\n", match.index);
        const line = markdown.slice(start, end < 0 ? markdown.length : end);
        const inline = /^\s*(?:[-+*]|\d+[.)])\s+/.test(line) || /[^*\s]/.test(line.replace(/!\[[^\]\n]*\](?:\[[^\]\n]*\]|\([^)\n]*\))/g, ""));
        return { offset: inline ? match.index : start, inline };
    });
    const cleaned = sanitizeExportWithOffsets(markdown, positions.map(position => position.offset));
    const images: CapturedImage[] = [];
    let totalBytes = 0;
    for (const [index, marker] of markers.entries()) {
        const uri = marker[3] ?? definitions.get((marker[2] || marker[1]).toLowerCase());
        const data = /^data:image\/(png|jpeg|gif|webp);base64,([A-Za-z0-9+/]+={0,2})$/i.exec(uri ?? "");
        if (!data) continue;
        const bytes = Buffer.from(data[2], "base64");
        totalBytes += bytes.length;
        if (bytes.length > 10_000_000 || totalBytes > 30_000_000 || images.length >= 100) throw new Error("Document image limit exceeded");
        const metadata = await sharp(bytes, { limitInputPixels: 40_000_000 }).metadata();
        if (!metadata.width || !metadata.height || metadata.format !== data[1].toLowerCase()) throw new Error("Invalid embedded document image");
        images.push({ bytes, mimeType: `image/${metadata.format}`, width: metadata.width, height: metadata.height,
            alt: marker[1] || `Document image ${index + 1}`, offset: cleaned.offsets[index], inline: positions[index].inline });
    }
    return { content: cleaned.content, images };
}

/** Capture once; retries cannot rewrite the media of a saved source occurrence. */
export async function saveDocumentMedia(tx: Prisma.TransactionClient, versionId: string, capture: CapturedDocument) {
    await tx.documentMedia.upsert({ where: { versionId }, update: {}, create: {
        versionId, contentHash: mediaTextHash(capture.content),
        images: { create: capture.images.map((image, ordinal) => ({ ...image, bytes: new Uint8Array(image.bytes), ordinal })) },
    } });
}

/** Return metadata only, and only for the exact published version and stored text. */
export async function loadDocumentImages(documentId: string, content: string, versionId?: string, modifiedAt?: Date | null): Promise<DocumentImage[]> {
    const media = await prisma.documentMedia.findFirst({
        where: { contentHash: mediaTextHash(content), version: { status: "published", revision: { documentId },
            ...(versionId ? { id: versionId } : { sourceModifiedTime: modifiedAt ?? null }) } },
        orderBy: { createdAt: "desc" },
        select: { images: { orderBy: { ordinal: "asc" }, select: { id: true, offset: true, inline: true, alt: true, width: true, height: true } } },
    });
    return (media?.images ?? []).map(({ id, ...image }) => ({ ...image, src: `/api/document-images/${id}` }));
}

export async function loadPublishedImage(id: string) {
    return prisma.documentImage.findFirst({ where: { id, media: { version: { status: "published" } } },
        select: { bytes: true, mimeType: true } });
}
