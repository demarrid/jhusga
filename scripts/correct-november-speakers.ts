/** User-confirmed speaker identities in the November 3 Senate minutes.
 * node --import tsx scripts/correct-november-speakers.ts [--apply]
 */
process.loadEnvFile('.env');

async function main() {
    const { prisma } = await import('../lib/prisma');
    const { nameKey } = await import('../lib/contributors');
    try {
        const document = await prisma.document.findUniqueOrThrow({
            where: { id: '58442442-9ef8-486e-897b-4d0ca731310a' },
            select: { id: true, content: true },
        });
        const corrections = [
            { label: 'alex', name: 'Alex Weiss' },
            { label: 'rain', name: 'Rain (Hayden) Cheng' },
            { label: 'peterson', name: 'Tekeya Peterson' },
        ].map(correction => {
            const evidence = document.content.split(/\r?\n/)
                .find(line => line.toLowerCase().startsWith(`${correction.label}:`));
            if (!evidence) throw new Error(`Missing archived speaker label: ${correction.label}`);
            return { ...correction, evidence };
        });
        console.log(JSON.stringify(corrections, null, 2));
        if (!process.argv.includes('--apply')) return;
        await prisma.$transaction(async tx => {
            for (const correction of corrections) {
                const person = await tx.hopkinsAffiliate.upsert({
                    where: { nameKey: nameKey(correction.name) },
                    create: { name: correction.name, nameKey: nameKey(correction.name) },
                    update: {},
                });
                const key = { documentId: document.id, hopkinsAffiliateId: person.id, role: 'interlocutor' };
                const data = {
                    source: 'manual', evidence: correction.evidence,
                    note: `Speaker identity confirmed by the user for these minutes: ${correction.label} is ${correction.name}.`,
                };
                await tx.documentContributor.upsert({
                    where: { documentId_hopkinsAffiliateId_role: key },
                    create: { ...key, ...data }, update: data,
                });
            }
        });
        const saved = await prisma.documentContributor.findMany({
            where: { documentId: document.id, role: 'interlocutor',
                hopkinsAffiliate: { nameKey: { in: corrections.map(c => nameKey(c.name)) } } },
            select: { source: true, hopkinsAffiliate: { select: { name: true } } },
        });
        if (saved.length !== corrections.length || saved.some(row => row.source !== 'manual')) {
            throw new Error('Saved speaker corrections failed verification');
        }
        console.log('Verified saved speakers:', JSON.stringify(saved));
    } finally {
        await prisma.$disconnect();
    }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
export {};
