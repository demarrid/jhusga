import assert from "node:assert/strict";
import { findReviewedMentions, reviewedNote, type RosterEntry } from "../lib/reviewed-administrators";

const day = (iso: string) => new Date(`${iso}T00:00:00Z`);
const wilson: RosterEntry = {
    hopkinsAffiliateId: "wilson", title: "Dean of Student Development (until 2022)", source: "https://hub.jhu.edu/wilson",
    forms: [
        { text: "Andy Wilson", validFrom: null, validTo: day("2022-03-31") },
        { text: "Dean Wilson", validFrom: day("2015-07-01"), validTo: day("2022-03-31") },
    ],
};
const shollenberger: RosterEntry = {
    hopkinsAffiliateId: "kevin", title: "Vice Provost", source: "https://wellbeing.jhu.edu/kevin",
    forms: [{ text: "Shollenberger", validFrom: null, validTo: null }],
};
const roster = [wilson, shollenberger];
const ids = (document: Parameters<typeof findReviewedMentions>[0], credited?: Set<string>) =>
    findReviewedMentions(document, roster, credited).map(mention => mention.hopkinsAffiliateId);

assert.deepEqual(ids({ title: "Minutes", content: "Met with Dean Wilson", datedAt: day("2019-02-05") }), ["wilson"],
    "a dated form matches inside its window");
assert.deepEqual(ids({ title: "Minutes", content: "Met with Dean Wilson", datedAt: day("2025-02-05") }), [],
    "a dated form does not match after its holder left");
assert.deepEqual(ids({ title: "Minutes", content: "Met with Dean Wilson", datedAt: day("2022-03-31") }), ["wilson"],
    "the last day of a window is inside it");
assert.deepEqual(ids({ title: "Minutes", content: "Met with Dean Wilson" }), [],
    "a document with no date or session cannot use a dated form");
assert.deepEqual(ids({ title: "Minutes", content: "Met with Dean Wilson", sessionNumber: 106 }), ["wilson"],
    "an undated document matches when its whole session is inside the window");
assert.deepEqual(ids({ title: "Minutes", content: "Met with Dean Wilson", sessionNumber: 109 }), [],
    "an undated document whose session crosses the window's end does not match");
assert.deepEqual(ids({ title: "Minutes", content: "Shollenberger's office" }), ["kevin"],
    "an undated form matches anywhere, possessives included");
assert.deepEqual(ids({ title: "Minutes", content: "the Shollenbergers" }), [],
    "forms match whole words");
assert.deepEqual(ids({ title: "Minutes", content: "shollenberger" }), [],
    "forms match case-sensitively");
assert.deepEqual(ids({ title: "Meeting with Shollenberger", content: "" }), ["kevin"],
    "a title names people too");
assert.deepEqual(ids({ title: "Minutes", content: "Shollenberger", kind: "newsletter.article" }), [],
    "News-Letter articles are not credited");
assert.deepEqual(ids({ title: "Minutes", content: "Shollenberger and Andy Wilson", datedAt: day("2019-01-01") }, new Set(["kevin"])), ["wilson"],
    "a person the document already credits keeps that credit");

const [mention] = findReviewedMentions({ title: "Minutes", content: `${"x".repeat(400)} Shollenberger ${"y".repeat(400)}` }, roster);
assert.ok(mention!.evidence.length <= 300 && mention!.evidence.includes("Shollenberger"), "long lines are trimmed around the match");
assert.equal(mention!.note, reviewedNote(shollenberger));
assert.match(mention!.note, /Source: https:\/\/wellbeing\.jhu\.edu\/kevin\./);

console.log("reviewed-administrators checks passed");
