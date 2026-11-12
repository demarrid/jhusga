/** Evidence-backed additions requested for the November 10 Senate minutes.
 * node --env-file=.env --import tsx scripts/correct-november-10-people.ts [--apply]
 */
import { prisma } from '../lib/prisma';

async function main() {
    const documentId = '17b9f20a-fcbe-4703-865a-f848e6c96ec2';
    const document = await prisma.document.findUniqueOrThrow({ where: { id: documentId }, select: { content: true } });
    const corrections = [
        { id: '9050de01-fbfd-4b2f-bf94-f0aa13a479a1', name: 'Andrew Gao', label: 'gao', role: 'interlocutor', pattern: /^gao:/i },
        { id: 'c6662c48-0958-4f9b-bcf3-62d46745960e', name: 'Grace Guan', label: 'grace', role: 'mentioned', pattern: /grace not here today/i },
        { id: '03422010-fc2a-4b93-8e20-f78c6b06652d', name: 'Shreemann Patel', label: 'shreemann', role: 'interlocutor', pattern: /^shreemann:/i },
        { id: '496bde14-0e90-47a7-a591-dd1bec5ec591', name: 'Tekeya Peterson', label: 'peterson', role: 'interlocutor', pattern: /^peterson:/i },
    ];
    const planned = await Promise.all(corrections.map(async correction => {
        const person = await prisma.hopkinsAffiliate.findUniqueOrThrow({ where: { id: correction.id }, select: { name: true } });
        if (person.name !== correction.name) throw new Error(`Person mismatch: ${correction.id}`);
        const evidence = document.content.split(/\r?\n/).find(line => correction.pattern.test(line));
        if (!evidence) throw new Error(`Missing evidence for ${correction.name}`);
        return { ...correction, evidence };
    }));
    console.log(JSON.stringify(planned.map(({ name, role, evidence }) => ({ name, role, evidence })), null, 2));
    if (!process.argv.includes('--apply')) return;
    await prisma.$transaction(async tx => {
        for (const person of planned) {
            const key = { documentId, hopkinsAffiliateId: person.id, role: person.role };
            const data = { source: 'manual', evidence: person.evidence,
                note: `Matched archived label "${person.label}" to ${person.name} from the user's linked people list for these minutes.${person.role === 'mentioned' ? ' Mention only; the minutes explicitly say Grace is not here.' : ''}` };
            await tx.documentContributor.upsert({ where: { documentId_hopkinsAffiliateId_role: key }, create: { ...key, ...data }, update: data });
        }
    });
    const saved = await prisma.documentContributor.findMany({ where: { documentId, hopkinsAffiliateId: { in: planned.map(person => person.id) } },
        select: { hopkinsAffiliateId: true, role: true, source: true, evidence: true } });
    for (const person of planned) {
        if (!saved.some(row => row.hopkinsAffiliateId === person.id && row.role === person.role && row.source === 'manual' && row.evidence === person.evidence)) {
            throw new Error(`Saved correction failed verification: ${person.name}`);
        }
    }
    console.log('Verified all four saved additions.');
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
