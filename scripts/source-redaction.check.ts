import assert from 'node:assert/strict';
import {fieldBoxes, isPhoneSheet, linksToSource, planRedactions, protectSourceLinks, remainingFindings, sourceAccess, sourceFileIds, valueBoxes, type PageLine, type SourcePage} from '../lib/source-redaction';

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
// An SSN label after a name on the same line: the box starts at the label's end, digits and all.
const named: PageLine = {source: 'ocr', words: words('StruckJazz-ElizabethFixsen SSN:55', 100, 160)};
const [beside] = fieldBoxes(named, page([named]), 0);
assert(beside && beside.box[0] < 100 + 31 * 5 && beside.box[0] > 100 + 26 * 5, 'starts after "SSN:", before the digits');
assert(beside.box[1] < 160 - 30, 'reaches up');
// A password written on the line under its label.
const pw: PageLine = {source: 'text', words: words('● Email Password:', 100, 300)};
assert.deepEqual(fieldBoxes(pw, page([pw]), 0).map(b => b.kind), ['credential', 'credential']);
// "Johnssn" and "Students Assn." are not SSN labels.
for (const text of ['Johnssn Hopkins', 'Hong Kong Students Assn. (B)']) {
    const line: PageLine = {source: 'ocr', words: words(text, 100, 160)};
    assert.equal(fieldBoxes(line, page([line]), 0).length, 0, text);
}
// OCR glues letters to the label and reads dashes as "~".
const glued: PageLine = {source: 'ocr', words: words('StruckJazz-ElizabethFixsen nsSN:123-o4~5678', 100, 160)};
assert(fieldBoxes(glued, page([glued]), 0).length === 2, 'glued label is a field');
assert(valueBoxes(glued, page([glued]), 0).some(b => b.kind === 'personal identifier'), 'tilde SSN is covered by shape');
// An office number the plan left is excused when the re-read misreads a digit; an SSN never is.
const sig = (n: string) => [{source: 'ocr' as const, words: words(n, 53, 131)}];
assert.deepEqual(remainingFindings([page(sig('410-518-7668'))], [page(sig('410-516-7668'))]), []);
assert.deepEqual(remainingFindings([page(sig('410-518-7668'))], [page(sig('410-516-1234'))]).length, 1);
// The paragraphs that explain SSNs are not fields.
const prose: PageLine = {source: 'text', words: words('For individuals, this is generally your social security number (SSN). However, for a resident alien, sole proprietor, or disregarded entity, see the instructions.')};
assert.equal(fieldBoxes(prose, page([prose]), 0).length, 0);

// A spreadsheet page: bare digits under a "Primary Contact Phone" heading are boxed; a business directory's are not.
const sheet = [
    {source: 'text' as const, words: words('Primary Contact Phone', 300, 100)},
    {source: 'text' as const, words: words('Jane', 100, 112)}, {source: 'text' as const, words: words('4105550123', 300, 112)},
    {source: 'text' as const, words: words('4105160000', 300, 124)},
];
assert.deepEqual(planRedactions([page(sheet)]).map(b => b.kind), ['phone number']);
assert.deepEqual(remainingFindings([page(sheet)]).map(f => f.kind), ['phone number']);
const directory = [...sheet, {source: 'text' as const, words: words('Company', 100, 100)}];
assert.deepEqual(planRedactions([page(directory)]), []);

// A header row run together into one line: the column's heading starts where its values start.
const runTogether = [{source: 'text' as const, words: words('What is your name? What is your best contact phone number?What else', 100, 100)},
    {source: 'text' as const, words: words('Jane', 100, 112)}, {source: 'text' as const, words: words('4125550174', 100 + 19 * 5, 112)},
    {source: 'text' as const, words: words('Ann', 100, 124)}, {source: 'text' as const, words: words('7035550152', 100 + 19 * 5, 124)}];
assert.deepEqual(planRedactions([page(runTogether)]).map(b => b.kind), ['phone number', 'phone number']);
// Right-aligned, heading clipped: covered when the stored text shows a phone column.
const rightAligned = [{source: 'text' as const, words: words('What is your best contact p', 100, 100)},
    {source: 'text' as const, words: words('4125550174', 240, 112)}];
assert.equal(planRedactions([page(rightAligned)]).length, 0);
assert(isPhoneSheet('| Jane | [REDACTED: phone number] |') && !isPhoneSheet('Cell: [REDACTED: phone number]'));
assert.equal(planRedactions([page(rightAligned)], undefined, {phoneSheet: true}).length, 1);
assert.equal(remainingFindings([page(rightAligned)], [], {phoneSheet: true}).length, 1);
// A clipped heading: three phone-shaped numbers stacked in a column are still phones; codes starting 1 are not.
const clipped = ['4105550123', '7135550199', '9195550142'].map((n, i) => ({source: 'text' as const, words: words(n, 300, 100 + i * 12)}));
assert.equal(planRedactions([page(clipped)]).length, 3);
const codes = ['1105550123', '1135550199', '1195550142'].map((n, i) => ({source: 'text' as const, words: words(n, 300, 100 + i * 12)}));
assert.equal(planRedactions([page(codes)]).length, 0);

// A résumé header: its street, city line and phone are boxed in personal mode only.
const header = [{source: 'text' as const, words: words('6 Beresford Lane, Larchmont, NY 10543 US | (914) 555-0123', 100, 100)}];
assert.deepEqual(planRedactions([page(header)]).map(b => b.kind), ['phone number']);
assert.deepEqual([...new Set(planRedactions([page(header)], undefined, {personal: true}).map(b => b.kind))].sort(), ['home address', 'phone number']);
assert.equal(remainingFindings([page(header)], [], {personal: true}).length, 3);

// Manual boxes: whole pages and page fractions, 1-based.
const plan = planRedactions([page([]), page([])], {pages: [2], boxes: [{page: 1, box: [0.5, 0.1, 1, 0.2]}]});
assert.deepEqual(plan.map(b => [b.page, b.method, b.box.map(Math.round)]), [[1, 'manual', [0, 0, 612, 792]], [0, 'manual', [306, 79, 612, 158]]]);

// The check that runs on the finished copy.
assert.deepEqual(remainingFindings([page([typed]), page([])]), [{page: 1, kind: 'financial identifier'}]);
assert.deepEqual(remainingFindings([page([{source: 'ocr', words: words('Social security number: [blacked out]')}])]), []);
// The re-read keeps a business's number that the plan left alone, and still reports a person's.
assert.deepEqual(remainingFindings([page(shop)]), []);
assert.deepEqual(remainingFindings([page(home)]).map(f => f.kind), ['phone number']);
// A vendor's number the plan read and left is excused when the re-read loses its context; a new one is not.
const vendorSource = [{source: 'ocr' as const, words: words('Linens: Table Toppers, 410.555.0123, info@tabletoppers.example', 100, 100)}];
const vendorReread = [{source: 'ocr' as const, words: words('Linens:TableToppers,410.555.0123,table.toppers@comcast.net', 100, 100)}];
assert.deepEqual(remainingFindings([page(vendorReread)], [page(vendorSource)]), []);
assert.deepEqual(remainingFindings([page(vendorReread)], [page([])]).map(f => f.kind), ['phone number']);

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
