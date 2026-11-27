import assert from "node:assert/strict";

import { layoutFlags, type Flag, type FlagEvent } from "../app/history/[slug]/flags";
import { historyTopic } from "../config/history";
import { readBillVotingRecords } from "../lib/bill-votes";
import { formatDate } from "../lib/dates";
import {
    academicYearKey,
    academicYearLabel,
    eventLabel,
    eventSpan,
    eventSummary,
    historyDateLabel,
    historyLabel,
    historySpanLabel,
    legislationOutcome,
    matchesTopic,
    parseFindingItem,
    resolveFindingDate,
    topicExcerpt,
    topicPatterns,
    type OutcomeSource,
} from "../lib/history";

const topic = historyTopic("sexual-violence");
assert.ok(topic, "the sexual violence topic is registered");
const patterns = topicPatterns(topic);
const threadIds = topic.threads.map((thread) => thread.id);

// Candidates ------------------------------------------------------------------

for (const text of [
    "a resolution on Title IX procedures",
    "Sexual Assault Awareness Month",
    "funding for SARU training",
    "the It’s On Us campaign",
    "It's On Us week",
    "support for survivors",
    "Denim Day tabling",
    "bystander intervention workshop",
    "dating violence prevention",
    "the Office of Institutional Equity",
]) {
    assert.ok(matchesTopic(text, patterns), `matches: ${text}`);
}
for (const text of [
    "grape juice for the general body meeting",
    "we will pave the way for the budget",
    "a consensus on the parking motion",
    "violence in the film series",
    "the saru acronym in lower case is not the group",
]) {
    assert.ok(!matchesTopic(text, patterns), `does not match: ${text}`);
}
assert.ok(patterns.postgres.insensitive.startsWith("\\y(?:"), "PostgreSQL word boundaries are \\y");
assert.ok(patterns.postgres.sensitive?.includes("SARU"));
for (const kind of ["resume", "guiding.bylaws", "survey", "application"]) {
    assert.ok(topic.excludeKinds.includes(kind), `${kind} documents are not candidates`);
}

// Excerpts --------------------------------------------------------------------

const short = "Minutes\n\nThe Senate discussed Title IX.";
assert.equal(topicExcerpt(short, patterns), short, "short documents are read whole");

const filler = (index: number) => `Paragraph ${index}. ${"The Senate discussed the parking budget at length. ".repeat(12)}`;
const paragraphs = Array.from({ length: 80 }, (_, index) => filler(index));
paragraphs[41] = "Senator Doe moved to fund SARU's spring Title IX training. The motion was seconded.";
paragraphs[42] = "The motion passed 20-1-0.";
const long = paragraphs.join("\n\n");
assert.ok(long.length > 20_000);
const excerpt = topicExcerpt(long, patterns);
assert.ok(excerpt.length < long.length);
assert.ok(excerpt.includes("Title IX training"), "the matching passage is read");
assert.ok(excerpt.includes("The motion passed 20-1-0."), "its neighbour is read, for the result");
for (const slice of excerpt.split("\n\n[…]\n\n")) {
    assert.ok(long.includes(slice), "every excerpt slice is verbatim from the document");
}

// Findings --------------------------------------------------------------------

const finding = parseFindingItem(
    {
        summary: "The Senate funded SARU training.",
        quote: "fund SARU's spring Title IX training",
        date: "2019-03-04",
        thread: "prevention",
        kind: "funding",
        involvement: "sga",
        outcome: "passed",
        weight: 7,
    },
    threadIds,
);
assert.deepEqual(finding, {
    summary: "The Senate funded SARU training.",
    quote: "fund SARU's spring Title IX training",
    statedDate: "2019-03-04",
    thread: "prevention",
    kind: "funding",
    involvement: "sga",
    outcomeClaim: "",
    weight: 3,
});
assert.equal(
    parseFindingItem({ summary: "x", quote: "y", kind: "legislation", outcome: "passed" }, threadIds)?.outcomeClaim,
    "passed",
    "only legislation carries an outcome claim",
);
assert.equal(parseFindingItem({ summary: "x", quote: "y", thread: "made-up" }, threadIds)?.thread, threadIds.at(-1));
assert.equal(parseFindingItem({ summary: "x", quote: "y", date: "March 2019" }, threadIds)?.statedDate, null);
assert.equal(parseFindingItem({ summary: "x", quote: "y", kind: "rumour" }, threadIds)?.kind, "discussion");
assert.equal(parseFindingItem({ summary: "x", quote: "  " }, threadIds), null, "a finding needs a quote");
assert.equal(parseFindingItem("nonsense", threadIds), null);

