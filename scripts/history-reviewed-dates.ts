/** Apply researched dates without regenerating prose or changing citation IDs.
 * Preview: npx tsx scripts/history-reviewed-dates.ts; write: add --apply.
 */
import { reviewedFindingDate } from '../config/history-dates';
import { academicYearKey } from '../lib/history';
process.loadEnvFile('.env');
const eventIds = [
    'a74a369a-c550-4ab8-aa6a-c8d1e52706a4',
    '5ced2694-aa6f-472c-8c18-5b34ea392f46',
    'fae09ed6-aa29-448b-8052-d50462661eee',
    'bb5c1fdf-4c0e-4e04-911d-fb66149a278d',
    'c773267a-d30b-4317-8cdd-9a608d066bc9',
    'b25642ed-14d7-479a-9632-9ec06b8070c0',
];
async function main() {
    const { prisma } = await import('../lib/prisma');
    try {
        const events = await prisma.historyEvent.findMany({ where: { id: { in: eventIds } }, include: { citations: { include: { annotation: true } } } });
        if (events.length !== eventIds.length) throw new Error('Expected all six original events; review before proceeding.');
        const updates = events.map(event => {
            const reviewed = event.citations.map(c => reviewedFindingDate(c.annotation.documentId, c.annotation.content)).find(Boolean);
            if (!reviewed) throw new Error(`No reviewed date matched ${event.id}`);
            const occurredAt = new Date(reviewed.date);
            if (event.occurredAt && (event.occurredAt.getTime() !== occurredAt.getTime() || event.datePrecision !== reviewed.precision)) {
                throw new Error(`Event already has a different date: ${event.id}`);
            }
            return { id: event.id, title: event.title, data: {
                occurredAt, endedAt: null, datePrecision: reviewed.precision,
                batchKey: academicYearKey(occurredAt), batchHash: 'reviewed-six-dates-2026-11-21',
                content: event.content.includes(reviewed.note) ? event.content : `${event.content}\n\n${reviewed.note}`,
            } };
        });
        console.log(updates.map(({ id, title, data }) => ({ id, title, date: data.occurredAt, precision: data.datePrecision })));
        if (process.argv.includes('--apply')) {
            await prisma.$transaction(updates.map(({ id, data }) => prisma.historyEvent.update({ where: { id }, data })));
            console.log('Updated six events; preserved existing prose and citation IDs.');
        }
    } finally { await prisma.$disconnect(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
