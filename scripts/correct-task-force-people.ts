/** Source-backed repair for the reported task force doc. Preview by default; --apply writes. */
import { prisma } from '../lib/prisma';
import { extractContributors, nameKey } from '../lib/contributors';
const documentId = 'd21bec18-d793-4f79-84dd-8ee084860b2c';
const names = [['Abraham', 'Abraham Aini'], ['Mahima', 'Mahima Sanghera'], ['Sumi', 'Sumire Sumi']];
async function main() {
    const document = await prisma.document.findUniqueOrThrow({ where: { id: documentId } });
    if (document.sessionNumber !== 114) throw new Error('Unexpected session; review identities again');
    const parsed = extractContributors(document.content, document.title, document.kind);
    const additions = await Promise.all(names.map(async ([label, name]) => {
        const evidence = parsed.find(p => p.name === label && p.role === 'mentioned')?.evidence;
        if (!evidence) throw new Error(`Missing evidence for ${label}`);
        const person = await prisma.hopkinsAffiliate.findUniqueOrThrow({ where: { nameKey: nameKey(name) } });
        return { person, evidence };
    }));
    console.log(additions.map(({ person, evidence }) => ({ name: person.name, role: 'mentioned', evidence })));
    if (!process.argv.includes('--apply')) return;
    await prisma.$transaction(async tx => {
        const current = await tx.document.findUniqueOrThrow({ where: { id: documentId } });
        if (current.content !== document.content) throw new Error('Archive changed; review again');
        for (const { person, evidence } of additions) {
            const key = { documentId, hopkinsAffiliateId: person.id, role: 'mentioned' };
            const data = { source: 'manual', evidence, note: 'Source-backed planning mention. First names resolved against the 114th-session archive; Mahima Sanghera is the current-session senator, distinct from Mahima Singh in the 112th-session archive. Planning and insight labels do not establish authorship or attendance.' };
            await tx.documentContributor.upsert({ where: { documentId_hopkinsAffiliateId_role: key }, create: { ...key, ...data }, update: data });
        }
    });
    const saved = await prisma.documentContributor.findMany({ where: { documentId, role: 'mentioned' }, include: { hopkinsAffiliate: true } });
    for (const { person } of additions) if (!saved.some(row => row.hopkinsAffiliateId === person.id)) throw new Error(`Missing saved mention: ${person.name}`);
    console.log('Verified saved mentions:', saved.map(row => row.hopkinsAffiliate.name));
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