// Dates -----------------------------------------------------------------------

const noon = (iso: string) => new Date(`${iso}T12:00:00.000Z`);
const minutes = { id: "history-check-minutes", datedAt: noon("2019-03-12"), driveCreatedTime: null, sessionNumber: 106 };

assert.deepEqual(resolveFindingDate(null, minutes), { date: noon("2019-03-12"), precision: "day" });
assert.deepEqual(
    resolveFindingDate("2014-10-02", minutes),
    { date: noon("2014-10-02"), precision: "day" },
    "a recounted event keeps its own date",
);
assert.deepEqual(
    resolveFindingDate("2019-03", minutes),
    { date: noon("2019-03-12"), precision: "day" },
    "the document's day refines a stated month it falls in",
);
assert.deepEqual(
    resolveFindingDate("2018", minutes),
    { date: noon("2018-07-01"), precision: "year" },
    "a stated year the document falls outside of wins, however coarse",
);
assert.deepEqual(
    resolveFindingDate("2024-04-01", minutes),
    { date: noon("2019-03-12"), precision: "day" },
    "nothing recounts the distant future",
);
assert.deepEqual(resolveFindingDate("2019-02-30", minutes), { date: noon("2019-03-12"), precision: "day" });
assert.deepEqual(resolveFindingDate("1850", minutes), { date: noon("2019-03-12"), precision: "day" });
assert.deepEqual(
    resolveFindingDate(null, { id: "history-check-undated", datedAt: null, driveCreatedTime: null, sessionNumber: 106 }),
    { date: noon("2018-12-01"), precision: "session" },
    "an undated document sits mid-session",
);
assert.deepEqual(
    resolveFindingDate(null, {
        id: "history-check-drive",
        datedAt: null,
        driveCreatedTime: noon("2020-09-09"),
        sessionNumber: null,
    }),
    { date: noon("2020-09-09"), precision: "approximate" },
);

// A year-only document is stored as 1 January (config/archive-date-precision.json).
// The model sees that stored date, and echoing it back must not make it a day.
const yearOnly = {
    id: "11413b45-6905-4f67-ad00-94ce050447ab",
    datedAt: noon("1982-01-01"),
    driveCreatedTime: null,
    sessionNumber: null,
};
const yearOnlyOwn = { date: noon("1982-07-01"), precision: "year" };
assert.deepEqual(resolveFindingDate(null, yearOnly), yearOnlyOwn);
assert.deepEqual(resolveFindingDate("1982-01-01", yearOnly), yearOnlyOwn, "an echoed stored day stays the year");
assert.deepEqual(resolveFindingDate("1982-01", yearOnly), yearOnlyOwn, "an echoed stored month stays the year");
assert.deepEqual(
    resolveFindingDate("1982-03-04", yearOnly),
    { date: noon("1982-03-04"), precision: "day" },
    "a different day the text states still wins",
);
assert.deepEqual(resolveFindingDate("1979", yearOnly), { date: noon("1979-07-01"), precision: "year" });

// A document the archive dated only to a session ("2026/2027") is stored at the
// session's opening, 1 June; that is not a day anything happened.
const sessionOnly = {
    id: "history-check-session-only",
    datedAt: noon("2026-06-01"),
    driveCreatedTime: null,
    sessionNumber: 114,
    datedOnlyTo: "session" as const,
};
const sessionOnlyOwn = { date: noon("2026-12-01"), precision: "session" };
assert.deepEqual(resolveFindingDate(null, sessionOnly), sessionOnlyOwn, "a session-only date stays the session");
assert.deepEqual(resolveFindingDate("2026-06-01", sessionOnly), sessionOnlyOwn, "an echoed opening day stays the session");
assert.deepEqual(
    resolveFindingDate("2026-11-08", sessionOnly),
    { date: noon("2026-11-08"), precision: "day" },
    "a day the text states still wins",
);
assert.deepEqual(
    resolveFindingDate(null, { ...sessionOnly, datedOnlyTo: undefined }),
    { date: noon("2026-06-01"), precision: "day" },
    "an ordinary 1 June date is a day",
);
// Month-only ("2018-06") and year-only ("2026") AI dates anchor at the 1st and 1 January.
assert.deepEqual(
    resolveFindingDate(null, { ...sessionOnly, datedAt: noon("2018-06-01"), datedOnlyTo: "month" as const }),
    { date: noon("2018-06-15"), precision: "month" },
    "a month-only date stays the month",
);
assert.deepEqual(
    resolveFindingDate("2018-06-01", { ...sessionOnly, datedAt: noon("2018-06-01"), datedOnlyTo: "month" as const }),
    { date: noon("2018-06-15"), precision: "month" },
    "an echoed first of the month stays the month",
);
assert.deepEqual(
    resolveFindingDate(null, { ...sessionOnly, datedAt: noon("2026-01-01"), datedOnlyTo: "year" as const }),
    { date: noon("2026-07-01"), precision: "year" },
    "a year-only date stays the year",
);
// A finding extracted while its document sat at the session-start anchor keeps
// stating 1 June after the document is re-dated; the anchor is not a date.
assert.deepEqual(
    resolveFindingDate("2018-06-01", { id: "history-check-redated", datedAt: noon("2018-06-04"), driveCreatedTime: null, sessionNumber: 106 }),
    { date: noon("2018-06-04"), precision: "day" },
    "a stale session-start echo yields to the document's own date",
);

