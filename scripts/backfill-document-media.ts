/**
 * Restore media for an existing published Google Doc without modifying its text.
 *
 * A document stored before media capture existed was exported by an older
 * converter, so today's export can differ in formatting alone (a `<br>` in a
 * table cell, an escaped `\$`). When the words match character for character
 * (lib/docx-refresh.ts), each image is moved onto the stored text between the
 * same two characters of text it sits between in the export: a block image to
 * the start of a line, an inline one into the same gap. The backfill refuses
 * unless every image has such a place and the stored text, rendered with the
 * images, shows every one of them.
 */
import { readFileSync } from 'node:fs';
import { prisma } from '../lib/prisma';
import { exportDocumentWithMedia, getFile, GOOGLE_DOC_MIME } from '../lib/drive';
import { redactCapturedDocument, saveDocumentMedia, type CapturedDocument } from '../lib/document-media';
import { isPersonalDocument } from '../lib/archive-redaction';
import { formattingFreeText, sameWords } from '../lib/docx-refresh';
import { sanitizeExport } from '../lib/markdown';
import { renderDocument } from '../lib/render';

/** The capture placed on the stored text, or an error when that cannot be done exactly. */
function onStoredText(capture: CapturedDocument, stored: string): CapturedDocument {
    if (capture.content === stored) return capture;
    if (!sameWords(stored, capture.content)) throw new Error('Exported words differ from the stored document; no media saved');
    const fresh = formattingFreeText(capture.content);
    const kept = formattingFreeText(stored);
    const images = capture.images.map(image => {
        // The image sits after `k` characters of text, formatting aside.
        const after = fresh.map.findIndex(index => index >= image.offset);
        const k = after < 0 ? fresh.map.length : after;
        const previous = k === 0 ? -1 : kept.map[k - 1]!;
        const next = k < kept.map.length ? kept.map[k]! : stored.length;
        let offset: number;
        if (image.inline) {
            // Take the same spacing or markup the export has before the image, as far as the stored text has it too.
            const gap = capture.content.slice(k === 0 ? 0 : fresh.map[k - 1]! + 1, image.offset);
            const room = stored.slice(previous + 1, next);
            let same = 0;
            while (same < gap.length && same < room.length && gap[same] === room[same]) same++;
            offset = previous + 1 + same;
        } else {
            offset = k === 0 ? 0 : stored.indexOf('\n', previous) + 1;
            if (k > 0 && offset === 0) offset = -1;
        }
        // Between the same two characters of text as in the export.
        if (offset < previous + 1 || offset > next) throw new Error(`${image.alt} has no matching position in the stored text; no media saved`);
        return { ...image, offset };
    });
    // Placed is not shown: the renderer accepts a block image only at a line start, an inline one only beside its text.
    const marked = images.map((image, index) => ({ offset: image.offset, inline: image.inline, alt: image.alt,
        width: image.width, height: image.height, src: `/backfill-check/${index}` }));
    const rendered = JSON.stringify(renderDocument(stored, [], { images: marked }));
    const missing = marked.find(image => rendered.split(`"${image.src}"`).length !== 2);
    if (missing) throw new Error(`${missing.alt} would not render in the stored text; no media saved`);
    return { content: stored, images };
}

/**
 * node --env-file=.env --import tsx scripts/backfill-document-media.ts DOCUMENT_ID... [--from FILE] [--apply]
 *
 * `--from` reads one document ID per line. A document whose source has no
 * images is skipped. With several documents, one that cannot be backfilled is
 * reported and the rest continue.
 */
async function main() {
    const argv = process.argv.slice(2);
    const fromAt = argv.indexOf('--from');
    const ids = [
        ...argv.filter((arg, index) => !arg.startsWith('--') && (fromAt < 0 || index !== fromAt + 1)),
        ...(fromAt >= 0 ? readFileSync(argv[fromAt + 1]!, 'utf8').split(/\s+/) : []),
    ].filter(Boolean);
    if (!ids.length) throw new Error('Usage: node --env-file=.env --import tsx scripts/backfill-document-media.ts DOCUMENT_ID... [--from FILE] [--apply]');
    const apply = argv.includes('--apply');
    if (ids.length === 1) {
        if (!await backfill(ids[0]!, apply)) console.log('no images', ids[0]);
        return;
    }
    const tally: Record<string, number> = {};
    for (const id of ids) {
        const outcome = await backfill(id, apply).then(images => images ? 'backfilled' : 'no images',
            (error: unknown) => { console.log('skipped', id, error instanceof Error ? error.message : String(error)); return 'skipped'; });
        tally[outcome] = (tally[outcome] ?? 0) + 1;
    }
    console.log(tally);
}

/** The number of images saved (or that would be), or 0 when the source has none. */
async function backfill(id: string, apply: boolean): Promise<number> {
    const document = await prisma.document.findUniqueOrThrow({ where: { id } });
    if (document.mimeType !== GOOGLE_DOC_MIME) throw new Error('Media backfill currently supports native Google Docs');
    const before = await getFile(document.driveFileId);
    if (!before?.modifiedTime || before.modifiedTime !== document.driveModifiedTime?.toISOString()) throw new Error('Source changed since the archived version; sync it first');
    // Redacted as sync redacts it, so the comparison is with the text sync would store.
    const exported = redactCapturedDocument(await exportDocumentWithMedia(document.driveFileId), { personal: isPersonalDocument(document.title) });
    const after = await getFile(document.driveFileId);
    if (after?.modifiedTime !== before.modifiedTime) throw new Error('Source changed during export; no media saved');
    if (!exported.images.length) return 0;
    const capture = onStoredText(exported, document.content);
    const versions = await prisma.documentVersion.findMany({ where: {
        status: 'published', sourceModifiedTime: new Date(before.modifiedTime), revision: { documentId: id },
    }, include: { revision: { select: { content: true } } } });
    const matching = versions.filter(version => version.revision.content === capture.content || sanitizeExport(version.revision.content) === capture.content);
    if (!matching.length) throw new Error('No matching published occurrence; no media saved');
    console.log({ documentId: id, title: document.title, versions: matching.map(version => version.id), images: capture.images.length,
        bytes: capture.images.reduce((total, image) => total + image.bytes.length, 0), apply });
    if (apply) await prisma.$transaction(async tx => {
        const current = await tx.document.findUniqueOrThrow({ where: { id } });
        if (current.content !== capture.content || current.driveModifiedTime?.toISOString() !== before.modifiedTime) throw new Error('Archive changed during backfill');
        for (const version of matching) await saveDocumentMedia(tx, version.id, capture);
    });
    return capture.images.length;
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
