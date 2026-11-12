/** Resolve Dr. Brown in Executive Meeting #10 using the user-provided official profile.
 * node --env-file=.env --import tsx scripts/correct-brittini-brown.ts [--apply]
 */
import { prisma } from '../lib/prisma';
import { nameKey } from '../lib/contributors';

async function main() {
    const documentId = '29351296-cf91-4513-be0f-5e28e4fe3259';
    const name = 'Brittini Brown';
    const document = await prisma.document.findUniqueOrThrow({
        where: { id: documentId }, select: { content: true },
    });
    const evidence = document.content.split(/\r?\n/)
        .find(line => line.includes('Hopkins Groups Reform Updates (Dr. Brown)'));
    if (!evidence) throw new Error('Expected archived Dr. Brown agenda item is missing');
    const data = {
        source: 'manual', evidence,
        note: 'The user identified Dr. Brown as Brittini Brown. Official profile: https://provost.jhu.edu/members/brittini-brown/ (Associate Vice Provost for Student Engagement and Dean of Students). Named in the agenda; this does not establish attendance or a completed speaking turn.',
    };
    console.log(JSON.stringify({ name, role: 'mentioned', ...data }, null, 2));
    if (!process.argv.includes('--apply')) return;
    const saved = await prisma.$transaction(async tx => {
        const person = await tx.hopkinsAffiliate.upsert({
            where: { nameKey: nameKey(name) },
            create: { name, nameKey: nameKey(name) }, update: {},
        });
        const key = { documentId, hopkinsAffiliateId: person.id, role: 'mentioned' };
        await tx.documentContributor.upsert({
            where: { documentId_hopkinsAffiliateId_role: key },
            create: { ...key, ...data }, update: data,
        });
        return tx.documentContributor.findUniqueOrThrow({
            where: { documentId_hopkinsAffiliateId_role: key },
            select: { role: true, source: true, evidence: true, note: true,
                hopkinsAffiliate: { select: { name: true } } },
        });
    });
    if (saved.source !== 'manual' || saved.hopkinsAffiliate.name !== name || saved.evidence !== evidence) {
        throw new Error('Saved correction failed verification');
    }
    console.log('Verified saved correction:', JSON.stringify(saved, null, 2));
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
