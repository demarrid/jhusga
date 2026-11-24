/** Reviewed digital excerpts; never downloads or modifies the original PDF.
 * node --env-file=.env --import tsx scripts/split-sga-compilation.ts [--apply]
 */
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { compilationExcerpts, compilationHash, compilationId } from '../config/sga-compilation-excerpts';
import { prisma } from '../lib/prisma';
import { splitIntoPassages } from '../lib/passages';
import { recordDocumentVersion } from '../lib/document-version-history';
import { extractContributors, nameKey } from '../lib/contributors';

const sha = (text: string) => createHash('sha256').update(text).digest('hex');
const falsePersonId = 'a8da9b60-9064-4e30-a7f1-e4fe0f595a07';

async function main() {
    const parent = await prisma.document.findUniqueOrThrow({ where: { id: compilationId }, include: { contributors: { include: { hopkinsAffiliate: true } } } });
    if (parent.discoveredVia !== 'archive' || sha(parent.content) !== compilationHash || parent.contentHash !== compilationHash) throw new Error('Compilation changed; re-review source boundaries before applying');
    const lines = parent.content.split('\n');
    let previousEnd = 0;
    const prepared = compilationExcerpts.map(excerpt => {
        if (excerpt.start <= previousEnd || excerpt.end < excerpt.start || excerpt.end >= lines.length - 2) throw new Error('Invalid or overlapping excerpt');
        previousEnd = excerpt.end;
        const body = lines.slice(excerpt.start - 1, excerpt.end).join('\n').trim();
        if (!body) throw new Error('Empty excerpt');
        const content = `${body}\n\n## Sources\n\n[Original SGA compilation (PDF)](${parent.source}) · [Full digital compilation](/documents/${parent.id})`;
        const driveFileId = `archive-excerpt:${parent.driveFileId}:${excerpt.start}-${excerpt.end}`;
        // Reuse only already-established identities whose exact parsed name and
        // role are supported within this excerpt. Never infer an identity from
        // another document, an enactment signature, or a partial surname.
        const credits = extractContributors(body, excerpt.title, excerpt.kind).flatMap(person => {
            const matches = parent.contributors.filter(row => row.hopkinsAffiliate.nameKey === nameKey(person.name) && row.role === person.role && row.hopkinsAffiliateId !== falsePersonId);
            return matches.slice(0, 1).map(row => ({ hopkinsAffiliateId: row.hopkinsAffiliateId, role: person.role, source: 'parsed', evidence: person.evidence, note: 'Identity retained from the compilation; evidence scoped to this excerpt.' }));
        });
        return { excerpt, body, content, driveFileId, credits };
    });
    const placeholder = await prisma.hopkinsAffiliate.findUnique({ where: { id: falsePersonId }, include: { contributions: true } });
    if (placeholder && (placeholder.nameKey !== nameKey('To Be Announced') || placeholder.contributions.some(row => row.source !== 'parsed'))) throw new Error('Unexpected placeholder identity or curated credits');
    const existing = await prisma.document.findMany({ select: { id: true, driveFileId: true, content: true } });
    const bodyKey = (text: string) => text.split('\n## Sources\n')[0].replace(/\s+/g, ' ').trim();
    for (const row of prepared) {
        const duplicate = existing.find(doc => doc.id !== parent.id && doc.driveFileId !== row.driveFileId && bodyKey(doc.content) === bodyKey(row.body));
        if (duplicate) throw new Error(`Already published as ${duplicate.id}: ${row.excerpt.title}; review before duplicating`);
    }
    await mkdir('.archive-local', { recursive: true });
    const covered = new Set(prepared.flatMap(row => Array.from({ length: row.excerpt.end - row.excerpt.start + 1 }, (_, i) => row.excerpt.start + i)));
    const residualLines = lines.flatMap((line, i) => i < 4547 && line.trim() && !covered.has(i + 1) ? [i + 1] : []);
    console.log(JSON.stringify({ documents: prepared.map(row => ({ ...row.excerpt, credits: row.credits.length })), placeholderCredits: placeholder?.contributions.length ?? 0, residualLines: residualLines.length }, null, 2));
    if (!process.argv.includes('--apply')) return;
    await writeFile('.archive-local/compilation-before-split.json', JSON.stringify({ parent, placeholder }, null, 2));
    const report = await prisma.$transaction(async tx => {
        const current = await tx.document.findUniqueOrThrow({ where: { id: parent.id } });
        if (current.content !== parent.content) throw new Error('Compilation changed after preview');
        const result = [];
        for (const row of prepared) {
            const prior = await tx.document.findUnique({ where: { driveFileId: row.driveFileId } });
            if (prior && (prior.content !== row.content || prior.source !== parent.source || prior.discoveredVia !== 'archive')) throw new Error('Previously published excerpt changed; refusing overwrite');
            const datedAt = row.excerpt.date ? new Date(`${row.excerpt.date}T12:00:00Z`) : null;
            const document = prior ?? await tx.document.create({ data: {
                driveFileId: row.driveFileId, source: parent.source, mimeType: 'text/markdown',
                title: row.excerpt.title, displayTitle: row.excerpt.title, kind: row.excerpt.kind,
                content: row.content, contentHash: sha(row.content), discoveredVia: 'archive',
                folderPath: parent.folderPath, datedAt,
                meetingRole: row.excerpt.kind.startsWith('minutes.') ? 'agenda' : '',
                description: 'Individual digital document transcribed from the SGA compilation. The original PDF is shared with the full collection.',
            } });
            if (!prior) {
                const revision = await tx.documentRevision.create({ data: { documentId: document.id, title: document.title, content: document.content, contentHash: document.contentHash } });
                await recordDocumentVersion(tx, revision.id, null, 'published');
                await tx.documentPassage.createMany({ data: splitIntoPassages(document.content).map(passage => ({ documentId: document.id, ...passage })) });
                if (row.credits.length) await tx.documentContributor.createMany({ data: row.credits.map(credit => ({ documentId: document.id, ...credit })) });
            }
            for (const [fromDocumentId, toDocumentId, anchorText] of [[parent.id, document.id, document.title], [document.id, parent.id, 'Full SGA compilation']]) {
                await tx.documentReference.upsert({ where: { fromDocumentId_toDocumentId: { fromDocumentId, toDocumentId } }, create: { fromDocumentId, toDocumentId, anchorText, ordinal: row.excerpt.start }, update: {} });
            }
            result.push({ id: document.id, title: document.title, start: row.excerpt.start, end: row.excerpt.end, status: prior ? 'unchanged' : 'created' });
        }
        await tx.document.update({ where: { id: parent.id }, data: { kind: 'collection', datedAt: null, displayTitle: 'SGA Historical Document Compilation', description: 'Compilation of SGA agendas, legislation, reports, ceremony programs, financial records, and handwritten notes. Identifiable documents are also available as separate digital records sharing this original PDF.' } });
        await tx.documentSummary.updateMany({ where: { documentId: parent.id, status: { in: ['fresh', 'empty'] } }, data: { status: 'stale' } });
        if (placeholder) {
            await tx.documentContributor.deleteMany({ where: { hopkinsAffiliateId: falsePersonId, source: 'parsed' } });
            await tx.hopkinsAffiliate.deleteMany({ where: { id: falsePersonId, nameKey: nameKey('To Be Announced'), contributions: { none: {} }, hopkinsRelationships: { none: {} }, reviewedAdministrator: { is: null }, userId: null, email: null } });
        }
        return result;
    }, { timeout: 60000 });
    const saved = await prisma.document.findMany({ where: { driveFileId: { in: prepared.map(row => row.driveFileId) } }, include: { _count: { select: { passages: true, revisions: true } } } });
    if (saved.length !== prepared.length || saved.some(doc => !doc._count.passages || !doc._count.revisions || doc.source !== parent.source)) throw new Error('Post-publication verification failed');
    const retained = await prisma.document.findUniqueOrThrow({ where: { id: parent.id } });
    if (retained.content !== parent.content || retained.source !== parent.source) throw new Error('Original changed unexpectedly');
    if (await prisma.documentContributor.count({ where: { hopkinsAffiliateId: falsePersonId } })) throw new Error('Placeholder credits remain');
    await writeFile('.archive-local/compilation-split-report.json', JSON.stringify({ report, residualLines }, null, 2));
    console.log(JSON.stringify({ verified: saved.length, originalPreserved: true, placeholderCredits: 0, report }, null, 2));
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
