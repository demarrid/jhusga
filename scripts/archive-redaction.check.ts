import assert from 'node:assert/strict';import {redactArchiveSecrets as r} from '../lib/archive-redaction';
assert.equal(r('Student names: Jane Doe\nPassword: example-secret'),'Student names: Jane Doe\nPassword: [REDACTED: credential]');
assert.equal(r('Policy: protect Social Security numbers.\n**SSN:** [blank]'),'Policy: protect Social Security numbers.\n**SSN:** [blank]');
assert(!r('Jane Doe **SSN:** 123-45-6789').includes('123-45-6789'));
assert(r('**Bank Account Number:** [unclear: 123 4567]').includes('[REDACTED: financial identifier]'));
assert.equal(r(r('Password: example-secret')),r('Password: example-secret'));
console.log('Redaction checks passed');
