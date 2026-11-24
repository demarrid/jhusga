/** User-confirmed identity correction. node --env-file=.env --import tsx scripts/correct-nifemi-ajayi.ts [--apply] */
import { mkdir, writeFile } from 'node:fs/promises';
import { prisma } from '../lib/prisma';
const fromId = '1a5d3d8c-8549-4447-bc20-7fe8ddb43a4c';
const intoId = '2876763a-9b06-4fb6-a73b-4c17c23ee04d';
async function main() {
    const people = await prisma.hopkinsAffiliate.findMany({ where: { id: { in: [fromId, intoId] } }, include: { contributions: true, aliases: true, hopkinsRelationships: true } });
    const from = people.find(row => row.id === fromId);
    const into = people.find(row => row.id === intoId);
    if (!into || into.name !== 'Oluwanifemi Ajayi') throw new Error('Unexpected canonical identity');
    if (!from) { console.log('Identity already merged.'); return; }
    if (from.name !== 'Nifemi Ajayi' || from.email || from.userId || from.hopkinsRelationships.length) throw new Error('Unexpected source identity');
    console.log({ from: from.name, into: into.name, movingCredits: from.contributions.length, existingCredits: into.contributions.length });
    if (!process.argv.includes('--apply')) return;
    await mkdir('.archive-local', { recursive: true });
    await writeFile('.archive-local/nifemi-ajayi-before-merge.json', JSON.stringify(people, null, 2));
    await prisma.$transaction(async tx => {
        const current = await tx.hopkinsAffiliate.findUniqueOrThrow({ where: { id: fromId }, include: { contributions: true, hopkinsRelationships: true } });
        if (current.updatedAt.getTime() !== from.updatedAt.getTime() || current.contributions.length !== from.contributions.length || current.hopkinsRelationships.length) throw new Error('Identity changed');
        for (const row of current.contributions) {
            if (!from.contributions.some(old => old.id === row.id && old.updatedAt.getTime() === row.updatedAt.getTime())) throw new Error('Credit changed');
            const duplicate = await tx.documentContributor.findUnique({ where: { documentId_hopkinsAffiliateId_role: { documentId: row.documentId, hopkinsAffiliateId: intoId, role: row.role } } });
            if (duplicate) throw new Error('Overlapping credits require evidence review');
            await tx.documentContributor.update({ where: { id: row.id }, data: { hopkinsAffiliateId: intoId } });
        }
        await tx.hopkinsAlias.updateMany({ where: { hopkinsAffiliateId: fromId }, data: { hopkinsAffiliateId: intoId } });
        await tx.hopkinsAlias.upsert({ where: { aliasKey: 'nifemi ajayi' }, create: { alias: 'Nifemi Ajayi', aliasKey: 'nifemi ajayi', hopkinsAffiliateId: intoId, source: 'manual' }, update: { hopkinsAffiliateId: intoId, source: 'manual' } });
        await tx.hopkinsAffiliate.delete({ where: { id: fromId } });
    });
    const moved = await prisma.documentContributor.findMany({ where: { id: { in: from.contributions.map(row => row.id) } } });
    if (moved.length !== from.contributions.length || moved.some(row => row.hopkinsAffiliateId !== intoId)) throw new Error('Merge verification failed');
    console.log(`Verified: moved ${moved.length} credits with original evidence and IDs intact; saved manual alias.`);
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
