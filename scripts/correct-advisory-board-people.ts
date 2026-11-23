/** Repair reviewed advisory-board mentions. Preview by default; --apply writes. */
import { prisma } from '../lib/prisma';
import { nameKey } from '../lib/contributors';
const documentId = '0f99f762-8ede-4c49-b308-88ce7d02fcb3';
// Each exact excerpt is checked against the stored source before writing.
// User confirmed Sophia Baleeiro and Jemima Schoen on 2026-11-23.
const mentions = [
    ['Sophia Baleeiro', 'Rain, Natalie, Sophia, and Demarri working with Jemima'],
    ['Jemima Schoen', 'Rain, Natalie, Sophia, and Demarri working with Jemima'],
    ['Boyi Chen', 'Boyi – Mol Cell and MSH'],
    ['Aishani Garg', 'Aishani Garg – Envi Sci and MPE'],
    ['Luke Holmes', 'Luke will investigate'],
    ['Demarri Dosunmu', 'Implementation Advisory Committee – Demarri Dosunmu'],
    ['Aarshi Lamichhane', 'WSE Undergraduate Program Committee (UPC) – Aarshi Lamichhane and Paul Woo'],
    ['Paul Woo', 'WSE Undergraduate Program Committee (UPC) – Aarshi Lamichhane and Paul Woo'],
    ['Sumire Sumi', 'Sumi and Shreemann for first meeting'],
    ['Shreemann Patel', 'Sumi and Shreemann for first meeting'],
    ['Cole Liazos-Coffey', 'Probably Cole for the rest'],
    ['Heidi Ding', 'Heidi Ding'],
    ['Jackson Morris', 'Jackson has tried to contact with little luck'],
    ['Rain Cheng', 'Rain Cheng is on it'],
    ['Natalie Bernstein', 'Natalie Bernstein and Abraham Aini are on it'],
    ['Willow Goode', 'Contacted Willow (head of Hopkins Votes), likely inactive'],
    ['Jazzlyn Fernandez', 'Jazzlyn Fernandez, confirmed ongoing relationship with FLI Caucus Senator'],
    ['Abraham Aini', 'Natalie Bernstein and Abraham Aini are on it'],
];
async function main() {
    const document = await prisma.document.findUniqueOrThrow({ where: { id: documentId } });
    if (document.sessionNumber !== 114 || document.title !== 'Student Advisory Boards - SGA') throw new Error('Unexpected document context');
    const additions = await Promise.all(mentions.map(async ([name, excerpt]) => {
        const evidence = document.content.split('\n').find(line => line.includes(excerpt))?.trim();
        if (!evidence) throw new Error(`Missing evidence for ${name}`);
        const person = await prisma.hopkinsAffiliate.findUnique({ where: { nameKey: nameKey(name) } });
        if (!person && name !== 'Jemima Schoen') throw new Error('Missing archive identity: ' + name);
        return { person, name, evidence };
    }));
    console.log(additions.map(({ name, evidence }) => ({ name, evidence })));
    if (!process.argv.includes('--apply')) return;
    await prisma.$transaction(async tx => {
        const current = await tx.document.findUniqueOrThrow({ where: { id: documentId } });
        if (current.content !== document.content) throw new Error('Archive changed; review again');
        for (const { person: existing, name, evidence } of additions) {
            const person = existing ?? await tx.hopkinsAffiliate.upsert({ where: { nameKey: nameKey(name) }, create: { name, nameKey: nameKey(name) }, update: {} });
            const key = { documentId, hopkinsAffiliateId: person.id, role: 'mentioned' };
            const data = { source: 'manual', evidence, note: 'Reviewed advisory-board source mention. User confirmed Sophia Baleeiro and Jemima Schoen on 2026-11-23. Short names matched to archive identities; Jackson is the Disability Caucus/Civic Engagement senator and Willow is the archived civic-life advisor. This does not establish board membership, attendance, or authorship.' };
            await tx.documentContributor.upsert({ where: { documentId_hopkinsAffiliateId_role: key }, create: { ...key, ...data }, update: data });
        }
    });
    const saved = await prisma.documentContributor.findMany({ where: { documentId, role: 'mentioned' }, include: { hopkinsAffiliate: true } });
    for (const { name, evidence } of additions) if (!saved.some(row => row.hopkinsAffiliate.nameKey === nameKey(name) && row.evidence === evidence)) throw new Error(`Verification failed: ${name}`);
    console.log('Verified saved mentions:', saved.map(row => row.hopkinsAffiliate.name));
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());

