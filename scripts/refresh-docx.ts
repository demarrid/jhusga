/**
 * Refresh formatting of all published Drive DOCX imports.
 * npm exec tsx scripts/refresh-docx.ts [--apply]
 * Dry-run first. Changed source text and held edits stay in the normal review flow.
 */
import { createHash } from "node:crypto";
process.loadEnvFile(".env");
async function main() {
    const { prisma } = await import("../lib/prisma");
    const { exportDocxVersions } = await import("../lib/drive");
    const { deriveDescription } = await import("../lib/markdown");
    const { findQuote } = await import("../lib/anchor");
    const { reanchorDocument } = await import("../lib/sync");
    const { indexDocumentPassages } = await import("../lib/search");
    const apply = process.argv.includes("--apply");
    try {
        const documents = await prisma.document.findMany({where:{
            reviewState:"published", NOT:{driveFileId:{startsWith:"sharepoint:"}},
            OR:[{mimeType:"application/vnd.openxmlformats-officedocument.wordprocessingml.document"},{title:{endsWith:".docx",mode:"insensitive"}}],
        }});
        for (const document of documents) {
            const exported = await exportDocxVersions(document.driveFileId);
            if (!exported || !exported.content) { console.log("unreadable",document.id); continue; }
            if (document.content === exported.content) continue;
            if (document.content !== exported.legacy) { console.log("source changed; normal sync/review required",document.id); continue; }
            const annotations = await prisma.documentAnnotation.findMany({where:{documentId:document.id,orphanedAt:null}});
            if (annotations.some(annotation => !findQuote(exported.content,annotation.content))) {
                console.log("citation review required",document.id); continue;
            }
            console.log(apply ? "refreshing" : "would refresh",document.id,document.title);
            if (!apply) continue;
            const content = exported.content;
            const contentHash = createHash("sha256").update(content).digest("hex");
            await prisma.$transaction(async tx => {
                for (const version of [{content:document.content,contentHash:document.contentHash},{content,contentHash}]) {
                    await tx.documentRevision.upsert({
                        where:{documentId_contentHash:{documentId:document.id,contentHash:version.contentHash}},
                        create:{documentId:document.id,title:document.title,...version,driveModifiedTime:document.driveModifiedTime,
                            editorName:document.driveLastEditorName ?? "",editorEmail:document.driveLastEditorEmail ?? ""},
                        update:{},
                    });
                }
                const updated = await tx.document.updateMany({
                    where:{id:document.id,contentHash:document.contentHash,reviewState:"published"},
                    data:{content,contentHash,description:deriveDescription(content)},
                });
                if (updated.count !== 1) throw new Error("Document changed during formatting refresh");
            });
            await prisma.documentSummary.updateMany({ where: { documentId: document.id, status: { in: ["fresh", "empty"] } }, data: { status: "stale" } });
            await reanchorDocument(document.id,content);
            await indexDocumentPassages(document.id,content);
        }
    } finally { await prisma.$disconnect(); }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
