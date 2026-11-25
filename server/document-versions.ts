import { unstable_cache } from "next/cache";
import { ARCHIVE_CACHE_TAG, ARCHIVE_CACHE_SECONDS } from "@/lib/archive-cache";
import { isSecondaryKind } from "@/lib/kinds";
import { prisma } from "@/lib/prisma";
import { demoModeEnabled } from "@/lib/data-mode";
import { demoDocument } from "@/lib/demo-data";
import { renderDocument } from "@/lib/render";
import { selectDocumentVersion, versionCutoffDate, versionOptions } from "@/lib/document-versions";
import { loadDocument, hydrateDocumentDetail, type DocumentDetail } from "@/server/documents";

const cachedVersionedDocument = unstable_cache(loadVersionedDocument,
    ["versioned-document-v2"], { tags: [ARCHIVE_CACHE_TAG], revalidate: ARCHIVE_CACHE_SECONDS });

/** Cache the whole selected view, including version options and historical reads. */
export async function getVersionedDocument(documentId: string, requested?: string) {
    if (demoModeEnabled()) return loadVersionedDocument(documentId, requested);
    const view = await cachedVersionedDocument(documentId, requested ?? "");
    return view ? { ...view, document: hydrateDocumentDetail(view.document) } : null;
}

/** Public version IDs are scoped to this document before any text is read. */
export async function loadVersionedDocument(documentId: string, requested?: string) {
    const current = await loadDocument(documentId);
    if (!current) return null;
    // Newspaper snapshots are retained for internal comparisons, not public reading.
    // Ignore historical URLs and keep the current summary available.
    if (isSecondaryKind(current.kind) || current.discoveredVia === "archive") {
        const options = versionOptions([{ id: "latest", modifiedAt: null,
            observedAt: (current.lastSyncedAt ?? current.driveCreatedTime ?? new Date()).toISOString() }]);
        const selection = selectDocumentVersion(options, null, "latest")!;
        return { document: current, options, ...selection, historical: false };
    }
    const demo = demoModeEnabled();
    const rows = demo ? demoVersions(current) : await prisma.documentVersion.findMany({
        where: { status: "published", revision: { documentId } },
        select: { id: true, sourceModifiedTime: true, observedAt: true },
    });
    rows.sort((a, b) => (a.sourceModifiedTime ?? a.observedAt).getTime() - (b.sourceModifiedTime ?? b.observedAt).getTime()
        || a.observedAt.getTime() - b.observedAt.getTime() || a.id.localeCompare(b.id));
    // Newly imported sources without recorded history still have a readable current copy.
    const options = versionOptions(rows.length ? rows.map(row => ({
        id: row.id, modifiedAt: row.sourceModifiedTime?.toISOString() ?? null, observedAt: row.observedAt.toISOString(),
    })) : [{ id: "latest", modifiedAt: current.heldNotice ? null : current.driveModifiedTime?.toISOString() ?? null,
        observedAt: (current.lastSyncedAt ?? current.driveCreatedTime ?? new Date()).toISOString() }]);
    // Archive revisions are transcription corrections, not historical source edits.
    // A historical document date must not select the earliest, uncorrected OCR.
    const selection = selectDocumentVersion(options, current.discoveredVia === "archive" ? null : versionCutoffDate(current), requested);
    if (!selection) return null;
    const { selected } = selection;
    const document = selected.id === "latest" ? current : demo ? demoVersion(current, selected.id)
        : await loadDocument(documentId, selected.id);
    if (!document) return null;
    return { document, options, ...selection, historical: document.content !== current.content };
}

function demoVersions(document: DocumentDetail) {
    const latest = document.driveModifiedTime ?? new Date("2026-09-09T15:15:00Z");
    return [
        { id: "demo-earlier", sourceModifiedTime: new Date(latest.getTime() - 86400000), observedAt: new Date(latest.getTime() - 86400000) },
        { id: "demo-latest", sourceModifiedTime: latest, observedAt: latest },
    ];
}

function demoVersion(document: DocumentDetail, id: string): DocumentDetail {
    if (id === "demo-latest") return demoDocument(document.id)!;
    const content = document.content.slice(0, document.content.lastIndexOf("\n\n"));
    return { ...document, content, blocks: renderDocument(content, []), restatement: null,
        contributors: [], agendaMatches: [], references: [], unresolvedLinks: [] };
}

/** Read only the published snapshot text needed for a comparison. */
export async function getDocumentVersionContent(document: DocumentDetail, versionId: string) {
    if (isSecondaryKind(document.kind) || document.discoveredVia === "archive") return null;
    if (demoModeEnabled()) return demoVersion(document, versionId).content;
    return cachedVersionContent(document.id, versionId);
}

const cachedVersionContent = unstable_cache(async (documentId: string, versionId: string) => {
    const version = await prisma.documentVersion.findFirst({
        where: { id: versionId, status: "published", revision: { documentId } },
        select: { revision: { select: { content: true } } },
    });
    return version?.revision.content ?? null;
}, ["version-content-v1"], { tags: [ARCHIVE_CACHE_TAG], revalidate: ARCHIVE_CACHE_SECONDS });


/** Always fresh after source refresh; never render a whole document to read an ID. */
export async function getLatestPublishedVersionId(documentId: string): Promise<string | null> {
    const document = await prisma.document.findUnique({
        where: { id: documentId }, select: { kind: true, discoveredVia: true },
    });
    if (!document) return null;
    if (document.discoveredVia === "archive" || isSecondaryKind(document.kind)) return "latest";
    const rows = await prisma.documentVersion.findMany({
        where: { status: "published", revision: { documentId } },
        select: { id: true, sourceModifiedTime: true, observedAt: true },
    });
    rows.sort((a, b) => (a.sourceModifiedTime ?? a.observedAt).getTime() - (b.sourceModifiedTime ?? b.observedAt).getTime()
        || a.observedAt.getTime() - b.observedAt.getTime() || a.id.localeCompare(b.id));
    return rows.at(-1)?.id ?? "latest";
}
