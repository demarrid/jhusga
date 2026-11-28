import assert from 'node:assert/strict';
import {findSensitiveSpans, hasRedactions, redactArchiveSecrets as r, redactedOffset} from '../lib/archive-redaction';

// Original behaviour: values go, labels and policy text stay, reruns are no-ops.
assert.equal(r('Student names: Jane Doe\nPassword: example-secret'),'Student names: Jane Doe\nPassword: [REDACTED: credential]');
assert.equal(r('Policy: protect Social Security numbers.\n**SSN:** [blank]'),'Policy: protect Social Security numbers.\n**SSN:** [blank]');
assert(!r('Jane Doe **SSN:** 123-45-6789').includes('123-45-6789'));
assert(r('**Bank Account Number:** [unclear: 123 4567]').includes('[REDACTED: financial identifier]'));
assert.equal(r(r('Password: example-secret')),r('Password: example-secret'));

// Taxpayer numbers in the shapes a W-9 and its transcription take.
assert.equal(r('**Social security number:** 123456789'),'**Social security number:** [REDACTED: financial identifier]');
assert.equal(r('SSN 123 45 6789 (see attached)'),'SSN [REDACTED: financial identifier] (see attached)');
assert.equal(r('**Employer identification number:** 12-3456789'),'**Employer identification number:** [REDACTED: financial identifier]');
assert.equal(r('EIN 12-3456789'),'EIN [REDACTED: financial identifier]');
assert.equal(r('Taxpayer identification number: 12-3456789'),'Taxpayer identification number: [REDACTED: financial identifier]');
assert.equal(r('Enter your TIN in the appropriate box. For individuals, this is your social security number (SSN).'),
    'Enter your TIN in the appropriate box. For individuals, this is your social security number (SSN).');

// Home addresses: the labelled value goes, through the city and ZIP.
assert.equal(r('3. **Address** (Home address is required. If mailing address is different, please note.): [unclear: 1234 Post Oak Street], College Park, MD 20740'),
    '3. **Address** (Home address is required. If mailing address is different, please note.): [REDACTED: home address]');
assert.equal(r('**Address (number, street, and apt. or suite no.):** 5678 PONTIAC STREET'),
    '**Address (number, street, and apt. or suite no.):** [REDACTED: home address]');
assert.equal(r('**City, state, and ZIP code:** College Park, MD 20740'),'**City, state, and ZIP code:** [REDACTED: home address]');
assert.equal(r('3. **Address** *(Home address is required. If mailing address is different, please note.):*'),
    '3. **Address** *(Home address is required. If mailing address is different, please note.):*');
assert.equal(r('Lives at 12 Elm Ct. Apt 4B, College Park, MD 20740'),'Lives at [REDACTED: home address]');
assert.equal(r('Mail checks to 12 Elm Ct. Apt 4B, Towson, MD 21204 by Friday.'),'Mail checks to [REDACTED: home address] by Friday.');
// An office's letterhead address is how readers find the office.
assert.equal(r('**Address:** 3400 N. Charles St./ Mattin 210'),'**Address:** 3400 N. Charles St./ Mattin 210');
assert.equal(r('Email address: sga@jhu.edu'),'Email address: sga@jhu.edu');
assert.equal(r('**Gmail Address:** someone2013@gmail.com'),'**Gmail Address:** someone2013@gmail.com');
assert.equal(r('12 Elm Ct.\nApt 4B'),'12 Elm Ct.\nApt 4B');
assert.equal(r('**Address:** 3700 N. Charles St. Apt 5'),'**Address:** [REDACTED: home address]');

