import assert from 'node:assert/strict';
import { parsePersonDecisions, validatePersonMentions, type PersonValidationServices } from '../lib/person-validation';
import { canonicalPersonName } from '../lib/names';

async function main() {
    const cache = new Map<string, { decisions: ReturnType<typeof parsePersonDecisions>; model: string }>();
    let calls = 0;
    const dependencies: PersonValidationServices = {
        async load(key) { return cache.get(key) ?? null; },
        async save(key, value) { cache.set(key, value); },
        async generate(input) {
            calls++;
            const data = JSON.parse(input);
            assert(data.candidates.every((row: { context: string }) => row.context.includes('Retreat')));
            return { model: 'test', value: { decisions: data.candidates.map((row: { index: number; name: string }) => ({
                index: row.index, verdict: row.name === 'Oluwanifemi Ajayi' ? 'person' : row.name === 'Unclear' ? 'uncertain' : 'not_person', reason: 'Source context',
            })) } };
        },
    };
    const candidates = [
        { name: 'Freshmen Help Guide', evidence: "Freshmen Help Guide (Dean Wendland and Schlesinger's Concept)" },
        { name: 'To Be Announced', evidence: 'Freshman Class President — To Be Announced' },
        { name: 'Oluwanifemi Ajayi', evidence: 'Present: Oluwanifemi Ajayi' },
        { name: 'Unclear', evidence: 'Unclear' },
    ];
    const context = { title: 'Retreat', content: `Retreat\n${candidates.map(row => row.evidence).join('\n')}` };
    assert.deepEqual(await validatePersonMentions(candidates, context, dependencies), [candidates[2]]);
    assert.equal(calls, 1);
    await validatePersonMentions(candidates, context, dependencies);
    assert.equal(calls, 1, 'unchanged context uses cache');
    await validatePersonMentions(candidates, { ...context, content: `${context.content}\nChanged nearby evidence` }, dependencies);
    assert.equal(calls, 2, 'changed evidence must be reviewed again');
    assert.deepEqual(await validatePersonMentions([], context, dependencies), []);
    assert.equal(calls, 2, 'no candidates need no AI');
    for (const response of [null, [], [{ index: 0, verdict: 'person', reason: 'ok' }],
        [{ index: 0, verdict: 'person', reason: 'ok' }, { index: 0, verdict: 'person', reason: 'duplicate' }],
        [{ index: 0, verdict: 'person', reason: 'ok' }, { index: 2, verdict: 'person', reason: 'invented' }],
        [{ index: 0, verdict: 'yes', reason: 'ok' }, { index: 1, verdict: 'person', reason: '' }]]) {
        assert.throws(() => parsePersonDecisions(response, 2));
    }
    await assert.rejects(validatePersonMentions(candidates, context, { ...dependencies,
        async load() { return null; }, async generate() { throw new Error('API unavailable'); },
    }), /API unavailable/);
    await assert.rejects(validatePersonMentions(candidates, context, { ...dependencies,
        async load() { return null; }, async generate() { return { model: 'test', value: { decisions: [] } }; },
        async save() { assert.fail('invalid responses cannot be cached'); },
    }), /Incomplete/);
    const many = Array.from({ length: 65 }, () => candidates[2]);
    assert.equal((await validatePersonMentions(many, context, dependencies)).length, 65);
    assert.equal(canonicalPersonName('Nifemi Ajayi'), 'Oluwanifemi Ajayi');
    assert.equal(canonicalPersonName('Nifemi Akinwale'), 'Nifemi Akinwale', 'do not merge by first name alone');
    console.log('Person validation checks passed.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