assert.deepEqual(
    eventSpan([
        { date: noon("2019-02-01"), precision: "approximate" },
        { date: noon("2019-03-04"), precision: "day" },
        { date: noon("2019-03-11"), precision: "day" },
        { date: noon("2019-01-15"), precision: "month" },
    ]),
    { occurredAt: noon("2019-03-04"), endedAt: noon("2019-03-11"), precision: "day" },
    "only the most precise dates set an event's span",
);
assert.deepEqual(
    eventSpan([
        { date: noon("2019-03-04"), precision: "day" },
        { date: noon("2019-03-05"), precision: "day" },
    ]).endedAt,
    null,
    "a day apart is one date, not a span",
);
assert.deepEqual(eventSpan([{ date: null, precision: "approximate" }]), {
    occurredAt: null,
    endedAt: null,
    precision: "approximate",
});

assert.equal(academicYearKey(noon("2019-05-31")), "2018-2019");
assert.equal(academicYearKey(noon("2019-06-01")), "2019-2020");
assert.equal(academicYearKey(null), "undated");
assert.deepEqual(resolveFindingDate(null, {
    id: "2c260844-f5e7-4de2-b8fe-505abdd9c23b", datedAt: null, driveCreatedTime: null, sessionNumber: null,
}), { date: noon("1989-07-01"), precision: "year" }, "reviewed contextual dating places the undated Council report without inventing a month or day");
assert.deepEqual(resolveFindingDate("1990-02-01", {
    id: "2c260844-f5e7-4de2-b8fe-505abdd9c23b", datedAt: null, driveCreatedTime: null, sessionNumber: null,
}), { date: noon("1990-02-01"), precision: "day" }, "a stated event date takes precedence over the report's contextual estimate");
assert.equal(academicYearLabel("2018-2019"), "2018–19");
assert.equal(academicYearLabel("undated"), "Undated");

assert.equal(historyDateLabel(noon("1998-07-01"), "year"), "1998", "a year is never shown as a day");
assert.equal(historyDateLabel(noon("2018-12-01"), "session"), "2018–19 session");
assert.equal(historyDateLabel(noon("2019-03-12"), "day"), formatDate(noon("2019-03-12")));
assert.ok(historyDateLabel(noon("2020-09-09"), "approximate").startsWith("About "));
assert.equal(historyDateLabel(null, "day"), "Undated");
assert.equal(historySpanLabel(noon("1998-07-01"), noon("1999-07-01"), "year"), "1998 – 1999");

// Outcomes --------------------------------------------------------------------

const sheet = (rows: string) => `\fSecond Reading\nDate,Bill #,Link,Status\n${rows}`;
const register = readBillVotingRecords(
    sheet(
        "3/12/2019,1,Title IX Transparency Act,Adopted\n" +
            "3/12/2019,2,Survivor Fund Act,Rejected\n" +
            ",3,Consent Week Resolution,Adopted\n,3,Consent Week Resolution,Tabled",
    ),
);
const bill = (title: string, outcomeClaim: OutcomeSource["outcomeClaim"] = ""): OutcomeSource => ({
    kind: "bill.senate",
    driveFileId: `file-${title}`,
    title,
    displayTitle: title,
    outcomeClaim,
});
const record = (kind: string, outcomeClaim: OutcomeSource["outcomeClaim"]): OutcomeSource => ({
    kind,
    driveFileId: `file-${kind}-${outcomeClaim}`,
    title: "Minutes",
    displayTitle: "Minutes",
    outcomeClaim,
});

