import assert from "node:assert/strict";
import { verifyAmendmentMatch, type AmendmentBill } from "../lib/amendment-clearance";

const target = {kind:"guiding.bylaws",title:"Bylaws of the Senate"};
const old = "4.1 Senators shall attend four meetings.";
const next = "4.1 Senators shall attend three meetings.";
const bill:AmendmentBill = {id:"act",title:"Attendance Amendment",kind:"bill.bylaws_amendment",
 content:`Replace "${old}" with "${next}".`,
 passage:{status:"passed",sourceId:"minutes",evidence:"Motion to pass, passed 20-0."}};
const check = (content:string,before=old,after=next,changes:Partial<AmendmentBill>={}) =>
 verifyAmendmentMatch({target,before,after,bills:[{...bill,...changes,content}]});
assert.equal(check(bill.content).clear,true);
assert.equal(check(bill.content,old,next+" Unapproved rule.").clear,false);
assert.equal(check(bill.content,old,next,{passage:{...bill.passage,status:"unknown"}}).clear,false);
assert.equal(check(bill.content,old,next,{passage:{...bill.passage,evidence:""}}).clear,false);
assert.equal(check(bill.content,old+" "+old,next+" "+old).clear,false);
assert.equal(check(`Do not replace "${old}" with "${next}".`).clear,false);
assert.equal(check(`If adopted, replace "${old}" with "${next}".`).clear,false);
assert.equal(check("Examples\n"+bill.content).clear,false);
assert.equal(check("This Act shall take effect on November 1, 2099.\n"+bill.content).clear,false);
assert.equal(check("This Act shall take effect immediately upon passage.\n"+bill.content).clear,true);
assert.equal(check(bill.content,old,next,{kind:"bill.constitution_amendment"}).clear,false);
const table = `| Current Language | Proposed Language |
| --- | --- |
| ${old} | 4.1 Senators shall attend ~~four~~ **three** meetings. |`;
assert.equal(check(table).clear,true,"redline projections in explicitly labeled proposed column");
assert.equal(check(table.replace("~~four~~","~~four")).clear,false);
assert.equal(check(table.replace("Current Language","Rationale")).clear,false);
assert.equal(check(table.replace("Proposed Language","Example")).clear,false);
assert.equal(check(table,old,next,{kind:"bill.bylaws_constitution_amendment"}).clear,false);
assert.equal(check("| SENATE BYLAWS | |\n"+table,old,next,{kind:"bill.bylaws_constitution_amendment"}).clear,true);
const otherOld = "5.1 The quorum shall be ten members.";
const otherNew = "5.1 The quorum shall be twelve members.";
const multiple = `| Current | Proposed |
| --- | --- |
| ${old}<br>=====<br>${otherOld} | ${next} ==== ${otherNew} |`;
const combined = check(multiple,old+"\n"+otherOld,next+"\n"+otherNew);
assert.equal(combined.clear,true);
assert.equal(combined.evidence.length,2);
assert.equal(check(`Delete "${otherOld}".`,old+" "+otherOld,old).clear,true);
assert.equal(check(`Insert "${otherNew}" after "${old}".`,old,old+" "+otherNew).clear,true);
const conflict = verifyAmendmentMatch({target,before:old,after:next,bills:[bill,
 {...bill,id:"other",content:`Replace "${old}" with "4.1 Senators shall attend two meetings.".`}]});
assert.equal(conflict.clear,false);
assert.equal(verifyAmendmentMatch({target,before:old,after:next,bills:[{...bill,content:""}]},
 [{billId:"act",instruction:bill.content}]).clear,false,"fabricated instruction is not evidence");
console.log("Amendment clearance checks passed");
