import assert from 'node:assert/strict';
import { extractDocumentPeople, parseExtractedPeople, peopleChunks, peopleFingerprint } from '../lib/people-extraction';
import { documentPeople } from '../lib/people-extraction-cache';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { logPeopleRejections, type PeopleRejection } from '../lib/people-rejections';
import { PGlite } from '@electric-sql/pglite';

async function main() {
    const document = { title: 'Working notes', kind: 'notes.meeting', content: 'We consulted Oluwanifemi Ajayi about the proposal.\nRain: I can help.' };
    const person = { name: 'Oluwanifemi Ajayi', role: 'mentioned', evidence: 'We consulted Oluwanifemi Ajayi about the proposal.' };
    const parsed = parseExtractedPeople({ people: [person, { name: 'Rain', role: 'interlocutor', evidence: 'Rain: I can help.' }] }, document.content);
    assert.equal(parsed[0].onlyIfKnown, false);
    assert.equal(parsed[1].onlyIfKnown, true, 'first names must resolve conservatively');
    for (const value of [null, {}, { people: null }]) {
        assert.throws(() => parseExtractedPeople(value, document.content));
    }
    const rejected: PeopleRejection[] = [];
    const mixed = parseExtractedPeople({ people: [null, person, { ...person, name: 'Invented Name' },
        { ...person, role: 'author' }, { ...person, evidence: 'Invented quote' }, { ...person, name: '' },
        { ...person, evidence: '' }] }, document.content, row => rejected.push(row));
    assert.deepEqual(mixed, [parsed[0]], 'bad entries do not discard the valid person');
    assert.equal(rejected.length, 6);
    assert.deepEqual(rejected.map(row => row.reason), ['Candidate is not an object', 'Name is absent from the supporting quote',
        'Unsupported or missing role', 'Evidence is not an exact source quote', 'Missing or empty name', 'Missing or empty evidence']);
    const logs: PeopleRejection[] = [];
    const partial = await extractDocumentPeople({ ...document, id: 'fixture' }, async () => ({ model: 'test',
        value: { people: [person, { ...person, evidence: 'Made up' }] } }), async (context, entries) => {
        assert.equal(context.documentId, 'fixture');
        assert.equal(context.chunk, 1);
        logs.push(...entries);
    });
    assert.deepEqual(partial.people, [parsed[0]]);
    assert.equal(logs.length, 1);
    const directory = await mkdtemp(path.join(tmpdir(), 'people-rejections-'));
    try {
        const destination = path.join(directory, 'rejections.jsonl');
        const context = { documentId: 'fixture', title: document.title, chunk: 1, model: 'test' };
        await logPeopleRejections(context, rejected, destination);
        await logPeopleRejections(context, logs, destination);
        const rows = (await readFile(destination, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
        assert.equal(rows.length, 7, 'diagnostics append instead of overwriting');
        assert.equal(rows[0].documentId, 'fixture');
        assert.equal(rows[6].candidate.evidence, 'Made up');
        await logPeopleRejections(context, logs, directory); // unwritable destination must not fail extraction
    } finally { await rm(directory, { recursive: true, force: true }); }
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
