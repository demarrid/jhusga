import { SESSION_NUMBER } from "@/config/sga";
import { getFile } from "@/lib/drive";
import { isSecondaryKind } from "@/lib/kinds";
import { manualArchiveIds } from "@/lib/manual-archive";
import { prisma } from "@/lib/prisma";
import { isSharePointFileId } from "@/lib/sharepoint";
import { emptySyncSummary, ingestFile, ingestPendingLink } from "@/lib/sync";

const pending = new Map<string, Promise<boolean>>();

/** Coalesce simultaneous visits without exporting the same source twice. */
export async function refreshDocument(documentId: string): Promise<boolean> {
    const existing = pending.get(documentId);
    if (existing) return existing;
    const work = refreshSource(documentId);
    pending.set(documentId, work);
    try { return await work; } finally { pending.delete(documentId); }
}

async function refreshSource(documentId: string) {
    const document = await prisma.document.findUnique({
        where: { id: documentId },
        select: { driveFileId: true, source: true, kind: true, discoveredVia: true,
            folderPath: true, sessionNumber: true, driveModifiedTime: true },
    });
    if (!document || document.discoveredVia === "archive"
        || manualArchiveIds.has(document.driveFileId) || isSecondaryKind(document.kind)) return false;
    const summary = emptySyncSummary("document-visit");
    const sessionNumber = document.sessionNumber ?? SESSION_NUMBER;
    if (isSharePointFileId(document.driveFileId)) {
        await ingestPendingLink({ fileId: document.driveFileId, url: document.source,
            sessionNumber, file: null }, {}, summary);
    } else {
        const file = await getFile(document.driveFileId);
        if (!file) return false;
        await ingestFile({ ...file, folderPath: document.folderPath, sessionNumber },
            document.discoveredVia === "walk" ? "walk" : "link", {}, summary);
    }
    const current = await prisma.document.findUnique({
        where: { id: documentId }, select: { driveModifiedTime: true },
    });
    return summary.documentsUpdated > 0 || summary.documentsHeld > 0
        || current?.driveModifiedTime?.getTime() !== document.driveModifiedTime?.getTime();
}
