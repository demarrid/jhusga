import assert from "node:assert/strict";
import { extractContributors } from "../lib/contributors";
import { buildSessionDirectory } from "../lib/directory";
import { meetingOutline } from "../lib/meeting-outline";
import { reconcileMeetingDates, passageDateFitsDocument } from "../lib/meeting-dates";
import { resolveAffiliates, resetNameResolverCache } from "../lib/names";
import { nameKey } from "../lib/contributors";

const source = "jessica ereiz: i'm going to explain our advising services.\njessica: we welcome feedback.";
const mentions = extractContributors(source, "Senate Minutes", "minutes.senate");
assert.equal(mentions.find(row => row.name === "Jessica Ereiz")?.onlyIfKnown, false);
const headings = extractContributors("1. Before arrival: outreach begins.\n2. Advising support: students request forms.\n3. Next step: explore funding.", "Senate Minutes", "minutes.senate");
assert.ok(headings.every(row => row.onlyIfKnown), "headings cannot establish new full-name people");
assert.ok(!headings.some(row => row.name === "Step"));

const people = new Map([
    ["jessica snell", { id: "snell", name: "Jessica Snell", nameKey: "jessica snell", contributions: [{documentId:"older"}], hopkinsRelationships: [] }],
    ["jazzlyn fernandez", { id: "jazz", name: "Jazzlyn Fernandez", nameKey: "jazzlyn fernandez", contributions: [{documentId:"older"}], hopkinsRelationships: [{hopkinsCategory:{name:"President of the Senate"}}] }],
]);
(globalThis as unknown as {prisma: unknown}).prisma = {
    hopkinsAffiliate: {
        findMany: async () => [...people.values()],
        findUnique: async ({where}: {where:{nameKey:string}}) => people.get(where.nameKey) ?? null,
        upsert: async ({where,create}: {where:{nameKey:string};create:{name:string;nameKey:string}}) => {
            if (!people.has(where.nameKey)) people.set(where.nameKey, {...create,id:where.nameKey,contributions:[],hopkinsRelationships:[]});
            return people.get(where.nameKey);
        },
    },
    hopkinsAlias: { findUnique: async ({where}: {where:{aliasKey:string}}) => where.aliasKey === "jessica" ? {hopkinsAffiliateId:"snell"} : null },
};
async function main() {
    resetNameResolverCache();
    const ids = await resolveAffiliates(mentions, {text:source,body:"senate",isCurrentSession:true});
    assert.ok(ids.every(id => id === "jessica ereiz"), "local full name beats an old global first-name alias, regardless of mention order");
    const roll = extractContributors("Here: Surprise visitor jazz!", "Committee Minutes", "minutes.committee");
    const attendees = await resolveAffiliates(roll, {text:"Here: Surprise visitor jazz!",body:"senate",isCurrentSession:true});
    assert.deepEqual(attendees.filter(Boolean), ["jazz"], "attendance prose never creates people");

    const roster = {id:"roster",title:"SGA Roster",kind:"directory",folderPath:"",content:
        "1. Executive Branch\n   1. President\n      1. Alex Jones\n2. Judiciary Branch\n   1. Justices\n      1. Robin Smith\n   2. Committee on Student Elections\n      1. Chair\n         1. Taylor Brown\n      2. Secretary\n         1. Morgan Green"};
    const directory = buildSessionDirectory([roster]).members;
    for (const name of ["Taylor Brown","Morgan Green"]) {
        const person = directory.find(row => row.name === name)!;
        assert.equal(person.group, "cse");
        assert.ok(person.positions.every(position => !/Justice/.test(position)));
    }

    const outline = meetingOutline([{id:"section-0",title:"First Reading",children:[{id:"section-50",title:"AI access.docx- Senator A",children:[]}]}], [],
        [{id:"ai",title:"Equitable AI access",kind:"resolution",sessionNumber:114,sourceOffset:55}]);
    assert.equal(outline.length,1);
    assert.equal(outline[0].children[0].documentLinks?.[0].href,"/documents/ai");

    const base = {folderPath:"General Body Meetings/Minutes",kind:"minutes.senate",sessionNumber:114,content:"October 13, 2026\nMINUTES"};
    const original = {...base,id:"original",title:"MINUTES 8 2026",driveCreatedTime:new Date("2026-10-13T23:00:00Z"),datedAt:new Date("2026-10-13T12:00:00Z")};
    const copied = {...base,id:"copied",title:"MINUTES 10 2026",driveCreatedTime:new Date("2026-10-27T22:58:00Z"),datedAt:original.datedAt};
    assert.equal(reconcileMeetingDates([original,copied]).get("copied")?.date.toISOString().slice(0,10),"2026-10-27");
    assert.equal(reconcileMeetingDates([copied]).size,0,"creation date alone is insufficient");
    assert.equal(reconcileMeetingDates([original,{...copied,sessionNumber:113}]).size,0,"sessions do not corroborate each other");
    assert.equal(reconcileMeetingDates([original,{...copied,driveCreatedTime:new Date("2026-10-30T12:00:00Z")}]).size,0,"nonweekly uploads are not shifted");
    assert.equal(passageDateFitsDocument(new Date("2026-10-13"),{title:"Funding Bill",content:"Presented for Second Reading this 27th day of October in the year 2026"}),false);
    assert.equal(nameKey("Jessica Ereiz"),"jessica ereiz");
    console.log("Archive quality regression checks passed.");
}
main().catch(error=>{console.error(error);process.exitCode=1;});
