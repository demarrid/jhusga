/** Apply reviewed metadata to existing rows without a Drive sync or AI calls.
 * Run with the target archive's DATABASE_URL: npx tsx scripts/apply-document-corrections.ts */
import { DOCUMENT_CORRECTIONS } from "../config/document-corrections";
import { classifyDocument } from "../lib/kinds";
import { documentDate } from "../lib/identity";
import { prisma } from "../lib/prisma";
import { recordContributors } from "../lib/sync";

process.loadEnvFile(".env");

async function main() {
    for (const [driveFileId, correction] of Object.entries(DOCUMENT_CORRECTIONS)) {
        const document = await prisma.document.findUnique({ where: { driveFileId } });
        if (!document) continue;
        const kind = classifyDocument({ ...document, name: document.title, displayTitle: correction.displayTitle });
        await prisma.document.update({ where: { id: document.id }, data: {
            displayTitle: correction.displayTitle,
            kind,
            datedAt: documentDate(document),
        } });
        // A summary repeating the source's incorrect date should be regenerated.
        if (correction.datedOn && document.datedAt?.getTime() !== documentDate(document)?.getTime()) await prisma.documentSummary.updateMany({
            where: { documentId: document.id }, data: { status: "pending" },
        });
        if (kind.startsWith("bill.")) await recordContributors(document.id, document.content);
        console.log(`${driveFileId}: ${correction.displayTitle} (${kind})`);
    }
}

main().finally(() => prisma.$disconnect());
