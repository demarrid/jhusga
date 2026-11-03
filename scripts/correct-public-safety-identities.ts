/** Reviewed public-safety identities in the October 6 Senate minutes.
 * npx tsx scripts/correct-public-safety-identities.ts [--apply]
 * Keeps the source transcript intact and records document-specific manual credits.
 */
process.loadEnvFile('.env');

async function main() {
    const { prisma } = await import('../lib/prisma');
    const { nameKey } = await import('../lib/contributors');
    try {
        const document = await prisma.document.findUniqueOrThrow({
            where: { driveFileId: '1NFlclYdOc1-NAud4H1bjvWTnFh_JK2XJycIo0tlbnIE' },
            select: { id: true, content: true },
        });
        const lines = document.content.split(/\r?\n/);
        const line = (prefix: string) => {
            const found = lines.filter(text => text.startsWith(prefix));
            if (found.length !== 1) throw new Error(`Expected one archived passage for ${prefix}`);
            return found[0]!;
        };
        const leadership = 'https://publicsafety.jhu.edu/community-safety/johns-hopkins-police-department/meet-the-jhpd-team/';
        const corrections = [
            {
                name: 'Calvin L. Smith Jr.', role: 'interlocutor',
                evidence: line('Calvin Smith: Good evening, everyone.'),
                note: 'Reviewed identity: Calvin L. Smith, Jr., MBA; Deputy Chief of Staff for Public Safety. Full name supplied by archive maintainer: https://www.linkedin.com/in/calvin-l-smith-jr-mba-a4a5149/ . Role corroborated by https://hub.jhu.edu/2025/06/23/indispensable-role-of-blacks-2025-inductees/',
            },
            {
                name: 'Branville G. Bard Jr.', role: 'mentioned',
                evidence: line('Calvin Smith: Good evening, everyone.'),
                note: `Reviewed identity: Chief of Police / Vice President for Public Safety. Mentioned as absent, not a speaker. Source: ${leadership}`,
            },
            {
                name: 'Jarron Jackson', role: 'interlocutor',
                evidence: line('Jackson: Thank you for the opportunity to speak with you.'),
                note: 'Reviewed identity: the public-safety colleague introduced by Calvin Smith immediately before this turn. The archive calls him Assistant Vice President; the current directory says Associate Vice President for JHU Public Safety. Source: https://publicsafety.jhu.edu/community-safety/behavioral-health-crisis-support-team/meet-the-behavioral-health-crisis-support-team/',
            },
            {
                name: 'Quovella M. Maeweather', role: 'interlocutor',
                evidence: line('Quovella M. Maeweather (Deputy Chief for Support Services):'),
                note: `Reviewed identity: Deputy Chief for Support Services. Source: ${leadership}`,
            },
            {
                name: 'Jackson Morris', role: 'interlocutor',
                evidence: line("Jackson: Hello. Uh, so, I won't belabor the point."),
                note: 'Reviewed speaker distinction: the Disability Caucus senator and Civic Engagement chair speaking later in the meeting, not the public-safety presenter Jarron Jackson.',
            },
        ];
        console.log(JSON.stringify(corrections.map(({ name, role, evidence }) => ({ name, role, evidence })), null, 2));
        if (!process.argv.includes('--apply')) return;
        await prisma.$transaction(async tx => {
            for (const correction of corrections) {
                const person = await tx.hopkinsAffiliate.upsert({
                    where: { nameKey: nameKey(correction.name) },
                    create: { name: correction.name, nameKey: nameKey(correction.name) }, update: {},
                });
                await tx.documentContributor.upsert({
                    where: { documentId_hopkinsAffiliateId_role: { documentId: document.id, hopkinsAffiliateId: person.id, role: correction.role } },
                    create: { documentId: document.id, hopkinsAffiliateId: person.id, role: correction.role, source: 'manual', evidence: correction.evidence, note: correction.note },
                    update: { source: 'manual', evidence: correction.evidence, note: correction.note },
                });
                if (correction.name === 'Calvin L. Smith Jr.') {
                    await tx.hopkinsAlias.upsert({ where: { aliasKey: nameKey('Calvin Smith') },
                        create: { alias: 'Calvin Smith', aliasKey: nameKey('Calvin Smith'), hopkinsAffiliateId: person.id, source: 'manual' },
                        update: { hopkinsAffiliateId: person.id, source: 'manual' },
                    });
                    await tx.documentContributor.deleteMany({ where: {
                        documentId: document.id, source: 'parsed', hopkinsAffiliate: { nameKey: nameKey('Calvin Smith') },
                    } });
                }
            }
        });
        const saved = await prisma.documentContributor.findMany({
            where: { documentId: document.id, hopkinsAffiliate: { nameKey: { in: corrections.map(c => nameKey(c.name)) } } },
            select: { role: true, source: true, evidence: true, hopkinsAffiliate: { select: { name: true } } },
        });
        if (saved.length !== corrections.length || saved.some(row => row.source !== 'manual')) throw new Error('Saved corrections failed verification');
        console.log('Verified saved corrections:', JSON.stringify(saved, null, 2));
    } finally { await prisma.$disconnect(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });

export {};
