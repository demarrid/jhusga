import assert from 'node:assert/strict';
import { recordContributors } from '../lib/sync';

let identityWrites = 0;
let creditWrites = 0;
(globalThis as unknown as { prisma: unknown }).prisma = {
    document: { async findUnique() { return { kind: 'minutes.senate', title: 'Senate minutes', folderPath: '', sessionNumber: 114, datedAt: null }; } },
    personMentionReview: { async findUnique() { throw new Error('Validation cache unavailable'); } },
    hopkinsAffiliate: { async upsert() { identityWrites++; }, async create() { identityWrites++; } },
    documentContributor: { async deleteMany() { creditWrites++; }, async upsert() { creditWrites++; } },
};
async function main() {
    await assert.rejects(recordContributors('test-document', 'Present: Oluwanifemi Ajayi'), /Validation cache unavailable/);
    assert.equal(identityWrites, 0, 'validation failure must not create identities');
    assert.equal(creditWrites, 0, 'validation failure must not erase or replace existing credits');
    console.log('Contributor publication gate checks passed.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
