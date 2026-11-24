/** node --env-file=.env --import tsx scripts/correct-false-guest.ts [--apply] */
import { mkdir, writeFile } from 'node:fs/promises';
import { prisma } from '../lib/prisma';
import { extractContributors, nameKey } from '../lib/contributors';

const id = '3522912b-da84-4eaf-9de6-15f76de36f0b';
async function main() {
    const person = await prisma.hopkinsAffiliate.findUnique({ where: { id }, include: { contributions: { include: { document: true } } } });
    if (!person) { console.log('False guest already removed.'); return; }
    if (person.nameKey !== nameKey('Freshmen Help Guide')) throw new Error('Unexpected identity');
    for (const row of person.contributions) {
        if (row.source !== 'parsed' || row.role !== 'guest' || !/Freshmen Help Guide \(Dean Wendland and Schlesinger['’]s Concept\)/.test(row.evidence)) throw new Error('Unexpected credit; review required');
        if (extractContributors(row.document.content, row.document.title, row.document.kind).some(p => nameKey(p.name) === person.nameKey)) throw new Error('Parser still admits the false person');
    }
    console.log(JSON.stringify(person.contributions.map(row => ({ documentId: row.documentId, title: row.document.title, evidence: row.evidence })), null, 2));
    if (!process.argv.includes('--apply')) return;
    await mkdir('.archive-local', { recursive: true });
    await writeFile('.archive-local/false-guest-correction-backup.json', JSON.stringify(person, null, 2));
    await prisma.$transaction(async tx => {
        for (const row of person.contributions) {
            const current = await tx.documentContributor.findUniqueOrThrow({ where: { id: row.id }, include: { document: true } });
            if (current.evidence !== row.evidence || current.source !== 'parsed' || current.role !== 'guest' || current.hopkinsAffiliateId !== id || current.document.content !== row.document.content) throw new Error('Evidence changed');
            await tx.documentContributor.delete({ where: { id: row.id } });
        }
        await tx.hopkinsAffiliate.deleteMany({ where: { id, nameKey: person.nameKey, contributions: { none: {} }, hopkinsRelationships: { none: {} }, reviewedAdministrator: { is: null }, userId: null, email: null } });
    });
    const remaining = await prisma.documentContributor.count({ where: { hopkinsAffiliateId: id } });
    if (remaining) throw new Error('False credits remain');
    console.log(`Verified removal of ${person.contributions.length} false guest credits.`);
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
