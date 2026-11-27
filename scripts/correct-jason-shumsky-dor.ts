/** node --env-file=.env --import tsx scripts/correct-jason-shumsky-dor.ts [--apply]
 *
 * The 9/9/25 Senate minutes record "The voting for appointing Jason as DoR was
 * passed in favor." The parser credits that line to Jason Yu, then a Sophomore
 * Class Senator. The Director of Research was Jason Shumsky: he held the office
 * in 2023-24 (every 111th-session agenda: "Director of Research - Director
 * Jason Shumsky"), was reappointed on 4/23/24 ("He served in this position in
 * the last SGA, too"), and is in the executive section of the 2025-2026
 * attendance sheet. This moves the credit: the parsed Jason Yu row is deleted
 * (backed up first) and a manual Jason Shumsky row, which later syncs keep
 * (lib/sync.ts keeps `manual` rows), takes its place.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { prisma } from '../lib/prisma';
import { nameKey } from '../lib/contributors';

const MINUTES_TITLE = 'Minutes of Senate GBM #5';
const MINUTES_DATE = '2025-09-09';
const EVIDENCE = '2. The voting for appointing Jason as DoR was passed in favor.';
const ROLE = 'confirmed';

async function main() {
    const [wrong, right] = await Promise.all(['Jason Yu', 'Jason Shumsky'].map(name =>
        prisma.hopkinsAffiliate.findUnique({ where: { nameKey: nameKey(name) } })));
    if (!wrong || !right) throw new Error('Jason Yu or Jason Shumsky not found');
    const minutes = await prisma.document.findMany({
        where: { title: MINUTES_TITLE, datedAt: { gte: new Date(`${MINUTES_DATE}T00:00:00Z`), lt: new Date(`${MINUTES_DATE}T23:59:59Z`) } },
        select: { id: true, title: true, content: true },
    });
    if (minutes.length !== 1) throw new Error(`Expected one ${MINUTES_TITLE} on ${MINUTES_DATE}, found ${minutes.length}`);
    const document = minutes[0]!;
    if (!document.content.includes(EVIDENCE.replace(/^2\. /, ''))) throw new Error('Evidence not in the minutes; review required');

    const parsed = await prisma.documentContributor.findUnique({
        where: { documentId_hopkinsAffiliateId_role: { documentId: document.id, hopkinsAffiliateId: wrong.id, role: ROLE } },
    });
    if (parsed && (parsed.source !== 'parsed' || !/appointing Jason as DoR/.test(parsed.evidence))) {
        throw new Error('Jason Yu has a different credit on these minutes; review required');
    }
    const existing = await prisma.documentContributor.findUnique({
        where: { documentId_hopkinsAffiliateId_role: { documentId: document.id, hopkinsAffiliateId: right.id, role: ROLE } },
    });
    console.log(JSON.stringify({
        document: document.title, documentId: document.id, role: ROLE,
        remove: parsed ? { person: wrong.name, source: parsed.source, evidence: parsed.evidence } : null,
        add: existing ? null : { person: right.name, source: 'manual', evidence: EVIDENCE },
    }, null, 2));
    if (!process.argv.includes('--apply')) return;

    if (parsed) {
        await mkdir('.archive-local', { recursive: true });
        await writeFile('.archive-local/jason-shumsky-dor-correction-backup.json', JSON.stringify(parsed, null, 2));
    }
    await prisma.$transaction(async tx => {
        if (parsed) await tx.documentContributor.delete({ where: { id: parsed.id } });
        if (!existing) {
            await tx.documentContributor.create({
                data: { documentId: document.id, hopkinsAffiliateId: right.id, role: ROLE, source: 'manual', evidence: EVIDENCE },
            });
        }
    });
    const [left, added] = await Promise.all([
        prisma.documentContributor.count({ where: { documentId: document.id, hopkinsAffiliateId: wrong.id, role: ROLE } }),
        prisma.documentContributor.count({ where: { documentId: document.id, hopkinsAffiliateId: right.id, role: ROLE } }),
    ]);
    if (left !== 0 || added !== 1) throw new Error('Credit not moved');
    console.log('Moved the 9/9/25 Director of Research appointment credit from Jason Yu to Jason Shumsky.');
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
