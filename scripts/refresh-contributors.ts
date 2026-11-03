/** Refresh derived people for explicitly selected archive documents.
 * Preview: npx tsx scripts/refresh-contributors.ts <document-id> ...
 * Apply:   npx tsx scripts/refresh-contributors.ts --apply <document-id> ...
 */
process.loadEnvFile('.env');

async function main() {
    const args = process.argv.slice(2);
    const apply = args.includes('--apply');
    const ids = [...new Set(args.filter(arg => arg !== '--apply'))];
    if (!ids.length || ids.some(id => !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id))) {
        throw new Error('Supply one or more document UUIDs, optionally with --apply.');
    }
    const { prisma } = await import('../lib/prisma');
    try {
        const { extractContributors } = await import('../lib/contributors');
        const { matchAccount } = await import('../lib/accounts');
        const documents = await prisma.document.findMany({ where: { id: { in: ids } } });
        if (documents.length !== ids.length) throw new Error('Some requested documents do not exist; no changes made.');
        const people = await prisma.hopkinsAffiliate.findMany({ select: { id: true, name: true } });
        for (const document of documents) {
            const parsed = extractContributors(document.content, document.title, document.kind);
            const owner = matchAccount({ email: document.driveOwnerEmail, displayName: document.driveOwnerName }, people);
            console.log(`${document.id}: ${document.title}`);
            console.log(JSON.stringify({ parsed: parsed.map(({ name, role }) => ({ name, role })), owner: owner?.person.name ?? null }));
        }
        if (!apply) return;
        const { recordContributors, recordDriveAccounts } = await import('../lib/sync');
        for (const document of documents) {
            await recordContributors(document.id, document.content);
        }
        await recordDriveAccounts(ids);
        for (const document of documents) {
            const rows = await prisma.documentContributor.findMany({
                where: { documentId: document.id },
                select: { role: true, hopkinsAffiliate: { select: { name: true } } },
            });
            console.log(`Saved ${document.title}: ${JSON.stringify(rows)}`);
        }
    } finally {
        await prisma.$disconnect();
    }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
