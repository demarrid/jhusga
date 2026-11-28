import assert from "node:assert/strict";
import { hasUniversityTitleNear, isClassReportLabel, isLinkableFullName, matchShortName, shortNameMentions, textNamesPerson, type ShortNamePerson } from "../lib/short-names";

const lou: ShortNamePerson = {
    id: "lou",
    name: "Sophia Lou",
    seats: [],
    appearances: [{
        sessionNumber: 106,
        datedAt: new Date("2018-09-29T12:00:00.000Z"),
        evidence: "Peabuddies\n\nSophia Lou",
    }],
};
const baleeiro: ShortNamePerson = {
    id: "baleeiro",
    name: "Sophia Baleeiro",
    seats: [{ startedAt: new Date("2026-06-01T12:00:00.000Z"), endedAt: null }],
    appearances: [],
};
const zhang: ShortNamePerson = {
    id: "zhang",
    name: "Sophia Zhang",
    seats: [{ startedAt: new Date("2026-06-01T12:00:00.000Z"), endedAt: null }],
    appearances: [],
};
const undated: ShortNamePerson = {
    ...baleeiro,
    id: "undated",
    seats: [{ startedAt: null, endedAt: new Date("2026-09-09T12:00:00.000Z") }],
};
const burnett: ShortNamePerson = {
    id: "burnett",
    name: "Sophia Burnett",
    seats: [],
    appearances: [{
        sessionNumber: 106,
        datedAt: new Date("2018-09-01T12:00:00.000Z"),
        evidence: "Introduced By: Sophia Burnett",
    }],
};
const amyXu: ShortNamePerson = {
    id: "amy-xu",
    name: "Amy Xu",
    seats: [{ startedAt: new Date("2025-06-01T12:00:00.000Z"), endedAt: new Date("2026-06-01T12:00:00.000Z") }],
    appearances: [],
};
const amyLi: ShortNamePerson = {
    id: "amy-li",
    name: "Amy Li",
    seats: [{ startedAt: new Date("2018-06-01T12:00:00.000Z"), endedAt: new Date("2019-06-01T12:00:00.000Z") }],
    appearances: [],
};

const minutes = [
    "Peabuddies - Sophia",
    "Had an outdoor event last night",
].join("\n");
const context = {
    asOf: new Date("2018-10-13T12:00:00.000Z"),
    sessionNumber: 106,
    text: minutes,
    evidence: "Peabuddies - Sophia",
};

const mentions = shortNameMentions(minutes, "MH Student Group Coalition Meeting", "minutes.executive");
assert.ok(mentions.some((mention) => mention.name === "Sophia" && mention.role === "mentioned"), JSON.stringify(mentions));

// The parser does not read an unbulleted dash remark; the AI pass does, and
// its surname reaches the linker. A full name it found is not a short name.
const remark = "Senator Bannister - motion to sign the letter";
const discovered = shortNameMentions(remark, "Senate Meeting #11", "minutes.senate", [
    { name: "Bannister", role: "interlocutor", evidence: remark },
    { name: "Miranda Bannister", role: "mentioned", evidence: remark },
]);
assert.deepEqual(discovered.map((mention) => `${mention.name}/${mention.role}`), ["Bannister/interlocutor"]);
const bannister: ShortNamePerson = {
    id: "bannister",
    name: "Miranda Bannister",
    seats: [],
    appearances: [{
        sessionNumber: 106,
        datedAt: new Date("2018-11-27T12:00:00.000Z"),
        evidence: "SGA Presenters: Miranda Bannister (‘20 Senator) and Madelynn Wellons (‘20 Senator)",
    }],
};
assert.equal(matchShortName("Bannister", [bannister, lou], {
    asOf: new Date("2018-12-04T12:00:00.000Z"),
    sessionNumber: 106,
    text: remark,
    evidence: remark,
})?.id, "bannister", "a seatless senator is matched from a full-name appearance that term");

