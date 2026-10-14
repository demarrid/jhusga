import assert from "node:assert/strict";
import { readBillVotingRecords, billVoteDecision } from "../lib/bill-votes";
const sheet = (name: string, rows: string) => `\f${name}\nDate,Bill #,Link,Status\n${rows}`;
const record = readBillVotingRecords('Roster\nName,Vote\n' + sheet('First Reading','9/15/2026,1,Example Bill,Referred to Committee\n9/22/2026,1,Example Bill,Passed\n')
    + '\fCommittee\nBill #,Link,Primary Committee,Recommendation,Vote Margin,Date\n2,Committee Bill,Finance,Positive Recommendation,6-0-0,9/22/2026\n'
    + sheet('Second Reading','9/29/2026,1,Example Bill,Adopted\n9/29/2026,2,Blank Bill,\n9/29/2026,3,Rejected Bill,Rejected\n,4,Ambiguous Bill,Adopted\n,4,Ambiguous Bill,Tabled'));
const decide = (title: string) => billVoteDecision({title,driveFileId:'file'},record);
assert.equal(decide('Example Bill').status,'passed');
assert.equal(decide('Example Bill').when?.toISOString(),'2026-09-29T12:00:00.000Z');
assert.equal(decide('Committee Bill').status,'unknown');
assert.equal(decide('Blank Bill').status,'unknown');
assert.equal(decide('Rejected Bill').status,'not_passed');
assert.equal(decide('Ambiguous Bill').status,'ambiguous');
assert.equal(decide('Example Bill 2').status,'unknown', 'never match partial names');
const direct = readBillVotingRecords(sheet('Second Reading','9/29/2026,1,https://docs.google.com/document/d/ABCDEFGHIJKLMNOPQRSTUVWX/edit,Adopted'));
assert.equal(billVoteDecision({title:'renamed',driveFileId:'ABCDEFGHIJKLMNOPQRSTUVWX'},direct).status,'passed');
const undated = readBillVotingRecords(sheet('Second Reading',',1,Example Bill.docx,Adopted'));
assert.deepEqual(billVoteDecision({title:'Example Bill',driveFileId:'file'},undated),{status:'passed',when:null});
console.log('all bill voting record checks passed');
