import assert from 'node:assert/strict';
import {fieldBoxes, linksToSource, planRedactions, protectSourceLinks, remainingFindings, sourceAccess, sourceFileIds, valueBoxes, type PageLine, type SourcePage} from '../lib/source-redaction';

const words = (text: string, x = 100, y = 200, height = 10): PageLine['words'] =>
    text.split(' ').map((word, i, all) => {
        const before = all.slice(0, i).join(' ').length + (i ? 1 : 0);
        return {text: word, box: [x + before * 5, y, x + (before + word.length) * 5, y + height]};
    });
const page = (lines: PageLine[]): SourcePage => ({width: 612, height: 792, lines});
const inside = (outer: number[], inner: number[]) => outer[0] <= inner[0] && outer[1] <= inner[1] && outer[2] >= inner[2] && outer[3] >= inner[3];

// A typed value is covered word for word; its label stays readable.
const typed: PageLine = {source: 'text', words: words('Social security number: 123-45-6789')};
const [value] = valueBoxes(typed, page([typed]), 0);
assert.equal(value.kind, 'financial identifier');
assert(inside(value.box, typed.words[3].box));
assert(value.box[0] > typed.words[2].box[2] - 3, 'label is not covered');

// OCR of handwriting: covered by shape even when the text detector cannot read it.
const scrawl: PageLine = {source: 'ocr', words: words('218-76-cc49')};
assert.equal(valueBoxes(scrawl, page([scrawl]), 0).length, 1);
const street: PageLine = {source: 'ocr', words: words('5678 PoMTIAC STRELT')};
assert.equal(valueBoxes(street, page([street]), 0)[0].kind, 'home address');
assert.equal(valueBoxes({source: 'text', words: words('218-76-cc49')}, page([]), 0).length, 0);
const office: PageLine = {source: 'ocr', words: words('Address:3400 N.Charles Street')};
assert.equal(valueBoxes(office, page([office]), 0).length, 0);
// Run-together OCR of a campus letterhead is still a campus address.
const letterhead: PageLine = {source: 'ocr', words: words('OfficeofStudentActivities|3400N.CharlesStreet|MattinCenterSuite210')};
assert.equal(valueBoxes(letterhead, page([letterhead]), 0).length, 0);
// A price is not a house number; "Breakfast" is not a street.
const price: PageLine = {source: 'ocr', words: words('$5 tickets; $25 Breakfast')};
assert.equal(valueBoxes(price, page([price]), 0).length, 0);
// A building named in a sentence is prose, not someone's address.
const sentence: PageLine = {source: 'ocr', words: words('Whereas, JHU has space for private events in the Milton S. Eisenhower Library located at 3400 N. Charles Street, Baltimore,')};
assert.equal(valueBoxes(sentence, page([sentence]), 0).length, 0);
// A business letterhead: the lines above name the company, so its street and number stay.
const shop = [words('PARTY PLUS RENTALS', 100, 100), words('One Beaver Court', 100, 112), words('Columbia showroom: 9000 Red Branch Road', 100, 124), words('Tel: 410-555-0123', 100, 136)]
    .map(w => ({source: 'ocr' as const, words: w}));
assert.deepEqual(shop.flatMap(line => valueBoxes(line, page(shop), 0)), []);
// The same street and phone with no business around them are covered.
const home = [words('5678 Pontiac Street', 100, 100), words('Cell: 240-555-0199', 100, 112)].map(w => ({source: 'ocr' as const, words: w}));
assert.deepEqual(home.flatMap(line => valueBoxes(line, page(home), 0)).map(b => b.kind), ['home address', 'phone number']);

