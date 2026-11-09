import assert from 'node:assert/strict';
import sharp from 'sharp';
import { createHash } from 'node:crypto';
import type { WalkedFile } from '../lib/drive';
import type { SyncSummary } from '../lib/sync';

async function main() {
    const content = '# Notes\n\nUnchanged words.';
    const contentHash = createHash('sha256').update(content).digest('hex');
    let modified = '2026-11-08T12:00:00Z';
    let changedDuringExport = false;
    let png = await sharp({ create: { width: 2, height: 2, channels: 4, background: 'navy' } }).png().toBuffer();
    const versions: { id: string; sourceModifiedTime: Date }[] = [];
    const captures: { versionId: string; images: { create: { bytes: Uint8Array }[] } }[] = [];
    const tx = {
        document: { update: async () => ({ id: 'doc' }) },
        documentRevision: { upsert: async () => ({ id: 'same-text' }) },
        documentVersion: { upsert: async ({ create }: { create: typeof versions[number] }) => { versions.push(create); } },
        documentMedia: { upsert: async ({ create }: { create: typeof captures[number] }) => { captures.push(create); } },
    };
    Object.assign(globalThis, { prisma: {
        document: { findUnique: async () => ({ id: 'doc', contentHash, driveModifiedTime: new Date('2026-11-07T12:00:00Z'), kind: 'unknown', reviewState: 'published' }) },
        $transaction: async (fn: (client: typeof tx) => unknown) => fn(tx),
    } });
    const originalFetch = globalThis.fetch;
    const originalKey = process.env.GOOGLE_API_KEY;
    process.env.GOOGLE_API_KEY = 'test-only';
    try {
        globalThis.fetch = async input => {
            const url = new URL(String(input));
            if (url.pathname.endsWith('/export')) return new Response(`${content}\n\n![][image1]\n\n[image1]: <data:image/png;base64,${png.toString('base64')}>`);
            return Response.json({ id: 'file', name: 'Notes', mimeType: 'application/vnd.google-apps.document', modifiedTime: changedDuringExport ? '2026-11-10T12:00:00Z' : modified });
        };
        const { ingestFile } = await import('../lib/sync');
        const file = (): WalkedFile => ({ id: 'file', name: 'Notes', mimeType: 'application/vnd.google-apps.document', createdTime: modified, modifiedTime: modified,
            webViewLink: 'https://docs.google.com/document/d/file', owner: null, lastModifyingUser: null, anyoneCanEdit: false, shortcutTo: null, folderPath: '', sessionNumber: 114 });
        const summary = { documentsUnchanged: 0 } as SyncSummary;
        assert.equal(await ingestFile(file(), 'walk', {}, summary), true);
        const firstBytes = Buffer.from(captures[0].images.create[0].bytes);
        png = await sharp({ create: { width: 2, height: 2, channels: 4, background: 'red' } }).png().toBuffer();
        modified = '2026-11-09T12:00:00Z';
        assert.equal(await ingestFile(file(), 'walk', {}, summary), true);
        assert.equal(versions.length, 2);
        assert.notEqual(versions[0].id, versions[1].id);
        assert.equal(captures[0].versionId, versions[0].id);
        assert.equal(captures[1].versionId, versions[1].id);
        assert.ok(!firstBytes.equals(Buffer.from(captures[1].images.create[0].bytes)));
        changedDuringExport = true;
        assert.equal(await ingestFile(file(), 'walk', {}, summary), false);
        assert.equal(captures.length, 2, 'moving source must not save media under an old timestamp');
    } finally {
        globalThis.fetch = originalFetch;
        if (originalKey === undefined) delete process.env.GOOGLE_API_KEY;
        else process.env.GOOGLE_API_KEY = originalKey;
    }
    console.log('Media sync checks passed: image-only changes get distinct versions; moving sources are rejected.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
