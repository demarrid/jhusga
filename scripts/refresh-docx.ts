import { recordDocumentVersion } from "../lib/document-version-history";
/**
 * Refresh formatting of all published Drive DOCX imports.
 * npm exec tsx scripts/refresh-docx.ts [driveFileId...] [--apply]
 * Archive imports (plain-text Word reads with a Sources footer) are refreshed
 * too when the fresh conversion has exactly the same words.
 * Dry-run first. Changed source text and held edits stay in the normal review flow.
 */
import { createHash } from "node:crypto";
process.loadEnvFile(".env");
async function main() {
    const { prisma } = await import("../lib/prisma");
    const { exportDocxVersions } = await import("../lib/drive");
    const { deriveDescription } = await import("../lib/markdown");
    const { findQuote } = await import("../lib/anchor");
    const { indexDocumentPassages } = await import("../lib/search");
    const { relocateQuote, sameWords, splitSources } = await import("../lib/docx-refresh");
    const apply = process.argv.includes("--apply");
    // Optional Drive file IDs limit the run to those documents.
    const only = process.argv.slice(2).filter(arg => !arg.startsWith("--"));
    try {
        const documents = await prisma.document.findMany({where:{
            reviewState:"published", NOT:{driveFileId:{startsWith:"sharepoint:"}},
            ...(only.length ? {driveFileId:{in:only}} : {}),
            OR:[{mimeType:"application/vnd.openxmlformats-officedocument.wordprocessingml.document"},{title:{endsWith:".docx",mode:"insensitive"}}],
        }});
        for (const document of documents) {
            const exported = await exportDocxVersions(document.driveFileId);
            if (!exported || !exported.content) { console.log("unreadable",document.id); continue; }
            // Archive imports read Word as plain paragraphs and add a Sources
            // footer; the same words with formatting restored are a safe refresh.
            const stored = splitSources(document.content);
            const content = document.discoveredVia === "archive" && stored.sources
                ? exported.content + "\n\n" + stored.sources : exported.content;
            if (document.content === content) continue;
            if (document.content !== exported.legacy && !(document.discoveredVia === "archive" && sameWords(stored.body, exported.content))) {
                console.log("source changed; normal sync/review required",document.id); continue;
            }
            const annotations = await prisma.documentAnnotation.findMany({where:{documentId:document.id,orphanedAt:null}});
            // Every citation is placed here, before anything is written. A quote
            // the new formatting splits (a link inside it, a list marker between
            // its lines) moves to the same words; one the document repeats keeps
            // the copy its offset pointed at instead of being orphaned.
            const anchors = new Map<string, { content: string; startOffset: number; endOffset: number }>();
            let moved = 0;
            for (const annotation of annotations) {
                const found = findQuote(content, annotation.content);
                if (found) { anchors.set(annotation.id, { content: annotation.content, ...found }); continue; }
                const relocated = relocateQuote(content, annotation.content,
                    annotation.startOffset === null ? undefined : { content: document.content, startOffset: annotation.startOffset });
                if (!relocated) continue;
                anchors.set(annotation.id, { content: relocated.quote, startOffset: relocated.startOffset,
                    endOffset: relocated.startOffset + relocated.quote.length });
                moved++;
            }
            if (anchors.size !== annotations.length) {
                console.log("citation review required",document.id); continue;
            }
            console.log(apply ? "refreshing" : "would refresh",document.id,document.title,moved ? `(${moved} citations moved)` : "");
            if (!apply) continue;
            const contentHash = createHash("sha256").update(content).digest("hex");
            await prisma.$transaction(async tx => {
                for (const version of [{content:document.content,contentHash:document.contentHash},{content,contentHash}]) {
                    const revision = await tx.documentRevision.upsert({
                        where:{documentId_contentHash:{documentId:document.id,contentHash:version.contentHash}},
                        create:{documentId:document.id,title:document.title,...version,driveModifiedTime:document.driveModifiedTime,
                            editorName:document.driveLastEditorName ?? "",editorEmail:document.driveLastEditorEmail ?? ""},
                        update:{},
                    });
                    await recordDocumentVersion(tx, revision.id, version.contentHash === document.contentHash ? document.driveModifiedTime : null, "published");
                }
                const updated = await tx.document.updateMany({
                    where:{id:document.id,contentHash:document.contentHash,reviewState:"published"},
                    data:{content,contentHash,description:deriveDescription(content)},
                });
                if (updated.count !== 1) throw new Error("Document changed during formatting refresh");
                for (const [id, anchor] of anchors) await tx.documentAnnotation.update({ where: { id }, data: { ...anchor, orphanedAt: null } });
            });
            await prisma.documentSummary.updateMany({ where: { documentId: document.id, status: { in: ["fresh", "empty"] } }, data: { status: "stale" } });
            await indexDocumentPassages(document.id,content);
        }
    } finally { await prisma.$disconnect(); }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
