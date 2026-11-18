import assert from 'node:assert/strict';
import { DOCUMENT_CORRECTIONS } from '../config/document-corrections';
import { documentDate } from '../lib/identity';
import { canonicalTitle } from '../lib/titles';
import { classifyDocument } from '../lib/kinds';
import { presentBill } from '../lib/bill-presentation';
import { renderDocument } from '../lib/render';
import { hasUnverifiedMeetingDate, HOMEPAGE_MINUTES_SUBSTITUTE } from '../config/document-corrections';
import { reconcileMeetingDates } from '../lib/meeting-dates';
import { countsAsSenateRecord } from '../lib/activity';

const driveFileId = '1eNX_J_J1joa_uuhBMnhi9cwU91rC5Q1639RzSr_wUDs';
const minutes = { id: 'minutes', driveFileId, title: 'MINUTES 9 2026', content: '# Senate Meeting #9\n## October 13, 2026 / 07:00 PM / BSC 404', folderPath: '02_General Body Meetings/GBM MINUTES', sessionNumber: 114 };
assert.equal(documentDate(minutes)?.toISOString(), '2026-10-20T12:00:00.000Z');
assert.equal(canonicalTitle(minutes), DOCUMENT_CORRECTIONS[driveFileId].displayTitle);
assert.equal(documentDate({...minutes, driveFileId: 'unreviewed'})?.getUTCDate(), 13);
const bill = { id: 'bill', driveFileId: '1sK0Q2N8sjJ-WJNFAgwaZHAtxAPUzyB2x5b36m3XP7qM', title: 'Theta_TEMPLATE: Funding Bill', folderPath: '', sessionNumber: 114 };
assert.equal(classifyDocument({...bill, name: bill.title}), 'bill.funding');
assert.equal(canonicalTitle(bill), 'Take Back The Night Rally Funding Bill');
assert.equal(classifyDocument({...bill, driveFileId: 'blank-template', name: bill.title}), 'template');
assert.equal(presentBill(renderDocument('Senate\nStudent Government Association\nAn SGA Funding Bill\nUnfinished template', [])).header.length, 0);
console.log('Reviewed document correction checks passed.');

const duplicate = {...minutes, driveFileId: '1ZnG1_4EuxXb0-_CowTbrfaOUJ4wBjCxQv3nJsVZhJFs',
    title: 'MINUTES 13 2026', kind: 'minutes.senate', meetingRole: 'minutes',
    datedAt: new Date('2026-11-17T12:00:00Z'), driveCreatedTime: new Date('2026-11-18T00:10:00Z')};
assert.equal(documentDate(duplicate), null);
assert.equal(hasUnverifiedMeetingDate(duplicate.driveFileId), true);
assert.equal(canonicalTitle(duplicate), 'Senate Minutes — Duplicate Copy (Meeting Date Unverified)');
assert.equal(reconcileMeetingDates([duplicate]).size, 0);
const substitute = {...duplicate, driveFileId: HOMEPAGE_MINUTES_SUBSTITUTE,
    folderPath: "05_Committees/Internal Affairs/Demarri's Folder/Senate Minutes"};
assert.equal(countsAsSenateRecord(substitute), false);
