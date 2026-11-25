import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { acceptedMinuteTitle, minuteTitleSourceHash, validateMinuteTitle } from '../lib/minute-title-ai';
import { standardTitles } from '../lib/titles';

async function main() {
    const source = { id: 'fixture', title: 'HSS notes 09_09_18', kind: 'minutes.committee', folderPath: 'Health, Safety and Sustainability',
        content: 'HSS Meeting #01\n09/09/18\nMinutes\nThe committee approved the agenda.', sessionNumber: null };
    const proposal = { title: 'Health, Safety and Sustainability Committee Meeting #01 — Minutes (09/09/18)',
        evidence: [source.folderPath, 'HSS Meeting #01', '09/09/18', 'Minutes'], reason: 'The header and proceedings establish the meeting.' };
    assert.equal(validateMinuteTitle(proposal, source).title, proposal.title);
    assert.equal(validateMinuteTitle({ title: null, evidence: [], reason: 'Unclear body' }, source).title, null);
    for (const value of [null, {}, { ...proposal, evidence: ['Invented source'] },
        { ...proposal, title: 'Meeting #99 — Minutes' }, { ...proposal, title: '<script>Minutes</script>' },
        { ...proposal, title: 'Meeting — Minutes', evidence: [] }]) {
        assert.throws(() => validateMinuteTitle(value, source));
    }
    const accepted = { ...source, aiNormalizedTitle: proposal.title, aiTitleSourceHash: minuteTitleSourceHash(source) };
    assert.equal(acceptedMinuteTitle(accepted), proposal.title);
    assert.equal(standardTitles([accepted]).get(source.id), proposal.title, 'normal sync preserves the accepted title');
    assert.equal(acceptedMinuteTitle({ ...accepted, content: 'Changed minutes' }), null);
    assert.equal(acceptedMinuteTitle({ ...accepted, title: 'Renamed source' }), null);
    assert.equal(acceptedMinuteTitle({ ...accepted, kind: 'report' }), null);
    const collision = standardTitles([accepted, { ...accepted, id: 'second' }]);
    assert.notEqual(collision.get(source.id), proposal.title, 'collisions never silently merge two document titles');
    const db = new PGlite();
    try {
        await db.exec('CREATE TABLE "Document" (id TEXT PRIMARY KEY); INSERT INTO "Document" VALUES (\'existing\');');
        await db.exec(await readFile('prisma/migrations/20261125020000_ai_minute_titles/migration.sql', 'utf8'));
        const result = await db.query<{ aiNormalizedTitle: string; aiTitleSourceHash: string }>('SELECT * FROM "Document"');
        assert.equal(result.rows[0].aiNormalizedTitle, '');
        assert.equal(result.rows[0].aiTitleSourceHash, '');
    } finally { await db.close(); }
    console.log('AI minute title validation, sync preservation, and migration checks passed.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