assert.equal(legislationOutcome("funding", [bill("Title IX Transparency Act")], register), "");
assert.equal(legislationOutcome("legislation", [bill("Title IX Transparency Act")], register), "passed");
assert.equal(legislationOutcome("legislation", [bill("Survivor Fund Act")], register), "not_passed");
assert.equal(
    legislationOutcome("legislation", [bill("Title IX Transparency Act"), record("minutes.senate", "passed")], register),
    "passed",
);
assert.equal(
    legislationOutcome(
        "legislation",
        [bill("Title IX Transparency Act"), record("minutes.senate", "not_passed")],
        register,
    ),
    "inconclusive",
    "the register and the minutes disagreeing is inconclusive",
);
assert.equal(legislationOutcome("legislation", [bill("Consent Week Resolution")], register), "inconclusive");
assert.equal(
    legislationOutcome("legislation", [bill("Unregistered Act"), record("minutes.senate", "passed")], register),
    "passed",
    "the Senate's minutes decide when the register is silent",
);
assert.equal(
    legislationOutcome(
        "legislation",
        [bill("Unregistered Act"), record("minutes.senate", "passed"), record("minutes.senate", "not_passed")],
        register,
    ),
    "inconclusive",
);
assert.equal(
    legislationOutcome(
        "legislation",
        [bill("Unregistered Act", "passed"), record("minutes.committee", "passed"), record("newsletter", "passed")],
        register,
    ),
    "unrecorded",
    "a bill's own text, committees, and reporting never establish adoption",
);
const clerpa = readBillVotingRecords(
    sheet(
        "9/8/2026,4,Clarifying Legislative Roles and Processess Act (CLeRPA),Adopted\n" +
            "9/15/2026,4,Clarifying Legislative Roles and Processess Act (CLeRPA),Tabled",
    ),
);
const clerpaBill = {
    ...bill("S-B.114.09.01.26-4 | Clarifying Legislative Roles and Processess Act (CLeRPA)"),
    kind: "bill.bylaws_amendment",
    driveFileId: "1bTvh4LaIvFiHSudl3pKimPpEYjbloTs2Y5NP-S0dCiI",
};
assert.equal(
    legislationOutcome("legislation", [{ ...clerpaBill, driveFileId: "other-copy" }], clerpa),
    "not_passed",
    "a later tabled row is the register result",
);
assert.equal(
    legislationOutcome("legislation", [clerpaBill], clerpa),
    "passed",
    "reviewed confirmation of S-B.114.09.01.26-4 overrides the later tabled row",
);

console.log("all history checks passed");

// Reviewed dates stay specific to quoted projects, even when extraction guesses
// a spreadsheet member-heading date. Unrelated rows retain normal resolution.
const workLog = { id: '203da8e0-2ec3-443b-880c-fc9cbe26c220', datedAt: null, driveCreatedTime: null, sessionNumber: null };
for (const quote of ['jumpstarted collaboration with CHEW', 'foundations for an anonymous blog', 'reached out to SARU', 'interactive resources flowchart']) {
    const dated = resolveFindingDate('2020-09-29', workLog, quote);
    assert.equal(dated.precision, 'month');
    assert.equal(dated.date?.toISOString(), '2021-04-15T12:00:00.000Z');
}
assert.equal(resolveFindingDate(null, workLog, 'FSL OIE Investigation Team - attending meetings').precision, 'session');
assert.equal(resolveFindingDate(null, workLog, 'Unrelated project').date, null);
assert.equal(resolveFindingDate(null, workLog, 'Requested that a special forum be held to discuss the drugging allegations').date?.toISOString(), '2020-11-15T12:00:00.000Z');
assert.equal(resolveFindingDate(null, { ...workLog, id: '243b8b92-fdd0-40f8-9531-8b4c2fa84a31' }, 'Sexual Assault Resources/OIE Reform').date?.toISOString(), '2019-10-29T12:00:00.000Z');

// Timeline flags --------------------------------------------------------------

