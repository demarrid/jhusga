import assert from 'node:assert/strict';import {archiveDateCandidates as c} from '../lib/archive-dates';
assert.equal(c('1981 Constitution','')[0].precision,'year');
assert.equal(c('Meeting 11_12_2019','')[0].date.slice(0,10),'2019-11-12');
assert.equal(c('Minutes','November 12, 2019')[0].precision,'day');
assert.equal(c('Minutes','November 2019')[0].precision,'month');
assert.equal(c('2019-2020 records','').length,0);
assert.equal(c('Report','We discussed the meeting of November 12, 2019.').length,0);
assert.equal(c('Meeting 2/30/2019','').length,1); // only the stated year survives an invalid day
console.log('Archive date evidence checks passed');

assert.equal(c('SGA-B-1819.05 - FIJI the PUSH Funding Act','').length,0);
assert.equal(c('SGA-R-1920.02 - Policy','').length,0);
assert.equal(c('SGA-B-2021.02 - Example','').length,0);
assert.equal(c('SGA-B-1819.05 - FIJI the PUSH Funding Act','Introduced By: President and considered this day 8th of October in the Year 2019')[0].date.slice(0,10),'2019-10-08');

assert.equal(c('John Hopkins Constitution.pdf','The Johns Hopkins University Undergraduate Student Government Association Constitution Ratified: May 4, 2015')[0].date.slice(0,10),'2015-05-04');
assert.equal(c('Rules',Array(30).fill('Section text').join('\n')+'\nRatified: May 4, 2015')[0].date.slice(0,10),'2015-05-04');
