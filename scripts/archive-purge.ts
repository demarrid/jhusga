/**
 * Apply lib/archive-redaction.ts to text that is already stored.
 *
 *   node --import tsx scripts/archive-purge.ts            # dry run: counts only
 *   node --import tsx scripts/archive-purge.ts --apply
 *
 * New text is filtered as it is ingested (lib/sync.ts, archive-publish.ts);
 * this cleans what was stored before the filter existed or before a rule was
 * added. Quotes and derived text are rewritten first, then each document's
 * text, its image positions, citation offsets and search passages, so nothing
 * still points at a removed value. News-Letter articles are left alone: the
 * paper's published phone numbers are part of the reporting.
 *
 * The report holds counts only, never the values removed.
 */
import {createHash} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import {redactPersonalData, redactedOffset} from '../lib/archive-redaction';
process.loadEnvFile('.env');

const notNewsletter = `"documentId" IN (SELECT id FROM "Document" WHERE "discoveredVia" <> 'newsletter')`;
const derived: {table: string; where?: string}[] = [
    {table: 'DocumentAnnotation', where: notNewsletter},
    {table: 'DocumentRevision', where: notNewsletter},
    {table: 'DriveRevision', where: notNewsletter},
    {table: 'DocumentSummary', where: notNewsletter},
    {table: 'SearchAnswer'},
    {table: 'GeneratedSection'},
    {table: 'HistoryEvent'},
];
const sha = (text: string) => createHash('sha256').update(text).digest('hex');

async function main() {
    const {prisma} = await import('../lib/prisma');
    const {reanchorDocument} = await import('../lib/sync');
    const {indexDocumentPassages} = await import('../lib/search');
    const apply = process.argv.includes('--apply');
    const report: {table: string; scanned: number; changed: number}[] = [];
    try {
        for (const {table, where} of derived) {
            const rows = await prisma.$queryRawUnsafe<{id: string; content: string | null}[]>(
                `SELECT id, content FROM "${table}"${where ? ` WHERE ${where}` : ''}`);
            let changed = 0;
            for (const row of rows) {
                if (!row.content) continue;
                const content = redactPersonalData(row.content);
                if (content === row.content) continue;
                changed++;
                if (apply) await prisma.$executeRawUnsafe(`UPDATE "${table}" SET content=$1 WHERE id=$2 AND content=$3`, content, row.id, row.content);
            }
            report.push({table, scanned: rows.length, changed});
        }

        const documents = await prisma.document.findMany({
            where: {discoveredVia: {not: 'newsletter'}}, select: {id: true, content: true, contentHash: true}});
        let changed = 0;
        for (const document of documents) {
            const content = redactPersonalData(document.content);
            if (content === document.content) continue;
            changed++;
            if (!apply) continue;
            const contentHash = sha(content);
            await prisma.$transaction(async tx => {
                const updated = await tx.document.updateMany({where: {id: document.id, contentHash: document.contentHash}, data: {content, contentHash}});
                if (updated.count !== 1) throw new Error('Document changed during purge; rerun');
                // Images are matched to the text by hash; move them with it.
                const media = await tx.documentMedia.findMany({
                    where: {contentHash: sha(document.content), version: {revision: {documentId: document.id}}},
                    select: {versionId: true, images: {select: {id: true, offset: true}}}});
                for (const row of media) {
                    await tx.documentMedia.update({where: {versionId: row.versionId}, data: {contentHash}});
                    for (const image of row.images) await tx.documentImage.update({where: {id: image.id},
                        data: {offset: redactedOffset(document.content, image.offset)}});
                }
            });
            await reanchorDocument(document.id, content);
            await indexDocumentPassages(document.id, content);
        }
        report.push({table: 'Document', scanned: documents.length, changed});

        await writeFile('.archive-local/purge-progress.json', JSON.stringify({applied: apply, report}, null, 2));
        console.log(JSON.stringify({applied: apply, report}));
    } finally {
        await prisma.$disconnect();
    }
}

main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
