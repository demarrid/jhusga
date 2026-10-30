import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { amendmentPassage, type PassageDocument, type PassageBill } from "../lib/amendment-passage";

const bill: PassageBill = {id:"bill",driveFileId:"AMENDMENTBILL1234567890",title:"Academic Rules Amendment",sessionNumber:114};
const now = new Date("2026-10-30T20:00:00Z");
function doc(content:string,kind="tracker",id="register",sessionNumber:number|null=114): PassageDocument {
    return {id,driveFileId:id+"12345678901234567890",title:kind === "tracker" ? "114th Bill Voting Records" : "Senate Minutes",
        kind,content,contentHash:createHash("sha256").update(content).digest("hex"),sessionNumber,datedAt:new Date("2026-10-20T12:00:00Z")};
}
const sheet = (status:string,reading="Second Reading",date="10/20/2026",title=bill.title) =>
    `\f${reading}\nDate,Bill #,Link,Status\n${date},1,${title},${status}`;
const minute = (vote:string,heading=`[${bill.title}](https://docs.google.com/document/d/${bill.driveFileId}/edit)`) =>
    doc(`1. ${heading}\n   1. ${vote}\n2. Adjournment`,"minutes.senate","minutes");
const decide = (records:PassageDocument[]=[],minutes:PassageDocument[]=[]) =>
    amendmentPassage({bill,records,minutes,asOf:now});

assert.equal(decide([doc(sheet("Passed"))]).status,"passed");
assert.equal(decide([doc(sheet("Adopted","First Reading"))]).status,"passed");
assert.equal(decide([doc(sheet("Passed","First Reading"))]).status,"unknown","first reading alone is not final adoption");
assert.equal(decide([doc(sheet("Passed","First Reading")+sheet("","Second Reading"))]).status,"unknown","blank second reading doesn't inherit first reading");
assert.equal(decide([doc(sheet("","Second Reading"))],[minute("Demarri: Motion to pass bill, passed")]).source,"minutes");
assert.equal(decide([doc(sheet("Passed"))],[minute("Motion to pass, passed")]).source,"register");
assert.equal(decide([doc(sheet("Rejected"))],[minute("Motion to pass, passed")]).status,"ambiguous");
assert.equal(decide([doc(sheet("Passed"))],[minute("Motion to pass, failed")]).status,"ambiguous");
assert.equal(decide([doc(sheet("Adopted")+sheet("Rejected","Second Reading","10/27/2026"))]).status,"ambiguous","do not silently pick later conflicting result");
assert.equal(decide([doc(sheet("Adopted","Second Reading",""))]).status,"unknown","undated passage never clears");
assert.equal(decide([doc(sheet("Passed","Second Reading","11/3/2026"))]).status,"unknown","future passage never clears");
assert.equal(decide([doc(sheet("Passed","Second Reading","10/20/2026","Academic Rules Amendment 2"))]).status,"unknown","no partial title matching");
assert.equal(decide([doc(sheet("Passed","Second Reading","10/20/2026","S.B.26-27.1"))]).status,"unknown","bill number alone is insufficient");
assert.equal(decide([doc(sheet("Passed"),"tracker","older",113)]).status,"unknown","no earlier session title collision");
assert.equal(decide([doc(sheet("Passed"),"tracker","undated-session",null)]).status,"unknown","title-only match needs known matching session");
assert.equal(decide([doc(sheet("Passed","Second Reading","10/20/2026",
    `https://docs.google.com/document/d/${bill.driveFileId}/edit`),"tracker","unknown-session",null)]).status,"passed","exact identity survives missing session metadata");
assert.equal(decide([doc(sheet("Passed","Second Reading","10/20/2026",
    "[Academic Rules Amendment](https://docs.google.com/document/d/OTHERBILL12345678901234/edit)"))]).status,"unknown","different link cannot fall back to its title");
assert.equal(decide([doc("\fCommittee\nDate,Bill #,Link,Status\n10/20/2026,1,Academic Rules Amendment,Passed")]).status,"unknown");
for (const vote of [
    "Passed with positive recommendation from finance committee",
    "Motion to refer to committee, passed",
    "Motion to table, passed",
    "Motion to pass the amendment, passed",
    "Motion to strike section 3, passed",
    "Motion to pass",
    "We hope the bill passes next week",
    "If the bill passes, we can proceed",
    "Motion to pass over the discussion, passed",
    "Bill passes if we get enough votes",
    "Bill passes?",
    "Motion to pass, not yet passed",
    "Bill passes unless someone objects",
]) assert.equal(decide([],[minute(vote)]).status,"unknown",vote);
assert.equal(decide([],[{...minute("Bill passes"),kind:"minutes.committee"}]).status,"unknown");
assert.equal(decide([],[{...minute("Bill passes"),datedAt:null}]).status,"unknown");
assert.equal(decide([],[minute("Motion to pass\n      1. Passed")]).status,"passed");
assert.equal(decide([],[minute("Motion to pass\n      1. Passed\n      2. Failed")]).status,"ambiguous");
assert.equal(decide([],[minute("Bill did not pass")]).status,"not_passed");
assert.equal(decide([],[minute("Motion to pass, passed",bill.title)]).status,"passed","exact-title heading can establish identity");
assert.equal(decide([],[minute("Motion to pass, passed","S.B.26-27.1")]).status,"unknown");
assert.equal(decide([],[doc(`1. [${bill.title}](https://docs.google.com/document/d/${bill.driveFileId}/edit)\n   1. Motion to pass\n2. [Other Bill](https://docs.google.com/document/d/OTHERBILL12345678901234/edit)\n   1. Bill passes`,"minutes.senate","adjacent")]).status,"unknown","never borrow next bill's result");
const source = minute("Demarri: Motion to pass bill, passed");
const result = decide([],[source]);
assert.equal(result.status,"passed");
assert.equal(result.when?.toISOString(),"2026-10-20T12:00:00.000Z");
assert.ok(result.evidence.every(e => source.content.includes(e.quote) && e.contentHash === source.contentHash && e.documentId === source.id));
assert.ok(result.evidence[0].quote.includes(bill.driveFileId),"quote preserves identifying heading");
console.log("Amendment passage checks passed.");

assert.equal(decide([],[minute("Motion to pass, passed",
    "b. ["+bill.title+"](https://docs.google.com/document/d/"+bill.driveFileId+"/edit)")]).status,"passed",
    "double-numbered linked agenda items keep their exact bill identity");
assert.equal(amendmentPassage({bill:{...bill,allowTitleFallback:false},records:[doc(sheet("Passed"))],minutes:[],asOf:now}).status,"unknown",
    "a corpus-level title collision disables title-only attribution");
