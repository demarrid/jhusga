import assert from "node:assert/strict";

import { historyTopic } from "../config/history";
import { readBillVotingRecords } from "../lib/bill-votes";
import { formatDate } from "../lib/dates";
import {
    academicYearKey,
    academicYearLabel,
    eventSpan,
    historyDateLabel,
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

console.log("all history checks passed");
