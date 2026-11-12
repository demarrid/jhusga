import assert from 'node:assert/strict';
import {cleanArchiveTranscription,archiveDocumentContent} from '../lib/archive-transcription';
const raw=`The objects of this body shall be:
(a) To serve as a medium between facul-
ty and students.
(b) To correlate the various University
activities,promoting co-operation of all par-
ties in all matters affecting the welfare of
the University.
（c) To uphold and promote the Johns
Hopkins Honor System.`;
const expected=`The objects of this body shall be:\n\n(a) To serve as a medium between faculty and students.\n\n(b) To correlate the various University activities, promoting co-operation of all parties in all matters affecting the welfare of the University.\n\n(c) To uphold and promote the Johns Hopkins Honor System.`;
assert.equal(cleanArchiveTranscription([raw]),expected);
assert.equal(cleanArchiveTranscription(['## Page 1\n\n### Left page or column\n\nThe Univer-\n8','### Right page or column\n\nsity supports co-\noperation.\n9']),'The University supports co-operation.');
assert.equal(cleanArchiveTranscription(['ARTICLE II.\nOBJECT\nThe purpose is clear.\nSECTION 1.\nMEMBERSHIP\n(a) A member\nshall act.']).includes('## ARTICLE II. — OBJECT'),true);
assert.equal(cleanArchiveTranscription(['1.\nCarry out the\nduties.\n2.\nPreside over\nmeetings.']),'1. Carry out the duties.\n\n2. Preside over meetings.');
const content=archiveDocumentContent([raw],[{name:'IMG_1.HEIC',url:'https://drive.google.com/file/d/example/view'}]);
assert.ok(content.endsWith('## Sources\n\n[IMG_1.HEIC](https://drive.google.com/file/d/example/view)'));
console.log('Archive transcription checks passed');
assert.equal(cleanArchiveTranscription(['9/17: Interviews','9/20-28:','More interviews.']),'9/17: Interviews\n\n9/20-28: More interviews.');
assert.equal(cleanArchiveTranscription(['Class Presidents:','Tom Messana (\'80)','Michael Steele(81)']),'Class Presidents:\n\nTom Messana (\'80)\n\nMichael Steele (81)');
const cover=archiveDocumentContent(['background OCR'],[{name:'IMG_2369.HEIC',url:'https://drive.google.com/file/d/1NLL76AHW809268d2oJxo-39nZJllmYpL/view'}]);
assert.ok(!cover.includes('background OCR'));
assert.ok(cover.includes('Constitution of the Student Council of the Johns Hopkins University'));