assert.equal(historyLabel("New SBP."), "New SBP");
assert.equal(historyLabel("  CSE   constitution update "), "CSE constitution update");
assert.equal(historyLabel("A label of far more than four words"), "", "a wordy label is dropped");
assert.equal(eventLabel("Petition", "Students petition the university for an advocate"), "Petition");
assert.equal(eventLabel("", "The resolution on Title IX hearing procedures"), "Resolution on Title IX");
assert.equal(eventLabel("", "Funding for a survivor support peer group"), "Funding for a survivor", "only four words");
assert.equal(eventLabel("", "Bill to publish annual misconduct data"), "Bill to publish annual");
assert.equal(eventLabel("", "petition of the"), "Petition", "no dangling small words");
assert.equal(
    eventSummary("The Senate debated it [1]. Senators cited minutes [1][2].\n\nThe date comes from a review."),
    "The Senate debated it. Senators cited minutes.",
);

const flagMeasure = (text: string, font: string) => text.length * Number.parseFloat(font.split(" ")[1]!) * 0.56;
const flagEvents = (count: number, years: number): FlagEvent[] =>
    Array.from({ length: count }, (_, index) => ({
        id: `flag-${index}`,
        start: Date.UTC(1990, 0, 1) + ((index * 7919) % count) * ((years * 365 * 86_400_000) / count),
        dateLabel: "Mar 4, 2004",
        title: `Senate resolution number ${index} on hearing procedures and support`,
        label: `Resolution ${index}`,
        summary: "A committee presented survey results to the Senate and recommended a follow-up review.",
        weight: ((index % 3) + 1) as 1 | 2 | 3,
    })).sort((a, b) => a.start - b.start);

function layOut(events: FlagEvent[], width: number, maxHeight = 240) {
    const start = events[0]!.start;
    const span = events.at(-1)!.start - start || 1;
    const toX = (time: number) => 20 + ((time - start) / span) * (width - 40);
    const flags = layoutFlags({ events, toX, usable: width, maxAbove: maxHeight, maxBelow: maxHeight, measure: flagMeasure, compact: false });
    return { flags, maxHeight, width };
}

// Each side of the axis is its own stack: boxes and poles only meet flags on the same side.
function assertClear({ flags, maxHeight, width }: { flags: Flag[]; maxHeight: number; width: number }, name: string) {
    for (const flag of flags) {
        assert.ok(flag.y >= 0 && flag.y + flag.height <= maxHeight, `${name}: ${flag.key} fits the height`);
        assert.ok(flag.poleX >= -flag.width && flag.poleX <= width, `${name}: ${flag.key}'s pole is near the track`);
        assert.equal(flag.left, flag.poleX - 1, `${name}: ${flag.key} starts at its pole and is clipped, not pushed in`);
        for (const other of flags) {
            if (other === flag || other.side !== flag.side) continue;
            const apart =
                flag.left + flag.width <= other.left || other.left + other.width <= flag.left ||
                flag.y + flag.height <= other.y || other.y + other.height <= flag.y;
            assert.ok(apart, `${name}: ${flag.key} and ${other.key} do not overlap`);
            const crosses = other.poleX >= flag.left && other.poleX <= flag.left + flag.width && other.y > flag.y;
            assert.ok(!crosses, `${name}: ${other.key}'s pole does not run through ${flag.key}`);
        }
    }
    const shown = new Set(flags.flatMap((flag) => flag.group.events.map((event) => event.id)));
    return shown.size;
}

// A few events far apart each get a full flag with their description.
const sparse = layOut(flagEvents(4, 40), 1400);
assertClear(sparse, "sparse");
assert.equal(sparse.flags.length, 4);
assert.ok(sparse.flags.every((flag) => flag.type === "event" && flag.mode === "full" && flag.descLines > 0));

// Neighbours that would stack fan out to both sides of the axis.
const pair = layOut(flagEvents(2, 1), 1400);
assert.deepEqual(new Set(pair.flags.map((flag) => flag.side)), new Set(["above", "below"]));

// Crowded timelines fall back to lists, labels, and counts, but never overlap and still account for every event.
for (const [count, width] of [[40, 1400], [150, 1400], [400, 1400], [150, 360]] as const) {
    const crowded = layOut(flagEvents(count, 30), width);
    const shown = assertClear(crowded, `${count} events at ${width}px`);
    assert.ok(crowded.flags.some((flag) => flag.type !== "event" || flag.mode !== "full"), `${count} events are simplified`);
    assert.ok(shown >= count * 0.9, `${count} events at ${width}px: ${shown} are on a flag`);
}