const fall2018 = (id: string, name: string): ShortNamePerson => ({
    id, name, seats: [],
    appearances: [{ sessionNumber: 106, datedAt: new Date("2018-11-01T12:00:00.000Z"), evidence: `Present: ${name}` }],
});
const dec2018 = (evidence: string) => ({ asOf: new Date("2018-12-04T12:00:00.000Z"), sessionNumber: 106, text: evidence, evidence });
assert.equal(matchShortName("Sam", [fall2018("schatmeyer", "Sam Schatmeyer"), fall2018("mollin", "Samuel Mollin")],
    dec2018("Kudos to Sam and Madelynn for restarting the push")), null,
    "a Samuel around at the same time makes Sam ambiguous");
assert.equal(matchShortName("Sam", [fall2018("schatmeyer", "Sam Schatmeyer")], dec2018("Sam is the new co-chair"))?.id, "schatmeyer");
assert.equal(matchShortName("Kim", [fall2018("andy", "Andy Kim"), fall2018("hewitt", "Kim Hewitt")],
    dec2018("c. Communications & Marketing – Secretary Kim"))?.id, "andy", "a title makes the name a surname");

assert.equal(matchShortName("Wilson", [fall2018("woodrow", "Woodrow Wilson")],
    dec2018("met with Vice Provost Shollenberger, Dean Wilson, and Deputy Erin Yun. Woodrow Wilson")), null,
    "a dean's surname needs someone written in full under a university title");
const kumar: ShortNamePerson = { ...fall2018("kumar", "Sunil Kumar"), universityTitled: true };
assert.ok(hasUniversityTitleNear("University Provost, Sunil Kumar;", "Kumar"));
assert.ok(hasUniversityTitleNear("- **Dean, Whiting School of Engineering** — T. E. Schlesinger", "Schlesinger"));
assert.ok(!hasUniversityTitleNear("Woodrow Wilson was president of the United States", "Wilson"));
assert.equal(isLinkableFullName("kai isaac"), false);
assert.equal(matchShortName("Kumar", [kumar], dec2018("blessings from President Daniels and Provost Kumar"))?.id, "kumar");
assert.equal(matchShortName("Tim", [fall2018("tim", "Tim Huang"), fall2018("timothy", "Timothy Huang")],
    dec2018("Tim - motion to approve"))?.id, "tim", "Tim and Timothy Huang are one person, not two rivals");
assert.equal(matchShortName("Sam", [fall2018("schatmeyer", "Sam Schatmeyer"), fall2018("samira", "Samira Ibrahim")],
    dec2018("Sam is the new co-chair"))?.id, "schatmeyer", "Samira is not a Sam");
assert.equal(matchShortName("Grace", [fall2018("guan", "Grace Guan")], dec2018("Senator Grace - motion to approve"))?.id, "guan",
    "a senator called by first name, with no surname to match");

const noise ="Bill for national voter registration day event will go. Orem, 523 F.3d at 446; Cf. Wernert v. Green, 419 F. App’x 337. Dr. N";
assert.deepEqual(shortNameMentions(noise, "Notes", "notes", [
    { name: "Bill", role: "involved", evidence: "Bill for national voter registration day event will go" },
    { name: "Green", role: "mentioned", evidence: "Cf. Wernert v. Green, 419 F. App’x 337" },
    { name: "N", role: "mentioned", evidence: "Dr. N" },
]), [], "a noun, a case citation and an initial are not people");

for (const junk of ["President Stone Meng", "Dr. N", "Buse K", "Shawn (MP)", "Kevin X.", "Johns Hopkins"]) {
    assert.equal(isLinkableFullName(junk), false, junk);
}
for (const real of ["Miranda Bannister", "Dean Chien", "Calvin L. Smith Jr.", "T. E. Schlesinger"]) {
    assert.equal(isLinkableFullName(real), true, real);
}
assert.equal(matchShortName("Sophia", [lou, baleeiro, zhang, undated], context)?.id, "lou");
assert.equal(matchShortName("Sophia", [lou, burnett, baleeiro], context)?.id, "lou",
    "Peabuddies distinguishes two Sophias who were both around");
