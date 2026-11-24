/** node --env-file=.env --import tsx scripts/normalize-historical-meeting-titles.ts [--apply] */
import { mkdir, writeFile } from 'node:fs/promises';
import { prisma } from '../lib/prisma';
import { canonicalTitle, standardTitles } from '../lib/titles';
import { SESSION_NUMBER } from '../config/sga';
async function main() {
    const meetings = await prisma.document.findMany({ where: { kind: { startsWith: 'minutes.' } }, select: {
        id: true, driveFileId: true, title: true, displayTitle: true, kind: true, folderPath: true,
        sessionNumber: true, datedAt: true, driveCreatedTime: true, content: true, contentHash: true,
        discoveredVia: true, meetingRole: true, updatedAt: true,
    } });
    const titles = standardTitles(meetings);
    const otherTitles = new Set((await prisma.document.findMany({ where: { NOT: { kind: { startsWith: 'minutes.' } } }, select: { title: true, displayTitle: true } })).flatMap(row => [row.title, row.displayTitle]));
    const changes: { document: typeof meetings[number]; proposed: string }[] = [];
    const deferred = [];
    for (const document of meetings) {
        if (document.discoveredVia !== 'archive' && (document.sessionNumber === null || document.sessionNumber >= SESSION_NUMBER)) continue;
        const canonical = canonicalTitle(document);
        const proposed = titles.get(document.id);
        if (!canonical || !proposed || proposed !== canonical || otherTitles.has(canonical)) {
            deferred.push({ id: document.id, title: document.title, reason: !canonical ? 'No unambiguous meeting title' : 'Title collision; preserve original distinction' });
            continue;
        }
        if (proposed !== document.displayTitle) changes.push({ document, proposed });
    }
    await mkdir('.archive-local', { recursive: true });
    await writeFile('.archive-local/historical-meeting-title-preview.json', JSON.stringify({ changes: changes.map(({ document, proposed }) => ({ id: document.id, original: document.title, before: document.displayTitle, after: proposed })), deferred }, null, 2));
    console.log({ changes: changes.length, deferred: deferred.length });
    if (!process.argv.includes('--apply')) return;
    await writeFile('.archive-local/historical-meeting-title-backup.json', JSON.stringify(changes, null, 2));
    await prisma.$transaction(async tx => {
        for (const { document, proposed } of changes) {
            const result = await tx.document.updateMany({ where: { id: document.id, updatedAt: document.updatedAt }, data: { displayTitle: proposed } });
            if (result.count !== 1) throw new Error('Document changed since preview; retry');
        }
    }, { timeout: 60000 });
    const saved = await prisma.document.findMany({ where: { id: { in: changes.map(row => row.document.id) } }, select: { id: true, title: true, displayTitle: true, contentHash: true } });
    for (const { document, proposed } of changes) {
        const row = saved.find(row => row.id === document.id);
        if (!row || row.displayTitle !== proposed || row.title !== document.title || row.contentHash !== document.contentHash) throw new Error('Verification failed');
    }
    console.log(`Verified ${saved.length} display titles; original titles and content hashes preserved.`);
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
