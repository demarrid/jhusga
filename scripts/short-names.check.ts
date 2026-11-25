import assert from "node:assert/strict";
import { isClassReportLabel, matchShortName, shortNameMentions, type ShortNamePerson } from "../lib/short-names";

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

console.log("Short-name matching checks passed");
