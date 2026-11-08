import assert from 'node:assert/strict';
import sharp from 'sharp';
import type { Prisma } from '@prisma/client';
import { captureDocumentMedia, saveDocumentMedia, loadDocumentImages, mediaTextHash } from '../lib/document-media';
import { sanitizeExport } from '../lib/markdown';
import { renderDocument, type Block, type InlineRun } from '../lib/render';
import { findQuote } from '../lib/anchor';

function runs(blocks: Block[]): InlineRun[] {
    return blocks.flatMap(block => {
        if (block.kind === 'heading' || block.kind === 'paragraph') return block.runs;
        if (block.kind === 'quote') return runs(block.blocks);
        if (block.kind === 'list') return block.items.flatMap(item => [...item.runs, ...runs(item.blocks)]);
        if (block.kind === 'table') return [...(block.header?.cells.flat() ?? []), ...block.rows.flatMap(row => row.cells.flat())];
        if (block.kind === 'layout') return block.rows.flatMap(row => row.cells.flat());
        return [];
    });
}
async function main() {
    const png = await sharp({ create: { width: 3, height: 2, channels: 4, background: '#002d72' } }).png().toBuffer();
    const definition = `[image1]: <data:image/png;base64,${png.toString('base64')}>`;
    const source = `\n\n# Scores\n\n![][image1]\n\nBefore ![Chart][image1] after.\n\n**![][image1]![][image1]**\n\n${definition}`;
    const capture = await captureDocumentMedia(source);
    assert.equal(capture.content, sanitizeExport(source));
    assert.equal(capture.images.length, 4);
    assert.deepEqual(capture.images.map(image => image.inline), [false, true, false, false]);
    assert.ok(capture.images.every(image => image.width === 3 && image.height === 2 && Buffer.from(image.bytes).equals(png)));
    const quote = findQuote(capture.content, 'Before  after.')!;
    const blocks = renderDocument(capture.content, [{ id: 'quote', ...quote }], { images: capture.images.map((image, i) => ({ ...image, src: `/api/document-images/${i}` })) });
    const rendered = runs(blocks);
    assert.equal(rendered.filter(run => run.image).length, 4);
    assert.equal(rendered.filter(run => run.annotationId === 'quote').map(run => run.text).join(''), 'Before  after.');
    const inlineAt = rendered.findIndex(run => run.image?.inline);
    assert.equal(rendered[inlineAt - 1].text, 'Before ');
    assert.equal(rendered[inlineAt + 1].text, ' after.');
    const last = await captureDocumentMedia(`Text\n\n![][image1]\n\n${definition}`);
    assert.equal(runs(renderDocument(last.content, [], { images: last.images.map(image => ({ ...image, src: '/last' })) })).filter(run => run.image).length, 1);
    const table = await captureDocumentMedia(`| Label | Value |\n| --- | --- |\n| Diagram ![][image1] | 4 |\n\n${definition}`);
    assert.equal(runs(renderDocument(table.content, [], { images: table.images.map(image => ({ ...image, src: '/table' })) })).filter(run => run.image).length, 1);
    for (const body of ['- ![][image1]', '| ![][image1] | Value |\n| --- | --- |\n| Text | 4 |']) {
        const capture = await captureDocumentMedia(`${body}\n\n${definition}`);
        assert.equal(capture.images[0].inline, true);
        assert.equal(runs(renderDocument(capture.content, [], { images: capture.images.map(image => ({ ...image, src: '/edge' })) })).filter(run => run.image).length, 1);
    }
    assert.equal((await captureDocumentMedia('![remote](https://example.test/image.png)')).images.length, 0);
    assert.equal((await captureDocumentMedia('![unsafe](data:image/svg+xml;base64,PHN2Zy8+)')).images.length, 0);

    let saved: unknown;
    const tx = { documentMedia: { upsert: async (query: { update: unknown; create: unknown }) => {
        assert.deepEqual(query.update, {}); saved ??= query.create;
    } } } as unknown as Prisma.TransactionClient;
    await saveDocumentMedia(tx, 'version', capture);
    const first = saved;
    await saveDocumentMedia(tx, 'version', { content: 'different', images: [] });
    assert.equal(saved, first, 'retries must not rewrite a saved version');
    const whereQueries: unknown[] = [];
    Object.assign(globalThis, { prisma: {
        documentMedia: { findFirst: async (query: { where: unknown }) => { whereQueries.push(query.where); return { images: [{ id: 'image', offset: 0, inline: false, alt: 'Chart', width: 3, height: 2 }] }; } },
        documentImage: { findFirst: async ({ where }: { where: { id: string; media: { version: { status: string } } } }) => {
            assert.equal(where.media.version.status, 'published');
            return where.id === 'public' ? { bytes: png, mimeType: 'image/png' } : null;
        } },
    } });
    const images = await loadDocumentImages('doc', capture.content, 'version');
    assert.equal(images[0].src, '/api/document-images/image');
    assert.deepEqual(whereQueries[0], { contentHash: mediaTextHash(capture.content), version: { id: 'version', status: 'published', revision: { documentId: 'doc' } } });
    const { GET } = await import('../app/api/document-images/[imageId]/route');
    assert.equal((await GET(new Request('https://example.test'), { params: Promise.resolve({ imageId: 'held-or-missing' }) })).status, 404);
    const response = await GET(new Request('https://example.test'), { params: Promise.resolve({ imageId: 'public' }) });
    assert.equal(response.headers.get('Content-Type'), 'image/png');
    assert.equal(response.headers.get('X-Content-Type-Options'), 'nosniff');
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    assert.ok(Buffer.from(await response.arrayBuffer()).equals(png));
    console.log('Media checks passed: placement, citation offsets, tables, raster validation, immutable capture, scoping and image responses.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
