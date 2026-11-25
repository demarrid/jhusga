import assert from 'node:assert/strict';
import { parseDocumentQuery, documentQueryHighlights } from '../lib/document-query';
import { documentQueryFilter } from '../lib/document-query-filter';
import { documentSearchHref } from '../lib/document-navigation';
import { documentFindRank } from '../lib/document-find';

assert.deepEqual(parseDocumentQuery('"public safety" +training -draft OR policing AND accountability'), [
    [{ text: 'public safety', excluded: false }, { text: 'training', excluded: false }, { text: 'draft', excluded: true }],
    [{ text: 'policing', excluded: false }, { text: 'accountability', excluded: false }],
]);
assert.deepEqual(parseDocumentQuery('safety + training'), [[{ text: 'safety', excluded: false }, { text: 'training', excluded: false }]]);
assert.deepEqual(parseDocumentQuery('"OR" -"student fees"'), [[{ text: 'OR', excluded: false }, { text: 'student fees', excluded: true }]]);
assert.deepEqual(parseDocumentQuery(' OR AND + '), []);
assert.deepEqual(documentQueryHighlights('"public safety" OR policing -draft'), ['public safety', 'policing']);
const filter = documentQueryFilter('"public safety" training OR -draft');
assert.equal((filter.OR as unknown[]).length, 2);
const first = filter.OR![0].AND as { OR: { content?: { contains: string } }[] }[];
assert.equal(first.length, 2, 'ordinary terms must all match, possibly in different fields');
assert.equal(first[0].OR[3].content!.contains, 'public safety', 'quoted words remain one contiguous substring');
assert.ok(JSON.stringify(filter.OR![1]).includes('"NOT"'));
assert.ok(JSON.stringify(documentQueryFilter('100%')).includes('100\\\\%'), 'LIKE wildcard is literal');
assert.equal(documentFindRank({ title: 'Public safety training' }, '"public safety" +training -draft'),
    documentFindRank({ title: 'Public safety training' }, '"public safety" training'));
const href = documentSearchHref('/documents/example?version=old#annotation-note', '/documents?q=public+safety', '"public safety"');
const url = new URL(href, 'https://archive.invalid');
assert.equal(url.searchParams.get('version'), 'old');
assert.equal(url.hash, '#annotation-note');
assert.equal(url.searchParams.get('q'), '"public safety"');
assert.equal(url.searchParams.get('returnTo'), '/documents?q=public+safety');
console.log('Document search operators and navigation checks passed.');
