import assert from 'node:assert/strict';
import { extractContributors } from '../lib/contributors';
import { renderDocument, runsText } from '../lib/render';
const planning = extractContributors('Planners: Abraham and Mahima\n\nAdditional Insight: Sumi, members of FSL', 'Sexual Violence Task Force Brainstorm Doc', 'tracker');
assert.deepEqual(planning.filter(p => p.role === 'mentioned').map(p => [p.name, p.role, p.onlyIfKnown]), [
    ['Abraham', 'mentioned', true], ['Mahima', 'mentioned', true], ['Sumi', 'mentioned', true],
]);
const report = 'TEN FOR ON E :\nA framework for building One University through 2030\n\nIntroduction | 01\nI NTRODUCTION\nTen years ago, Johns Hopkins University published the Ten by Twenty, an institution-\nwide strategic framework born of an extensive consultative process.\nGuided by the aspirations of the Ten by Twenty, we accomplished extraordinary things.\n\nIntroduction | 02\nWe continued to forge an identity as One University,\nbuilding on our founding mission of research\nand discovery.';
const quote = 'building on our founding mission of research\nand discovery';
const blocks = renderDocument(report, [{ id: 'report-quote', startOffset: report.indexOf(quote), endOffset: report.indexOf(quote) + quote.length }]);
assert.equal(blocks.filter(b => b.kind === 'heading').length, 4);
assert.equal(blocks.filter(b => b.kind === 'paragraph').length, 4);
const runs = blocks.flatMap(b => 'runs' in b ? b.runs : []);
assert(!runsText(runs).includes('\n'));
assert.equal(runs.filter(r => r.annotationId === 'report-quote' && r.anchor).length, 1);
assert.equal(runsText(runs.filter(r => r.annotationId === 'report-quote')), quote.replace(/\n/g, ' '));
assert.equal(runsText(runs).replace(/\s/g, ''), report.replace(/\s/g, ''), 'Keep all source words');
const ordinary = renderDocument('First authored line\nSecond authored line', []);
assert.equal(ordinary[0].kind, 'paragraph');
assert('runs' in ordinary[0] && runsText(ordinary[0].runs).includes('\n'));
console.log('Reported framework readability, citations, and planning mentions passed');

