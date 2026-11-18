import assert from "node:assert/strict";
import { expandCalendarYear } from "../lib/calendar-year";
import { documentDate } from "../lib/identity";
import { meetingDate } from "../lib/meetings";
import { archiveDateCandidates } from "../lib/archive-dates";

for (const [short, year] of [["79", 1979], ["81", 1981], ["90", 1990], ["91", 1991], ["92", 1992], ["99", 1999], ["00", 2000], ["26", 2026], ["39", 2039], ["40", 1940]] as const) {
    const text = `2/5/${short}`;
    const expected = `${year}-02-05`;
    assert.equal(expandCalendarYear(Number(short)), year);
    assert.equal(meetingDate(text), expected);
    assert.equal(documentDate({ title: `Council Notes ${text}` })?.toISOString().slice(0, 10), expected);
    assert.equal(documentDate({ title: "Council Notes", content: `Council Notes\n${text}` })?.toISOString().slice(0, 10), expected);
    if (year <= 2030) assert.equal(archiveDateCandidates("Council Notes", text)[0]?.date.slice(0, 10), expected);
}
assert.equal(meetingDate("2/5/2092"), "2092-02-05");
assert.equal(documentDate({ title: "Council Notes 2/5/1992" })?.toISOString().slice(0, 10), "1992-02-05");
assert.equal(documentDate({ title: "S-B.114.09.08.26-1" })?.toISOString().slice(0, 10), "2026-09-08");
console.log("Historical centuries, current dates, explicit years, and bill dates pass.");
