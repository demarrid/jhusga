import assert from "node:assert/strict";
import { extractContributors, nameKey } from "../lib/contributors";
import { resolveAffiliates, resetNameResolverCache, universityNameLookup, hasUniversityTitle, type RegularPerson } from "../lib/names";

const kai = { id: "kai", name: "Kai Martin", nameKey: "kai martin", documentCount: 5,
    positions: ["Senator", "Associate Dean"], bodies: ["senate"] } satisfies RegularPerson;
const people = new Map<string, {id:string;name:string;nameKey:string}>([["kai martin", kai]]);
(globalThis as unknown as {prisma:unknown}).prisma = {
    hopkinsAffiliate: {
        findMany: async () => [...people.values()].map(p => ({...p, contributions: [],
            hopkinsRelationships: [{hopkinsCategory:{name:"Senator"}}, {hopkinsCategory:{name:"Associate Dean"}}]})),
        findUnique: async ({where}:{where:{nameKey:string}}) => people.get(where.nameKey) ?? null,
        upsert: async ({create}:{create:{name:string;nameKey:string}}) => {
            const p = people.get(create.nameKey) ?? {...create,id:create.nameKey};
            people.set(create.nameKey,p); return p;
        },
    },
    hopkinsAlias: {findUnique:async ({where}:{where:{aliasKey:string}}) => where.aliasKey === "martin" ? {hopkinsAffiliateId:"kai"} : null},
};
async function main() {
    resetNameResolverCache();
    const dean = {name:"Martin",office:"Associate Dean",evidence:"Associate Dean Martin"};
    assert.equal(universityNameLookup(dean,[kai]),"jhu Associate Dean Martin site:jhu.edu");
    assert.equal(universityNameLookup({name:"Marrow",evidence:"Marrow:"},[kai]),"jhu Marrow site:jhu.edu");
    assert.equal(universityNameLookup({name:"Kai",evidence:"Kai:"},[kai]),null);
    assert.equal(universityNameLookup({...dean,office:"Senator"},[kai]),null);
    assert.equal(hasUniversityTitle({name:"Martin",evidence:"Martin: I met the dean"}),false);
    assert.equal(hasUniversityTitle({name:"Martin",evidence:"Associate Dean Martin:"}),true);
    assert.deepEqual(await resolveAffiliates([dean],{text:"Present: Kai Martin",isCurrentSession:true,body:"senate"}),[null],
        "title wins over local Kai, poisoned office, and old alias");
    assert.deepEqual(await resolveAffiliates([{name:"Martin",evidence:"Martin:"}]),[null],
        "a bare surname alone cannot establish identity");
    assert.deepEqual(await resolveAffiliates([{...dean,office:"Senator"}]),["kai"]);
    assert.deepEqual(await resolveAffiliates([{name:"Kai",evidence:"Kai:"}]),["kai"]);
    assert.deepEqual(await resolveAffiliates([
        dean, {name:"Jessie Martin",office:"Associate Dean",evidence:"Guests: Associate Dean Jessie Martin"},
    ]),["jessie martin","jessie martin"], "explicit full name with a university title corroborates shorthand");
    // Full-name aliases are deliberately not provided in this fixture.
    const parsed = extractContributors("Guests: Associate Dean Martin", "Senate Minutes", "minutes.senate");
    assert.ok(parsed.some(p => nameKey(p.name) === "martin" && hasUniversityTitle(p)), JSON.stringify(parsed));
    assert.deepEqual(await resolveAffiliates(parsed,{text:"Kai Martin",isCurrentSession:true}),[null]);
    const mentioned = extractContributors("Arranging a meeting with Dean Martin about academic advising.", "Minutes", "minutes.senate");
    assert.ok(mentioned.some(p => p.name === "Martin" && p.role === "mentioned"));
    assert.ok(!mentioned.some(p => p.role === "present" || p.role === "guest"));
    console.log("University name safeguards passed");
}
main().catch(error => {console.error(error);process.exitCode=1;});