// Phones: people's numbers go; University offices and toll-free lines stay.
assert.equal(r('Contact Jane at 301-555-0142 with questions.'),'Contact Jane at [REDACTED: phone number] with questions.');
assert.equal(r('**Cell:** (240) 555-0199'),'**Cell:** [REDACTED: phone number]');
assert.equal(r('Phone: (410) 516-8208    Fax: (410) 516-6232'),'Phone: (410) 516-8208    Fax: (410) 516-6232');
// OCR runs a label into the digits before it.
assert.equal(r('Phone:(410)944-4481Fax:(410)944-5689'),'Phone:(410)944-4481Fax:(410)944-5689');
assert.equal(r('Phone: 1.800.555.0100 ext. 4021'),'Phone: 1.800.555.0100 ext. 4021');
assert.equal(r('Office of Student Activities | Baltimore, MD 21218 | 410-516-8208'),'Office of Student Activities | Baltimore, MD 21218 | 410-516-8208');
assert.equal(r('Join by phone\n+1 253 555 0100 US (Tacoma)\nMeeting ID: 123 4567 8901'),'Join by phone\n+1 253 555 0100 US (Tacoma)\nMeeting ID: 123 4567 8901');
assert.equal(r('Mount Vernon Hotel\nBaltimore, MD 21201\n(410) 555-0123\nwww.example.com'),'Mount Vernon Hotel\nBaltimore, MD 21201\n(410) 555-0123\nwww.example.com');
assert.equal(r('Reach me on my cell, 410-516-0001'),'Reach me on my cell, [REDACTED: phone number]');
// A heading that happens to say "Personal" is not a personal number.
assert.equal(r('•  Contact the CSC office during business hours (410) 555-0123 •  Contact your advisor Personal Automobiles:'),
    '•  Contact the CSC office during business hours (410) 555-0123 •  Contact your advisor Personal Automobiles:');
assert.equal(r('Personal phone: (410) 555-0123'),'Personal phone: [REDACTED: phone number]');
assert.equal(r('Budget line 2013-14 allocated $4,500.00 to account 1234567890'),'Budget line 2013-14 allocated $4,500.00 to account 1234567890');

// A label's value is the number, not the rest of the line.
assert.equal(r('Phone: (410) 516-8208 Cell: (240) 555-0199 Email: someone@jhu.edu'),'Phone: [REDACTED: phone number] Cell: [REDACTED: phone number] Email: someone@jhu.edu');
assert.equal(r('Cell: 2405550199'),'Cell: [REDACTED: phone number]');
// A shop receipt prints the store's number; a staff contact's number is still removed.
assert.equal(r('**Party City®**\n\nNOBODY HAS MORE PARTY FOR LESS\n\n6311 YORK RD\nBALTIMORE, MD 21212\n(443) 555-0123\n\nTAX EXEMPT'),
    '**Party City®**\n\nNOBODY HAS MORE PARTY FOR LESS\n\n6311 YORK RD\nBALTIMORE, MD 21212\n(443) 555-0123\n\nTAX EXEMPT');
assert.equal(r('**POINT PERSON:** SGA Advisor, Jane Doe – Associate Dean of Student Engagement\n(443) 555-0123\nDinner/On Site Logistics'),
    '**POINT PERSON:** SGA Advisor, Jane Doe – Associate Dean of Student Engagement\n[REDACTED: phone number]\nDinner/On Site Logistics');
// A shop's address is the shop.
assert.equal(r('Gamberdella Inc.\n30 W. Pennsylvania Ave. #1\nTowson, MD 21204'),'Gamberdella Inc.\n30 W. Pennsylvania Ave. #1\nTowson, MD 21204');
assert.equal(r('| Billing Address: | 3400 N. Charles St.<br>Mattin Center Suite 210 |'),'| Billing Address: | 3400 N. Charles St.<br>Mattin Center Suite 210 |');

// Table cells keep their pipes.
assert.equal(r('| Home address: 99 Oak Rd, Laurel, MD 20707 | Senator |'),'| Home address: [REDACTED: home address] | Senator |');

// Dates of birth and licences.
assert.equal(r('DOB: 04/12/1991'),'DOB: [REDACTED: date of birth]');
assert.equal(r("Driver's license number: M123-456-789-012"),"Driver's license number: [REDACTED: personal identifier]");

// Every rule is idempotent, and spans are what the PDF pipeline boxes.
const sample='Jane Doe, **SSN:** 123-45-6789\nHome address: 12 Elm Ct. Apt 4B, Towson, MD 21204\nCell: 240-555-0199';
assert.equal(r(r(sample)),r(sample));
assert(hasRedactions(r(sample)) && !hasRedactions(sample));
assert.deepEqual(findSensitiveSpans(sample).map(s=>sample.slice(s.start,s.end)),['123-45-6789','12 Elm Ct. Apt 4B, Towson, MD 21204','240-555-0199']);

// Image offsets after a redacted value move with the text around them.
const doc='Cell: 240-555-0199\n\nNext paragraph';
assert.equal(r(doc).slice(redactedOffset(doc,doc.indexOf('Next'))),'Next paragraph');
assert.equal(redactedOffset(doc,3),3);

console.log('Redaction checks passed');
