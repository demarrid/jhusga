/** node --env-file=.env --import tsx scripts/correct-johnalys-ferrer-doc.ts [--apply]
 *
 * The 9/9/25 Senate minutes appoint "Jo" Director of Communications after
 * "President Vishnu introduced Johnalyse." The parser credits neither form, so
 * the appointment is never linked to Johnalys Ferrer, whom the 10/28/25 Senate
 * agenda lists as "Director of Communications - Johnalys Ferrer". A manual
 * credit survives later syncs (lib/sync.ts keeps `manual` rows). "Jo" is not
 * made an alias: the directory has other people named Jo.
 */
import { prisma } from '../lib/prisma';
import { nameKey } from '../lib/contributors';

const MINUTES_TITLE = 'Minutes of Senate GBM #5';
const MINUTES_DATE = '2025-09-09';
const EVIDENCE = 'Voting for appointing Jo as DoC was passed in favor.';
const ROLE = 'confirmed';

async function main() {
    const person = await prisma.hopkinsAffiliate.findUnique({ where: { nameKey: nameKey('Johnalys Ferrer') } });
    if (!person) throw new Error('Johnalys Ferrer not found');
    const minutes = await prisma.document.findMany({
        where: { title: MINUTES_TITLE, datedAt: { gte: new Date(`${MINUTES_DATE}T00:00:00Z`), lt: new Date(`${MINUTES_DATE}T23:59:59Z`) } },
        select: { id: true, title: true, content: true },
    });
    if (minutes.length !== 1) throw new Error(`Expected one ${MINUTES_TITLE} on ${MINUTES_DATE}, found ${minutes.length}`);
    const document = minutes[0]!;
    if (!document.content.includes(EVIDENCE) || !document.content.includes('introduced Johnalyse')) throw new Error('Evidence not in the minutes; review required');

    const existing = await prisma.documentContributor.findUnique({
        where: { documentId_hopkinsAffiliateId_role: { documentId: document.id, hopkinsAffiliateId: person.id, role: ROLE } },
    });
    console.log(JSON.stringify({ person: person.name, document: document.title, documentId: document.id, role: ROLE, evidence: EVIDENCE, existing: existing?.source ?? null }, null, 2));
    if (!process.argv.includes('--apply')) return;
    if (existing) {
        console.log('Credit already present.');
        return;
    }
    await prisma.documentContributor.create({
        data: { documentId: document.id, hopkinsAffiliateId: person.id, role: ROLE, source: 'manual', evidence: EVIDENCE },
    });
    const check = await prisma.documentContributor.count({ where: { documentId: document.id, hopkinsAffiliateId: person.id, role: ROLE, source: 'manual' } });
    if (check !== 1) throw new Error('Credit not recorded');
    console.log('Credited Johnalys Ferrer on the 9/9/25 minutes.');
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
