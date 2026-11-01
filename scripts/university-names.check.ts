import assert from "node:assert/strict";
import { extractContributors, nameKey } from "../lib/contributors";
import { resolveAffiliates, resetNameResolverCache, universityNameLookup, hasUniversityTitle, administratorMentionContext, type RegularPerson } from "../lib/names";

const kai = { id: "kai", name: "Kai Martin", nameKey: "kai martin", documentCount: 5,
    positions: ["Senator", "Associate Dean"], bodies: ["senate"] } satisfies RegularPerson;
const julia = { id: "julia", name: "Julia Lee", nameKey: "julia lee", documentCount: 5,
    positions: ["Senator"], bodies: ["senate"] } satisfies RegularPerson;
const jackson = { id: "jackson", name: "Jackson Morris", nameKey: "jackson morris", documentCount: 5,
    positions: ["Senator"], bodies: ["senate"] } satisfies RegularPerson;
const people = new Map<string, {id:string;name:string;nameKey:string}>([
    ["kai martin", kai], ["julia lee", julia], ["jackson morris", jackson],
]);
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
    const meeting = extractContributors("martin: discussing academic advising", "10/29 - Meeting with Associate Dean Martin", "minutes.committee");
    assert.ok(!meeting.some(p => p.role === "author"), "meeting subjects are not authors");
    assert.ok(meeting.some(p => p.name === "Martin" && p.role === "interlocutor"));
    assert.ok(administratorMentionContext({name:"Martin",evidence:"martin: can give you information"}, {
        administratorText:"academic advising\n\nmartin:  can give you information",
    }).includes("academic advising"), "export whitespace must not discard lookup context");

    const transcript = [
        "Hernandez: Good evening, everyone. I am Rachel Hernandez, Vice Provost for Student Affairs. Thank you.",
        "julia: i am the interim assistant vice provosta nd title ix operator",
        "Boyd: I am Linda Boyd, interim Vice Provost for Institutional Equity.",
        "jim braylor: i'm associate vice provost for international student scholar services at",
        "Calvin Smith: Good evening, everyone. I am here from Public Safety on behalf of Bard.",
        "   1. Jarron Jackson (Assistant Vice President for Public Safety)",
        "   2. Sienna Kim (Director of Communications)",
        "julia: i feel very aligned with students",
    ].join("\n");
    const spoken = extractContributors(transcript, "Senate Minutes", "minutes.senate");
    const said = (name: string) => spoken.find(p => p.name === name);
    for (const name of ["Hernandez", "Julia", "Boyd"]) {
        assert.ok(said(name) && hasUniversityTitle(said(name)!), `${name} keeps the office they introduced: ${JSON.stringify(said(name))}`);
    }
    assert.match(said("Boyd")!.office ?? "", /Vice Provost for Institutional Equity/i);
    assert.equal(spoken.filter(p => p.name === "Julia").length, 1, "one first name is one mention per document");
    assert.deepEqual(await resolveAffiliates([said("Julia")!], {text:"Present: Julia Lee", isCurrentSession:true, body:"senate"}), [null],
        "an introduced administrator's first name never falls through to a senator");
    assert.deepEqual(await resolveAffiliates([{name:"Julia",evidence:"julia: i feel very aligned with students",onlyIfKnown:true}],
        {text:"Present: Julia Lee", isCurrentSession:true, body:"senate"}), ["julia"], "a senator's own turn still resolves");
    assert.equal(said("Jim Braylor")?.onlyIfKnown, false, "a full name with a title is believed");
    assert.equal(said("Calvin Smith")?.onlyIfKnown, false, "a greeting before the introduction still introduces");
    assert.equal(spoken.find(p => p.name === "Jarron Jackson")?.role, "guest");
    resetNameResolverCache();
    assert.deepEqual(await resolveAffiliates([
        {name:"Jarron Jackson",role:"guest",office:"Assistant Vice President for Public Safety",
            evidence:"Jarron Jackson (Assistant Vice President for Public Safety)"},
        {name:"Jackson",evidence:"Jackson : What can we do as SGA",onlyIfKnown:true},
    ], {text:"Jarron Jackson (Assistant Vice President for Public Safety)\nJackson : What can we do as SGA",
        isCurrentSession:true, body:"senate"}), ["jarron jackson","jackson"],
        "a speaker's first name is the senator, not a visitor's surname");
    assert.ok(!spoken.some(p => p.name === "Sienna Kim" && p.role === "guest"), "SGA offices are not visiting administrators");
    assert.ok(!extractContributors("martin: I am glad the dean said yes", "Senate Minutes", "minutes.senate")
        .some(p => p.office), "a remark about a dean is not an introduction");
    console.log("University name safeguards passed");
}
main().catch(error => {console.error(error);process.exitCode=1;});
