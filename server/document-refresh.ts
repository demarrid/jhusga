import { SESSION_NUMBER } from "@/config/sga";
import { getFile } from "@/lib/drive";
import { isSecondaryKind } from "@/lib/kinds";
import { manualArchiveIds } from "@/lib/manual-archive";
import { prisma } from "@/lib/prisma";
import { isSharePointFileId } from "@/lib/sharepoint";
import { emptySyncSummary, ingestFile, ingestPendingLink } from "@/lib/sync";
import { visitRefresh } from "@/lib/visit-refresh";

/**
 * Check one source, or skip before touching the database.
 *
 * `allowed` runs only after this instance has claimed the single in-flight
 * slot. A refusal or a database error still counts as a check, so a full
 * database does not get a retry on every subsequent page view.
 */
export async function refreshDocument(
    documentId: string,
    allowed: () => Promise<boolean>,
): Promise<boolean | "skipped" | "limited"> {
    if (visitRefresh.start(documentId, Date.now()) === "skip") return "skipped";
    try {
        if (!await allowed()) return "limited";
        return await refreshSource(documentId);
    } finally {
        visitRefresh.finish(documentId, Date.now());
    }
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
