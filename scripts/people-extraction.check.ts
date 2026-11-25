import assert from 'node:assert/strict';
import { extractDocumentPeople, parseExtractedPeople, peopleChunks, peopleFingerprint } from '../lib/people-extraction';
import { documentPeople } from '../lib/people-extraction-cache';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

async function main() {
    const document = { title: 'Working notes', kind: 'notes.meeting', content: 'We consulted Oluwanifemi Ajayi about the proposal.\nRain: I can help.' };
    const person = { name: 'Oluwanifemi Ajayi', role: 'mentioned', evidence: 'We consulted Oluwanifemi Ajayi about the proposal.' };
    const parsed = parseExtractedPeople({ people: [person, { name: 'Rain', role: 'interlocutor', evidence: 'Rain: I can help.' }] }, document.content);
    assert.equal(parsed[0].onlyIfKnown, false);
    assert.equal(parsed[1].onlyIfKnown, true, 'first names must resolve conservatively');
    for (const value of [null, {}, { people: [null] }, { people: [{ ...person, name: 'Invented Name' }] },
        { people: [{ ...person, role: 'author' }] }, { people: [{ ...person, evidence: 'Invented quote' }] }]) {
        assert.throws(() => parseExtractedPeople(value, document.content));
    }
    assert.deepEqual(parseExtractedPeople({ people: [] }, document.content), []);
    const long = document.content + 'x'.repeat(45000) + '\nZainab Ali reviewed this.';
    const chunks = peopleChunks(long);
    assert.equal(chunks.length, 3);
    assert.equal(chunks[0] + chunks.slice(1).map(chunk => chunk.slice(1000)).join(''), long, 'every character is covered');
    let calls = 0;
    const extracted = await extractDocumentPeople({ ...document, content: long }, async input => {
        calls++;
        const { content } = JSON.parse(input);
        return { model: 'test', value: { people: content.includes(person.evidence) ? [person] : [] } };
    });
    assert.equal(calls, 3);
    assert.equal(extracted.people.length, 1);
    assert.notEqual(peopleFingerprint(document), peopleFingerprint({ ...document, content: long }));
    assert.notEqual(peopleFingerprint(document), peopleFingerprint({ ...document, kind: 'agenda' }));

    let cache: Record<string, unknown> | null = null;
    Object.assign(globalThis, { prisma: { documentPeopleExtraction: {
        async findUnique() { return cache; },
        async upsert({ create, update }: { create: Record<string, unknown>; update: Record<string, unknown> }) {
            cache = cache ? { ...cache, ...update } : create;
        },
    } } });
    let extractions = 0;
    const extract = async () => { extractions++; return { people: parsed, model: 'test' }; };
    await documentPeople('fixture', document, extract);
    assert.equal((cache as unknown as { appliedAt: unknown }).appliedAt, null, 'extraction alone is not successful publication');
    await documentPeople('fixture', document, extract);
    assert.equal(extractions, 1, 'retries reuse extraction before successful linking');
    await documentPeople('fixture', { ...document, title: 'Updated title' }, extract);
    assert.equal(extractions, 2);
    const beforeFailure = cache;
    await assert.rejects(documentPeople('fixture', { ...document, content: long }, async () => { throw new Error('Model failed'); }), /Model failed/);
    assert.equal(cache, beforeFailure, 'failed generations cannot be cached as success');
    await assert.rejects(extractDocumentPeople({ ...document, content: long }, async () => ({ model: 'test', value: {} })), /Invalid/);
    const db = new PGlite();
    try {
        await db.exec('CREATE TABLE "Document" ("id" TEXT PRIMARY KEY);');
        await db.exec(await readFile('prisma/migrations/20261125010000_document_people_extraction/migration.sql', 'utf8'));
        await db.query('INSERT INTO "Document" ("id") VALUES ($1)', ['fixture']);
        await db.query(`INSERT INTO "DocumentPeopleExtraction" ("documentId", "fingerprint", "promptVersion", "model", "people", "updatedAt")
            VALUES ($1, $2, $3, $4, $5, NOW())`, ['fixture', 'hash', 'v1', 'test', JSON.stringify(parsed)]);
        const result = await db.query<{ appliedAt: unknown }>('SELECT "appliedAt" FROM "DocumentPeopleExtraction"');
        assert.equal(result.rows[0].appliedAt, null);
        await db.query('DELETE FROM "Document" WHERE "id" = $1', ['fixture']);
        assert.equal((await db.query('SELECT * FROM "DocumentPeopleExtraction"')).rows.length, 0, 'document deletion removes extraction cache');
    } finally { await db.close(); }
    console.log('Document people extraction checks passed.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