assert.equal(matchShortName("Sophia", [burnett, { ...lou, appearances: [{ ...lou.appearances[0]!, evidence: "Present: Sophia Lou" }] }], context), null);
assert.equal(matchShortName("Sophia", [baleeiro, zhang, undated], context), null);
assert.equal(matchShortName("Amy", [amyXu, amyLi], {
    asOf: new Date("2025-10-01T12:00:00.000Z"),
    sessionNumber: 113,
    text: "Amy: fundraising updates",
    evidence: "Amy: fundraising updates",
})?.id, "amy-xu");

const classes = "Freshmen: budgetary constraints\nSoph: met new advisor\nJuniors: athletics\n";
assert.equal(isClassReportLabel("Soph", classes), true);
assert.equal(matchShortName("Soph", [lou], {
    asOf: new Date("2020-02-17T12:00:00.000Z"),
    sessionNumber: 107,
    text: classes,
    evidence: "Soph: met new advisor",
}), null);

// Two people with the name in office: the meeting's other record settles it.
const meetingDay = { asOf: new Date("2026-11-20T12:00:00.000Z"), sessionNumber: 114, text: "Sophia: giving students a role", evidence: "Sophia: giving students a role" };
assert.equal(matchShortName("Sophia", [baleeiro, zhang], meetingDay), null);
assert.equal(matchShortName("Sophia", [baleeiro, zhang], { ...meetingDay, meetingPeople: new Set(["zhang"]) })?.id, "zhang");
assert.equal(matchShortName("Sophia", [baleeiro, zhang], { ...meetingDay, meetingPeople: new Set(["zhang", "baleeiro"]) }), null);

// "Jazz" is also the last word of an act's name; nobody by that surname was
// around, so the nickname still reaches Jazzlyn.
const act: ShortNamePerson = { id: "act", name: "NOT 2 COOL JAZZ", seats: [], appearances: [] };
const jazzlyn: ShortNamePerson = { id: "jazzlyn", name: "Jazzlyn Fernandez", seats: [{ startedAt: new Date("2026-06-01T12:00:00.000Z"), endedAt: null }], appearances: [] };
assert.equal(matchShortName("Jazz", [act, jazzlyn], { ...meetingDay, text: "Jazz: agreed", evidence: "Jazz: agreed" })?.id, "jazzlyn");

console.log("Short-name matching checks passed");

// Johns Hopkins's Woodrow Wilson Undergraduate Research Fellowship is not Woodrow Wilson being around.
{

    assert.equal(textNamesPerson("Apply for the Woodrow Wilson Undergraduate Research Fellowship", "Woodrow Wilson"), false);
    assert.equal(textNamesPerson("Woodrow Wilson Fellows presented; later Woodrow Wilson himself was quoted", "Woodrow Wilson"), true);
    const woodrow: ShortNamePerson = { id: "woodrow", name: "Woodrow Wilson", seats: [],
        appearances: [{ sessionNumber: 106, datedAt: new Date("2018-11-01T12:00:00.000Z"), evidence: "Woodrow Wilson Fellowship info session" }] };
    const near = { asOf: new Date("2018-12-04T12:00:00.000Z"), sessionNumber: 106, text: "Deans: Wilson, Ruzika, Moses", evidence: "Deans: Wilson, Ruzika, Moses" };
    assert.equal(matchShortName("Wilson", [woodrow], near), null, "a fellowship named after him is not an appearance");
}
assert.equal(matchShortName("Wilson", [{ id: "woodrow", name: "Woodrow Wilson", seats: [], onlyMentioned: true,
    appearances: [{ sessionNumber: 106, datedAt: new Date("2018-03-25T12:00:00.000Z"), evidence: "We hark back to the words of Woodrow Wilson" }] }],
    { asOf: new Date("2018-04-03T12:00:00.000Z"), sessionNumber: 106, text: "Met with Dean Wilson", evidence: "Met with Dean Wilson" }), null,
    "someone the archive only ever mentions needs their full name in this document");
