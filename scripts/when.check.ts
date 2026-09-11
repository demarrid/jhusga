/**
 * What the archive understands by a period.
 *
 *   npm run when:check
 *
 * The ranges in lib/when.ts are the whole reason "what happened last week"
 * returns anything, and they are pure functions of a question and a clock, so
 * they are worth pinning down without a database.
 */

import { parseTimeframe, withoutTimeframe } from "../lib/when";
import { questionTerms } from "../lib/terms";

/** A Friday, so "this week" has five days of it behind it. */
const NOW = new Date("2026-09-11T18:00:00.000Z");

const CASES: { question: string; label: string | null; start?: string; end?: string }[] = [
    { question: "what happened last week", label: "the past 7 days", start: "2026-09-05", end: "2026-09-12" },
    { question: "What happened in the past 7 days?", label: "the past 7 days", start: "2026-09-05", end: "2026-09-12" },
    { question: "anything from the last 3 weeks?", label: "the past 21 days", start: "2026-08-22", end: "2026-09-12" },
    { question: "what did the senate do last month", label: "the past 30 days", start: "2026-08-13", end: "2026-09-12" },
    { question: "what happened yesterday", label: "yesterday", start: "2026-09-10", end: "2026-09-11" },
    { question: "is there a meeting today", label: "today", start: "2026-09-11", end: "2026-09-12" },
    { question: "what has happened this week", label: "this week", start: "2026-09-06", end: "2026-09-12" },
    { question: "bills this month", label: "this month", start: "2026-09-01", end: "2026-09-12" },
    { question: "what happened in April 2026", label: "April 2026", start: "2026-04-01", end: "2026-05-01" },
    { question: "what was decided in April", label: "April 2026", start: "2026-04-01", end: "2026-05-01" },
    { question: "what has changed since January", label: "January 2026 onwards", start: "2026-01-01", end: "2026-09-12" },
    { question: "funding bills in 2025", label: "2025", start: "2025-01-01", end: "2026-01-01" },
    { question: "recent minutes", label: "the past 30 days", start: "2026-08-13", end: "2026-09-12" },
    { question: "what happened last semester", label: "last semester", start: "2026-01-01", end: "2026-08-01" },
    { question: "what happened over the last two years", label: "the past 2 years", start: "2024-09-12", end: "2026-09-12" },

    // Not periods. A month or a year only counts after a preposition, or the
    // 2026 budget bill becomes a question about everything filed in 2026.
    { question: "how many caucus senators can there be", label: null },
    { question: "what does the 2026 budget fund", label: null },
    { question: "who spoke at the march on campus", label: null },
    { question: "what does it take to amend the constitution", label: null },
];

/** Baltimore's calendar day for an instant, which is what the ranges are in. */
function day(date: Date): string {
    return date.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

let failures = 0;

for (const test of CASES) {
    const timeframe = parseTimeframe(test.question, NOW);

    const actual = timeframe
        ? `${timeframe.label} [${day(timeframe.start)} .. ${day(timeframe.end)})`
        : "none";
    const expected = test.label
        ? `${test.label} [${test.start} .. ${test.end})`
        : "none";

    const ok = actual === expected;
    if (!ok) failures += 1;

    console.log(`${ok ? "ok  " : "FAIL"} ${test.question}`);
    if (!ok) console.log(`       expected ${expected}\n       actual   ${actual}`);

    // The words that named the period must not also be searched for, or the
    // question is answered with every passage containing "week".
    if (timeframe) {
        const terms = questionTerms(withoutTimeframe(test.question, timeframe));
        console.log(`       terms: ${terms.length > 0 ? terms.join(", ") : "(none)"}`);
    }
}

console.log(`\n${CASES.length - failures}/${CASES.length} passed`);
process.exitCode = failures > 0 ? 1 : 0;
