import { prisma } from "@/lib/prisma";
import { demoModeEnabled } from "@/lib/data-mode";
import { demoDocument } from "@/lib/demo-data";
import { renderDocument } from "@/lib/render";
import { selectDocumentVersion, versionOptions } from "@/lib/document-versions";
import { loadDocument, type DocumentDetail } from "@/server/documents";

/** Public version IDs are scoped to this document before any text is read. */
export async function getVersionedDocument(documentId: string, requested?: string) {
    const current = await loadDocument(documentId);
    if (!current) return null;
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
    const selection = selectDocumentVersion(options, current.datedAt, requested);
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
