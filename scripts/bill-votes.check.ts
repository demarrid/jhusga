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
// A file renamed after registration matches by bill number only when its own text names the registered bill.
const numbered = readBillVotingRecords(sheet('First Reading','9/15/2026,S-B.114.09.15.26-4,Budget Reporting Act,Referred to Committee\n9/29/2026,S-B.114.10.06.26-1,Survey Tabling Bill,Referred to Committee\n')
    + sheet('Second Reading','9/22/2026,S-B.114.09.15.26-4,Budget Reporting Act,Adopted\n10/6/2026,S-B.114.10.06.26-1,Nutrition Tabling Supplies Funding Bill,Adopted'));
const renamed = {title:'S-B.114.09.15.26-4 | Budget Transparency Act.pdf', driveFileId:'file'};
assert.deepEqual(billVoteDecision({...renamed, content:'This bill may be referred to as the “Budget Reporting Act”.'},numbered),{status:'passed',when:new Date('2026-09-22T12:00:00Z')});
assert.equal(billVoteDecision(renamed,numbered).status,'unknown','a number alone never matches');
assert.equal(billVoteDecision({...renamed, content:'The Budget Transparency Act.'},numbered).status,'unknown','the text must name the registered bill');
assert.equal(billVoteDecision({title:'S-B.114.10.06.26-1 | Survey Tabling Bill v2', driveFileId:'file', content:'Survey Tabling Bill'},numbered).status,'unknown','a number the register gives two bills matches neither');
console.log('all bill voting record checks passed');