// A short label covers its field, including handwriting written above it.
const label: PageLine = {source: 'ocr', words: words('SSN:', 360, 194)};
const field = fieldBoxes(label, page([label]), 0);
assert.equal(field.length, 2);
assert(field[0].box[1] <= 194 - 30 && field[0].box[2] >= 600, 'reaches up and right');
// OCR without spaces still finds a label that opens its line.
const squashed: PageLine = {source: 'ocr', words: words('2.Address (Home addressis reguired.f mailing adciress is dliferenl.please note.):', 86, 212)};
const below = fieldBoxes(squashed, page([squashed]), 0)[1];
assert(below.box[1] >= 214 && below.box[1] < 222 && below.box[3] >= 238 && below.box[2] >= 548);
// The paragraphs that explain SSNs are not fields.
const prose: PageLine = {source: 'text', words: words('For individuals, this is generally your social security number (SSN). However, for a resident alien, sole proprietor, or disregarded entity, see the instructions.')};
assert.equal(fieldBoxes(prose, page([prose]), 0).length, 0);

// Manual boxes: whole pages and page fractions, 1-based.
const plan = planRedactions([page([]), page([])], {pages: [2], boxes: [{page: 1, box: [0.5, 0.1, 1, 0.2]}]});
assert.deepEqual(plan.map(b => [b.page, b.method, b.box.map(Math.round)]), [[1, 'manual', [0, 0, 612, 792]], [0, 'manual', [306, 79, 612, 158]]]);

// The check that runs on the finished copy.
assert.deepEqual(remainingFindings([page([typed]), page([])]), [{page: 1, kind: 'financial identifier'}]);
assert.deepEqual(remainingFindings([page([{source: 'ocr', words: words('Social security number: [blacked out]')}])]), []);

// Source files: listed in the footer, else the document's own.
const id = '1NRkwj-eASJ_AG6JSIF3vGII42Kw4iXL4', other = '1ppcLSn_xI7bVLl0aGo1lCZJae-55TIMI';
assert.deepEqual(sourceFileIds('Body', id), [id]);
assert.deepEqual(sourceFileIds(`Body\n\n## Sources\n\n[a](https://drive.google.com/file/d/${other}/view) · [b](https://drive.google.com/file/d/${id}/view)`, 'archive-chain:x'), [other, id]);
assert.deepEqual(sourceFileIds('Body', 'archive-chain:x'), []);
assert(linksToSource(`https://drive.google.com/file/d/${id}/view?usp=drivesdk`, [id]));
assert(!linksToSource(`https://drive.google.com/file/d/${other}/view`, [id]));

// What "view source" opens.
const doc = {id: 'doc-1', driveFileId: id, source: `https://drive.google.com/file/d/${id}/view`, discoveredVia: 'archive',
    content: `Contractor\n**SSN:** [REDACTED: financial identifier]\n\n## Sources\n\n[Scan](https://drive.google.com/file/d/${id}/view)`};
assert.deepEqual(sourceAccess({...doc, content: 'Plain minutes', redactedSourceStatus: null}), {mode: 'original', href: doc.source, protectedIds: []});
const withheld = sourceAccess({...doc, redactedSourceStatus: 'pending'});
assert.equal(withheld.mode, 'withheld');
assert.equal(withheld.href, null);
const redacted = sourceAccess({...doc, redactedSourceStatus: 'approved'});
assert.deepEqual([redacted.mode, redacted.href], ['redacted', '/api/documents/doc-1/source']);
assert.equal(sourceAccess({...doc, discoveredVia: 'newsletter', redactedSourceStatus: null}).mode, 'original');

// Links to the original inside the rendered text follow the same rule.
const blocks = [{type: 'paragraph', runs: [{text: 'Scan', href: doc.source}, {text: 'Other', href: `https://drive.google.com/file/d/${other}/view`}]}];
assert.equal(protectSourceLinks(blocks, withheld)[0].runs[0].href, null);
assert.equal(protectSourceLinks(blocks, redacted)[0].runs[0].href, '/api/documents/doc-1/source');
assert.equal(protectSourceLinks(blocks, redacted)[0].runs[1].href, `https://drive.google.com/file/d/${other}/view`);
assert.equal(protectSourceLinks(blocks, sourceAccess({...doc, content: 'Plain', redactedSourceStatus: null})), blocks);

console.log('Source redaction checks passed');
