/** Apply the user-approved, source-backed corrections atomically.
 * node --env-file=.env --import tsx scripts/correct-reported-document-people.ts [--apply] [--remove-enactment]
 */
import { prisma } from '../lib/prisma';
import { extractContributors, nameKey } from '../lib/contributors';

const agoraId = 'e1e7c174-5453-4a5e-917c-08945d29955e';
const billId = '3a1ac9c4-738c-4c58-998c-9618fdb142b6';
const civicId = 'fa063347-8739-47a7-9ea2-39932d740617';
const falsePersonId = '744438cc-c0bd-43aa-82df-28f321e31289';
const participants = ['Sumire Sumi', 'Shreemann Patel', 'Honora Muratori', 'Jazzlyn Fernandez', 'Peter Tarpley', 'Jackson Morris', 'Sophia Baleeiro', 'Rain Cheng', 'Demarri Dosunmu', 'Ruth Braunstein', 'Sheri Butarazzi'];
const enactmentOnlyNames = ['Jason Yu', 'Sumire Sumi', 'Jazzlyn Fernandez', 'Honora Muratori', 'Amy Xu', 'Grace Guan'];

async function removeEnactmentMentions() {
    const where = {
        documentId: billId, role: 'mentioned', source: 'manual',
        note: 'Source-backed correction approved by the user. Printed participant and enactment lists establish mentions, not authorship, signatures, or adoption.',
        hopkinsAffiliate: { name: { in: enactmentOnlyNames } },
    };
    await prisma.$transaction(async tx => {
        const rows = await tx.documentContributor.findMany({ where, include: { hopkinsAffiliate: true } });
        for (const row of rows) {
            if (!row.evidence?.startsWith(`${row.hopkinsAffiliate.name} — Student Body`) && !row.evidence?.startsWith(`${row.hopkinsAffiliate.name} — President of the Senate`)) throw new Error('Unexpected evidence; refusing removal');
        }
        console.log('Enactment-only mentions:', rows.map(row => row.hopkinsAffiliate.name));
        if (!process.argv.includes('--apply')) return;
        await tx.documentContributor.deleteMany({ where: { ...where, id: { in: rows.map(row => row.id) } } });
        const saved = await tx.documentContributor.findMany({ where: { documentId: billId }, include: { hopkinsAffiliate: true } });
        for (const [name, role] of [['Peter Tarpley', 'introducer'], ['Shreemann Patel', 'sponsor'], ['Kayla Marie Gonzalez', 'sponsor']]) {
            if (!saved.some(row => row.hopkinsAffiliate.name === name && row.role === role)) throw new Error(`Missing credit: ${name}`);
        }
        if (saved.some(row => rows.some(removed => removed.id === row.id))) throw new Error('Enactment mention remains');
        console.log(`Removed ${rows.length} enactment-only mentions. Verified introducer and sponsors.`);
    });
    console.log('Saved bill credits:', await prisma.documentContributor.findMany({ where: { documentId: billId }, select: { role: true, hopkinsAffiliate: { select: { name: true } } } }));
}

async function main() {
    if (process.argv.includes('--remove-enactment')) return removeEnactmentMentions();
    const documents = await prisma.document.findMany({ where: { id: { in: [agoraId, billId, civicId] } } });
    if (documents.length !== 3) throw new Error('Missing reported documents');
    const additions: { documentId: string; name: string; role: string; evidence: string }[] = [];
    for (const document of documents) {
        const parsed = extractContributors(document.content, document.title, document.kind);
        const expected = document.id === agoraId ? participants.map(name => ({ name, role: 'mentioned' })) : document.id === billId ? [
            { name: 'Peter Tarpley', role: 'introducer' },
        ] : [];
        for (const person of expected) {
            const match = parsed.find(row => row.name === person.name && row.role === person.role);
            if (!match) throw new Error(`Missing archived evidence: ${person.name}`);
            additions.push({ documentId: document.id, ...person, evidence: match.evidence });
        }
        if (document.id === agoraId) {
            // These shorthand labels are corroborated by this document's participant list.
            const speakers: Record<string, string> = { Braunstein: 'Ruth Braunstein', Demarri: 'Demarri Dosunmu', Sophia: 'Sophia Baleeiro', Jackson: 'Jackson Morris', Jazz: 'Jazzlyn Fernandez' };
            for (const [label, name] of Object.entries(speakers)) {
                const match = parsed.find(row => row.name === label && row.role === 'interlocutor');
                if (!match) throw new Error(`Missing speaker evidence: ${label}`);
                additions.push({ documentId: document.id, name, role: 'interlocutor', evidence: match.evidence });
            }
        }
    }
    const falseRows = await prisma.documentContributor.findMany({ where: { documentId: civicId, hopkinsAffiliateId: falsePersonId }, include: { hopkinsAffiliate: true } });
    if (falseRows.some(row => row.hopkinsAffiliate.name !== 'Time Change' || row.source !== 'parsed' || !row.evidence?.includes('conflict w/time change, counted as present'))) throw new Error('Unexpected false-identity evidence');
    console.log(JSON.stringify({ additions, remove: falseRows.map(row => ({ id: row.id, evidence: row.evidence })) }, null, 2));
    if (!process.argv.includes('--apply')) return;
    await prisma.$transaction(async tx => {
        // Refuse to apply a plan if the archive changed after the evidence was read.
        for (const document of documents) {
            const current = await tx.document.findUniqueOrThrow({ where: { id: document.id }, select: { content: true } });
            if (current.content !== document.content) throw new Error('Document changed; re-run the preview');
        }
        for (const addition of additions) {
            const person = await tx.hopkinsAffiliate.upsert({ where: { nameKey: nameKey(addition.name) }, create: { name: addition.name, nameKey: nameKey(addition.name) }, update: {} });
            const key = { documentId: addition.documentId, hopkinsAffiliateId: person.id, role: addition.role };
            const data = { source: 'manual', evidence: addition.evidence, note: 'Source-backed correction approved by the user. Printed participant lists establish mentions, not authorship or attendance.' };
            await tx.documentContributor.upsert({ where: { documentId_hopkinsAffiliateId_role: key }, create: { ...key, ...data }, update: data });
        }
        await tx.documentContributor.deleteMany({ where: { id: { in: falseRows.map(row => row.id) }, documentId: civicId, hopkinsAffiliateId: falsePersonId, source: 'parsed' } });
        await tx.hopkinsAffiliate.deleteMany({ where: { id: falsePersonId, name: 'Time Change', contributions: { none: {} }, hopkinsRelationships: { none: {} }, reviewedAdministrator: { is: null }, userId: null, email: null } });
        const saved = await tx.documentContributor.findMany({ where: { documentId: { in: [agoraId, billId, civicId] } }, include: { hopkinsAffiliate: true } });
        for (const addition of additions) {
            if (!saved.some(row => row.documentId === addition.documentId && row.hopkinsAffiliate.nameKey === nameKey(addition.name) && row.role === addition.role && row.evidence === addition.evidence)) throw new Error(`Verification failed: ${addition.name}`);
        }
        if (saved.some(row => row.hopkinsAffiliateId === falsePersonId)) throw new Error('False person remains');
    }, { timeout: 30000 });
    const saved = await prisma.documentContributor.findMany({ where: { documentId: { in: [agoraId, billId, civicId] } }, include: { hopkinsAffiliate: { select: { name: true } } } });
    console.log('Committed and read back:', JSON.stringify(saved.map(row => ({ documentId: row.documentId, name: row.hopkinsAffiliate.name, role: row.role })), null, 2));
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
