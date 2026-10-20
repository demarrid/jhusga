/**
 * Re-extract one already-published PDF after a parser improvement.
 *
 * node --import tsx scripts/refresh-pdf.ts DOCUMENT_ID LOCAL_PDF [--apply]
 *
 * Dry run by default. The old extractor must reproduce the published text
 * exactly: this is a formatting migration, never a way to publish source edits
 * or bypass a held revision. No model calls or Drive revisions are needed.
 */
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { extractText } from "unpdf";
import { extractPdfText, isPdfFile } from "../lib/drive";
import { sanitizeExport, deriveDescription } from "../lib/markdown";
import { findQuote } from "../lib/anchor";
import { prisma } from "../lib/prisma";
import { recordContributors, reanchorDocument } from "../lib/sync";
import { indexDocumentPassages } from "../lib/search";

process.loadEnvFile(".env");

async function main() {
    const [documentId, pdfPath, flag] = process.argv.slice(2);
    if (!documentId || !pdfPath || (flag && flag !== "--apply")) {
        throw new Error("Usage: refresh-pdf.ts DOCUMENT_ID LOCAL_PDF [--apply]");
    }
    const document = await prisma.document.findUniqueOrThrow({ where: { id: documentId } });
    if (!isPdfFile({ name: document.title, mimeType: document.mimeType })
        || document.reviewState !== "published") throw new Error("Requires a published PDF.");
    const bytes = new Uint8Array(readFileSync(pdfPath));
    const legacy = sanitizeExport((await extractText(bytes.slice(), { mergePages: true })).text);
    const content = await extractPdfText(bytes.slice());
    if (document.content !== legacy && document.content !== content) {
        throw new Error("PDF differs from the published source; use the normal sync/review workflow.");
    }
    const annotations = await prisma.documentAnnotation.findMany({ where: { documentId } });
    const quoteUpdates = annotations.flatMap(annotation => {
        if (findQuote(content, annotation.content)) return [];
        const oldAnchor = findQuote(legacy, annotation.content);
        if (!oldAnchor) return [];
        // A quote spanning list items can contain the original PDF's literal
        // bullet glyphs. Only replace line-leading markers in its verified
        // source span, never arbitrary letters "o" in the quoted sentence.
        const excerpt = legacy.slice(oldAnchor.startOffset, oldAnchor.endOffset)
            .replace(/^[ \t]*[•▪◦●○■‣⁃o][ \t]+/gm, "- ");
        const anchor = findQuote(content, excerpt);
        return anchor ? [{ id: annotation.id, content: content.slice(anchor.startOffset, anchor.endOffset) }] : [];
    });
    const lost = annotations.filter(a => !a.orphanedAt && !findQuote(content, a.content)
        && !quoteUpdates.some(update => update.id === a.id));
    console.log(JSON.stringify({
        title: document.title, changed: content !== document.content,
        annotations: annotations.length, reformattedQuotes: quoteUpdates.length,
        wouldOrphan: lost.length, apply: flag === "--apply",
    }));
    if (lost.length) throw new Error("Formatting would orphan existing citations; investigate before applying.");
    if (flag !== "--apply") return;

    const contentHash = createHash("sha256").update(content).digest("hex");
    await prisma.$transaction(async tx => {
        // Keep both versions recoverable and do not overwrite a concurrent sync.
        for (const version of [
            { content: document.content, contentHash: document.contentHash },
            { content, contentHash },
        ]) {
            await tx.documentRevision.upsert({
                where: { documentId_contentHash: { documentId, contentHash: version.contentHash } },
                create: {
                    documentId, title: document.title, ...version,
                    driveModifiedTime: document.driveModifiedTime,
                    editorName: document.driveLastEditorName ?? "",
                    editorEmail: document.driveLastEditorEmail ?? "",
                },
                update: {},
            });
        }
        const updated = await tx.document.updateMany({
            where: { id: documentId, contentHash: document.contentHash, reviewState: "published" },
            data: { content, contentHash, description: deriveDescription(content) },
        });
        if (updated.count !== 1) throw new Error("Document changed during refresh; retry.");
        for (const update of quoteUpdates) {
            await tx.documentAnnotation.update({ where: { id: update.id }, data: { content: update.content } });
        }
    });
    // Rerunnable if a downstream step fails after the content was saved.
    console.log(await reanchorDocument(documentId, content));
    await indexDocumentPassages(documentId, content);
    await recordContributors(documentId, content);
    console.log("PDF text, citation anchors, search passages, and parsed contributors refreshed.");
}

main().catch(error => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
}).finally(() => prisma.$disconnect());
