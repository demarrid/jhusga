/** npm run people -- [--limit 20] [--session 114] [--document <id>] */
import path from 'node:path';

process.loadEnvFile(path.join(process.cwd(), '.env'));

async function main() {
    const args = process.argv.slice(2);
    const options = new Map<string, string>();
    for (let i = 0; i < args.length; i += 2) {
        if (!['--limit', '--session', '--document'].includes(args[i]) || !args[i + 1] || args[i + 1].startsWith('--')) {
            throw new Error('Usage: npm run people -- [--limit 20] [--session 114] [--document <id>]');
        }
        options.set(args[i], args[i + 1]);
    }
    const number = (flag: string) => {
        if (!options.has(flag)) return undefined;
        const value = Number(options.get(flag));
        if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${flag} needs a positive integer`);
        return value;
    };
    const limit = number('--limit') ?? Infinity;
    const sessionNumber = number('--session');
    const { prisma } = await import('../lib/prisma');
    const { recordContributors } = await import('../lib/sync');
    const { peopleFingerprint } = await import('../lib/people-extraction');
    let processed = 0, failed = 0, skipped = 0;
    try {
        const documents = await prisma.document.findMany({
            where: { id: options.get('--document'), sessionNumber },
            select: { id: true, title: true, kind: true, content: true, peopleExtraction: { select: { fingerprint: true, appliedAt: true } } },
            orderBy: { id: 'asc' },
        });
        if (options.has('--document') && !documents.length) throw new Error('Document not found in the selected scope');
        for (const document of documents) {
            if (document.peopleExtraction?.appliedAt && document.peopleExtraction.fingerprint === peopleFingerprint(document)) {
                skipped++;
                continue;
            }
            if (processed + failed >= limit) break;
            try {
                const count = await recordContributors(document.id, document.content);
                processed++;
                console.log(`processed ${document.id} ${document.title}: ${count} people links`);
            } catch (error) {
                failed++;
                console.error(`failed ${document.id} ${document.title}:`, error instanceof Error ? error.message : error);
            }
        }
        console.log(`${processed} processed; ${failed} failed; ${skipped} already current. Limit counts documents, not model calls.`);
        if (failed) process.exitCode = 1;
    } finally {
        await prisma.$disconnect();
    }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
