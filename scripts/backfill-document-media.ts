/** Restore media for an existing published Google Doc without modifying its text. */
import { prisma } from '../lib/prisma';
import { exportDocumentWithMedia, getFile, GOOGLE_DOC_MIME } from '../lib/drive';
import { saveDocumentMedia } from '../lib/document-media';
import { sanitizeExport } from '../lib/markdown';

async function main() {
    const id = process.argv.slice(2).find(arg => !arg.startsWith('--'));
    if (!id) throw new Error('Usage: node --env-file=.env --import tsx scripts/backfill-document-media.ts DOCUMENT_ID [--apply]');
    const apply = process.argv.includes('--apply');
    const document = await prisma.document.findUniqueOrThrow({ where: { id } });
    if (document.mimeType !== GOOGLE_DOC_MIME) throw new Error('Media backfill currently supports native Google Docs');
    const before = await getFile(document.driveFileId);
    if (!before?.modifiedTime || before.modifiedTime !== document.driveModifiedTime?.toISOString()) throw new Error('Source changed since the archived version; sync it first');
    const capture = await exportDocumentWithMedia(document.driveFileId);
    const after = await getFile(document.driveFileId);
    if (after?.modifiedTime !== before.modifiedTime) throw new Error('Source changed during export; no media saved');
    if (capture.content !== document.content) throw new Error('Exported text does not exactly match the stored document; no media saved');
    const versions = await prisma.documentVersion.findMany({ where: {
        status: 'published', sourceModifiedTime: new Date(before.modifiedTime), revision: { documentId: id },
    }, include: { revision: { select: { content: true } } } });
    const matching = versions.filter(version => version.revision.content === capture.content || sanitizeExport(version.revision.content) === capture.content);
    if (!matching.length) throw new Error('No matching published occurrence; no media saved');
    console.log({ documentId: id, versions: matching.map(version => version.id), images: capture.images.length,
        bytes: capture.images.reduce((total, image) => total + image.bytes.length, 0), apply });
    if (apply) await prisma.$transaction(async tx => {
        const current = await tx.document.findUniqueOrThrow({ where: { id } });
        if (current.content !== capture.content || current.driveModifiedTime?.toISOString() !== before.modifiedTime) throw new Error('Archive changed during backfill');
        for (const version of matching) await saveDocumentMedia(tx, version.id, capture);
    });
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
