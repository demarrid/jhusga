/** node --env-file=.env --import tsx scripts/correct-student-council-constitution.ts [--apply]
 *
 * "Constitution of the Student Council of the Johns Hopkins University" is
 * transcribed from photos of a small booklet. The first photos also caught a
 * later constitution lying behind it (the "We, the Undergraduate Students"
 * preamble, the Undergraduate's Code, a President / Vice President / Secretary
 * council), and the transcription opens with that text. It is cut here, so the
 * document starts at the booklet's own "Constitution of the / STUDENT COUNCIL".
 *
 * The AI dated it 1921 from nothing in the text. The booklet admits students
 * "in the first or second year of the New Plan" (Goodnow's plan, mid-1920s),
 * so it is dated c. 1925–1935 (config/archive-date-precision.json) and sorted
 * at 1925.
 */
import { createHash } from 'node:crypto';
import { prisma } from '../lib/prisma';
import { recordDocumentVersion } from '../lib/document-version-history';
import { indexDocumentPassages } from '../lib/search';
import { reanchorDocument } from '../lib/sync';
import { documentDateSourceHash } from '../lib/document-date-ai';

const ID = 'd1ad093e-570c-4281-8870-82da5bc88d21';
const BOOKLET_START = /^# Constitution of the\s*\n+# STUDENT COUNCIL/m;
const DATED = '1925';

async function main() {
    const document = await prisma.document.findUniqueOrThrow({ where: { id: ID } });
    const match = BOOKLET_START.exec(document.content);
    let content = document.content;
    if (match && match.index > 0) {
        const before = document.content.slice(0, match.index);
        if (!before.includes('We, the Undergraduate Students')) throw new Error('Unexpected text before the booklet; review required');
        content = document.content.slice(match.index);
    } else if (!match) throw new Error('Booklet heading not found');
    const hash = createHash('sha256').update(content).digest('hex');
    const sourceHash = documentDateSourceHash({ ...document, content });
    console.log(JSON.stringify({ removedChars: document.content.length - content.length, opening: content.slice(0, 80), datedAt: DATED }, null, 2));
    if (!process.argv.includes('--apply')) return;

    await prisma.$transaction(async tx => {
        const data = { datedAt: new Date(`${DATED}-01-01T12:00:00Z`), aiDateValue: DATED, aiDateSourceHash: sourceHash };
        if (document.contentHash !== hash) {
            const updated = await tx.document.updateMany({ where: { id: ID, contentHash: document.contentHash }, data: { ...data, content, contentHash: hash } });
            if (updated.count !== 1) throw new Error('Document changed during correction');
            const revision = await tx.documentRevision.upsert({
                where: { documentId_contentHash: { documentId: ID, contentHash: hash } },
                create: { documentId: ID, title: document.title, content, contentHash: hash }, update: {},
            });
            await recordDocumentVersion(tx, revision.id, null, 'published');
            await tx.documentSummary.updateMany({ where: { documentId: ID, status: { in: ['fresh', 'empty'] } }, data: { status: 'stale' } });
        } else {
            await tx.document.update({ where: { id: ID }, data });
        }
    });
    await reanchorDocument(ID, content);
    await indexDocumentPassages(ID, content);
    console.log('Corrected.');
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
