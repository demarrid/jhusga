/**
 * Repair stored text from PDFs printed with a broken ligature map ("mee/ng",
 * "aXend", "oﬃce"), and lay out the email headers of a printed email on their
 * own lines. New syncs already get the glyph repair in extractPdfText; this
 * fixes rows stored before it.
 *
 *   npx tsx scripts/repair-pdf-glyphs.ts <driveFileId>...           # preview
 *   npx tsx scripts/repair-pdf-glyphs.ts <driveFileId>... --apply   # write
 *
 * Writes a new published revision, marks the summary stale, repairs each
 * citation's quote the same way, and re-anchors and re-indexes the document.
 */
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { repairPdfGlyphs } from "../lib/pdf-text";

process.loadEnvFile(".env");

const HEADER = /(?:Subject|Date|From|To|CC|Cc|Sent):/;

/** A printed email flattened to one line: one header field per line, and the greeting, sign-off and footer apart. */
export function layoutEmailPrintout(text: string): string {
    if ((text.match(new RegExp(String.raw`\s${HEADER.source}\s`, "g"))?.length ?? 0) < 3) return text;
    return text
        // The print stamp ("Monday, May 6, 2019 at 3:36:53 PM Eastern Daylight Time") heads the page.
        .replace(/^(\w+day, \w+ \d{1,2}, \d{4} at [\d:]+ [AP]M [A-Za-z ]+?Time)\s+(?=Subject:)/, "$1\n\n")
        .replace(new RegExp(String.raw`[ \t]+(?=${HEADER.source}\s)`, "g"), "\n")
        // A header block after body text starts the quoted message.
        .replace(/^([^\n]*)\n(?=From:)/gm, (match, line: string) => /^(?:Subject|Date|To|CC|Cc|Sent):/.test(line) ? match : `${line}\n\n`)
        .replace(new RegExp(String.raw`^(${HEADER.source})[ \t]+`, "gm"), "$1 ")
        .replace(/[ \t]+((?:Hi|Hello|Dear) [A-Z][a-z]+,)[ \t]*/g, "\n\n$1\n\n")
        .replace(/[ \t]*\b(Best wishes|Best regards|Thank you|Thanks|Sincerely|Regards), ([A-Z][a-z]+)\b[ \t]*/g, "\n\n$1,\n$2\n")
        .replace(/\s+(?=Page \d+ of \d+\b)/g, "\n\n")
        .replace(/\n{3,}/g, "\n\n")
        .replace(/[ \t]+\n/g, "\n");
}

async function main() {
    const apply = process.argv.includes("--apply");
    const ids = process.argv.slice(2).filter(arg => !arg.startsWith("--"));
    if (!ids.length) throw new Error("Pass one or more driveFileIds.");
    const { prisma } = await import("../lib/prisma");
    const { recordDocumentVersion } = await import("../lib/document-version-history");
    const { indexDocumentPassages } = await import("../lib/search");
    const { reanchorDocument } = await import("../lib/sync");
    try {
        await mkdir(".archive-local/glyph-repair", { recursive: true });
        for (const driveFileId of ids) {
            const document = await prisma.document.findUniqueOrThrow({ where: { driveFileId } });
            const content = layoutEmailPrintout(repairPdfGlyphs(document.content));
            if (content === document.content) { console.log(`${driveFileId}: unchanged`); continue; }
            const hash = createHash("sha256").update(content).digest("hex");
            const stamp = new Date().toISOString().replace(/[:.]/g, "-");
            await writeFile(`.archive-local/glyph-repair/${driveFileId}-${stamp}.before.md`, document.content);
            await writeFile(`.archive-local/glyph-repair/${driveFileId}-${stamp}.after.md`, content);
            console.log(`${driveFileId}: ${apply ? "writing" : "preview written to .archive-local/glyph-repair/"}`);
            if (!apply) continue;
            await prisma.$transaction(async tx => {
                const updated = await tx.document.updateMany({ where: { id: document.id, contentHash: document.contentHash }, data: { content, contentHash: hash } });
                if (updated.count !== 1) throw new Error("Document changed during repair");
                const revision = await tx.documentRevision.upsert({
                    where: { documentId_contentHash: { documentId: document.id, contentHash: hash } },
                    create: { documentId: document.id, title: document.title, content, contentHash: hash }, update: {},
                });
                await recordDocumentVersion(tx, revision.id, null, "published");
                await tx.documentSummary.updateMany({ where: { documentId: document.id, status: { in: ["fresh", "empty"] } }, data: { status: "stale" } });
                for (const annotation of await tx.documentAnnotation.findMany({ where: { documentId: document.id }, select: { id: true, content: true } })) {
                    const quote = repairPdfGlyphs(annotation.content);
                    if (quote !== annotation.content) await tx.documentAnnotation.update({ where: { id: annotation.id }, data: { content: quote } });
                }
            });
            const { orphaned } = await reanchorDocument(document.id, content);
            await indexDocumentPassages(document.id, content);
            console.log(`${driveFileId}: repaired (${orphaned} citations orphaned)`);
        }
    } finally {
        await prisma.$disconnect();
    }
}

if (process.argv[1]?.endsWith("repair-pdf-glyphs.ts")) main().catch(error => { console.error(error); process.exitCode = 1; });
