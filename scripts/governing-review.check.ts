import assert from "node:assert/strict";
import { billVersionAtPassage, reviewGoverningChanges, reviewFingerprint } from "../lib/governing-review";
type Held = Parameters<typeof reviewFingerprint>[0];
type Source = Parameters<typeof reviewFingerprint>[1][number];
const when = new Date("2026-10-20T12:00:00Z");
const old = "Members shall attend four meetings.";
const next = "Members shall attend three meetings.";
const original:Held = {id:"governing",title:"SGA Bylaws",kind:"guiding.bylaws",content:old,contentHash:"baseline",
 sessionNumber:114,lineageKey:"sga bylaws",heldRevisionId:"revision",reviewState:"held",
 heldRevision:{id:"revision",documentId:"governing",content:next,contentHash:"new",driveModifiedTime:when}};
const baseSource:Source = {id:"bill",driveFileId:"AMENDMENTBILL1234567890",title:"Attendance Amendment",displayTitle:"",
 kind:"bill.bylaws_amendment",content:`Replace "${old}" with "${next}".`,contentHash:"bill-hash",
 sessionNumber:114,lineageKey:"sga bylaws",datedAt:when,driveModifiedTime:new Date("2026-10-19T12:00:00Z"),
 reviewState:"published",revisions:[]};
const record:Source = {...baseSource,id:"register",driveFileId:"REGISTER123456789012345",title:"Bill Voting Records",kind:"tracker",
 content:"\fSecond Reading\nDate,Bill #,Link,Status\n10/20/2026,1,Attendance Amendment,Passed",contentHash:"votes"};
assert.ok(billVersionAtPassage(baseSource,when));
assert.equal(billVersionAtPassage({...baseSource,driveModifiedTime:new Date("2026-10-20T01:00:00Z")},when),null,
 "same-day edits cannot be ordered against a date-only vote");
const snapshot={id:"snapshot",content:baseSource.content,contentHash:"snapshot-hash",driveModifiedTime:new Date("2026-10-19"),fetchedAt:new Date("2026-10-21")};
assert.equal(billVersionAtPassage({...baseSource,driveModifiedTime:new Date("2026-10-22"),revisions:[snapshot]},when)?.id,"snapshot");
assert.equal(billVersionAtPassage({...baseSource,driveModifiedTime:new Date("2026-10-22"),
 revisions:[{...snapshot,fetchedAt:new Date("2026-10-19")}]},when),null,"a snapshot seen only before the vote may be a draft");
assert.equal(billVersionAtPassage({...baseSource,revisions:[{...snapshot,driveModifiedTime:baseSource.driveModifiedTime}]},when),null,
 "conflicting content at same modified time remains uncertain");
assert.equal(reviewFingerprint(original,[baseSource,record],when),reviewFingerprint(original,[record,baseSource],when));
assert.notEqual(reviewFingerprint(original,[baseSource,record],when),reviewFingerprint(original,[baseSource,{...record,content:record.content+" corrected"}],when));

let document=structuredClone(original);
let sources=[structuredClone(baseSource),structuredClone(record)];
let race=false, missingSchema=false, summaryStale=false, indexed=false;
const audits=new Map<string,Record<string,unknown>>();
type Query = {where?:Record<string,unknown>;data?:Record<string,unknown>;create?:Record<string,unknown>;update?:Record<string,unknown>};
const mock = {
 document:{
  findMany:async (query:Query)=>query.where?.reviewState ? (document.reviewState==="held"?[structuredClone(document)]:[]) : structuredClone(sources),
  findUnique:async ()=>structuredClone(document),
  updateMany:async (query:Query)=>{Object.assign(document,query.data);return {count:1};},
 },
 amendmentClearance:{
  findMany:async ()=>{if(missingSchema)throw new Error("migration missing");return [];},
  findUnique:async ({where}:Query)=>audits.get(String(where?.key))??null,
  upsert:async ({where,create,update}:Query)=>{const key=String(where?.key);audits.set(key,{...(audits.get(key)??create),...update});return audits.get(key);},
  update:async ({where,data}:Query)=>{const row=audits.get(String(where?.key))!;Object.assign(row,data);return row;},
 },
 documentRevision:{update:async ()=>({}),findUnique:async ()=>({contentHash:"new"})},
 documentSummary:{updateMany:async ()=>{summaryStale=true;return {count:1};}},
 documentContributor:{deleteMany:async()=>({count:0}),findMany:async()=>[]},
 hopkinsAffiliate:{findMany:async()=>[]},
 documentPassage:{deleteMany:async()=>({count:0}),createMany:async()=>{indexed=true;return {count:1};}},
 documentAnnotation:{findMany:async()=>[]},
 $transaction:async (work:unknown)=>{
  if(Array.isArray(work))return Promise.all(work);
  if(race)sources[1]={...sources[1],content:sources[1].content.replace("Passed","Failed"),contentHash:"changed"};
  return (work as (tx:unknown)=>unknown)(mock);
 },
};
(globalThis as unknown as {prisma:unknown}).prisma=mock;
function reset(){document=structuredClone(original);sources=[structuredClone(baseSource),structuredClone(record)];audits.clear();race=false;missingSchema=false;summaryStale=indexed=false;}
async function main(){
 reset();
 assert.equal((await reviewGoverningChanges({apply:false}))[0]?.status,"ready");
 assert.equal(audits.size,0);assert.equal(document.content,old,"dry run never publishes");
 reset();race=true;
 assert.equal((await reviewGoverningChanges())[0]?.status,"changed");
 assert.equal(document.content,old,"changed evidence invalidates a prepared clearance");
 reset();
 const result=await reviewGoverningChanges();
 assert.equal(result[0]?.status,"published",JSON.stringify(result));
 assert.equal(document.content,next);
 assert.equal(summaryStale,true);assert.equal(indexed,true);
 const audit=[...audits.values()][0];
 assert.equal(audit.status,"published");assert.ok(audit.publishedAt);assert.ok(audit.derivedUpdatedAt);
 reset();missingSchema=true;
 await assert.rejects(()=>reviewGoverningChanges(),/migration missing/);
 assert.equal(document.content,old,"no audit table means no publication");
 reset();sources[1].content=sources[1].content.replace("Passed","Failed");
 assert.equal((await reviewGoverningChanges())[0]?.status,"pending");
 assert.equal(document.content,old);
 reset();document.heldRevision!.content=next+" Unapproved addition.";
 assert.equal((await reviewGoverningChanges())[0]?.status,"pending");
 reset();sources.push({...baseSource,id:"collision",driveFileId:"OTHERBILL123456789012345"});
 assert.equal((await reviewGoverningChanges())[0]?.status,"pending","title-only status cannot choose among duplicate bill titles");
 console.log("Governing review integration checks passed");
}
main().catch(error=>{console.error(error);process.exitCode=1;});
