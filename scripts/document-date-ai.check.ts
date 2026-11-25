import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { documentDateText } from "../lib/dates";
import {
    acceptedDocumentDate,
    documentDateSourceHash,
    resolveRecordedDate,
    sessionYearMap,
    validateDocumentDate,
    type DateSource,
} from "../lib/document-date-ai";
import { normalizedDateLabel, normalizedDateSortAnchor } from "../lib/document-date-value";

const source = (overrides: Partial<DateSource> = {}): DateSource => ({
    title: "SGA Constitution thru 23",
    content: "The Johns Hopkins University Undergraduate Student Government Association Constitution\nRatified: May 4, 2015",
    kind: "guiding.constitution",
    folderPath: "112th SGA Master Folder",
    sessionNumber: 112,
    ...overrides,
});

function proposal(value: string | null, basis: "source" | "session" | "uncertain", evidence: string[], reason = "Supported by the document.") {
    return { value, basis, evidence, reason };
}

async function main() {
    const map = sessionYearMap();
    assert.equal(map["1"], "1913/1914");
    assert.equal(map["112"], "2024/2025");
    assert.equal(map["114"], "2026/2027");

    const constitution = source();
    assert.equal(validateDocumentDate(proposal("2015-05-04", "source", ["Ratified: May 4, 2015"]), constitution).value, "2015-05-04");
    assert.equal(validateDocumentDate(proposal("2015-05", "source", ["Ratified: May 4, 2015"]), constitution).value, "2015-05");
    assert.equal(validateDocumentDate(proposal("2015", "source", ["Ratified: May 4, 2015"]), constitution).value, "2015");
    assert.equal(validateDocumentDate(proposal(null, "uncertain", [], "The dates conflict."), constitution).value, null);

    const dated = source({ content: "Issued May 2015.", title: "Notice" });
    assert.equal(validateDocumentDate(proposal("2015-05", "source", ["Issued May 2015"]), dated).value, "2015-05");
    assert.throws(() => validateDocumentDate(proposal("2015-05-04", "source", ["Issued May 2015"]), dated), /Exact date/);
    assert.equal(validateDocumentDate(proposal("2015-09-04", "source", ["Sept. 4, 2015"]), source({ content: "Sept. 4, 2015" })).value, "2015-09-04");
    assert.equal(validateDocumentDate(
        proposal("2026-04-21", "source", ["CONSIDERED THIS 21ST DAY OF APRIL IN THE YEAR 2026"]),
        source({ content: "CONSIDERED THIS 21ST DAY OF APRIL IN THE YEAR 2026", sessionNumber: 114 }),
    ).value, "2026-04-21");

    const shortYear = source({ content: "Minutes\nMay 4, 15", sessionNumber: 103, title: "Minutes" });
    assert.equal(validateDocumentDate(proposal("2015-05-04", "source", ["May 4, 15"]), shortYear).value, "2015-05-04");
    assert.throws(() => validateDocumentDate(proposal("2015-05-04", "source", ["May 4, 15"]), { ...shortYear, sessionNumber: null }), /Exact date/);
    assert.throws(() => validateDocumentDate(proposal("2015", "source", ["See page 15"]), source({ content: "See page 15", title: "Notes" })), /Year is not supported/);
    assert.throws(() => validateDocumentDate(proposal("2016", "source", ["Academic year 2016-2017"]), source({ content: "Academic year 2016-2017", title: "Collection" })), /cannot be collapsed/);
    assert.throws(() => validateDocumentDate(proposal("2015-04-05", "source", ["Meeting 4/5/2015"]), source({ content: "Meeting 4/5/2015", title: "Notes" })), /Exact date/);
    assert.throws(() => validateDocumentDate(proposal("2015-05-09", "source", ["Ratified: May 4, 2015"]), constitution), /Exact date/);
    assert.throws(() => validateDocumentDate(proposal("2015-05-04", "source", ["Invented: May 4, 2015"]), constitution), /exact source evidence/);

    assert.equal(validateDocumentDate(proposal("2024/2025", "session", []), source({ content: "A filed copy with no date.", title: "Copy" })).value, "2024/2025");
    assert.throws(() => validateDocumentDate(proposal("2023/2024", "session", []), source({ content: "A filed copy with no date.", title: "Copy" })), /known session/);
    assert.throws(() => validateDocumentDate(proposal("2024/2025", "session", []), constitution), /source states a date/);
    assert.throws(() => validateDocumentDate(proposal("2024/2025", "session", []), source({ content: "Covering 2016-2017.", title: "Span" })), /source states a date/);

    const filed = source({ content: "A filed copy with no date.", title: "Copy" });
    const hash = documentDateSourceHash(filed);
    assert.equal(acceptedDocumentDate({ ...filed, aiDateValue: "2024/2025", aiDateSourceHash: hash }), "2024/2025");
    assert.equal(acceptedDocumentDate({ ...filed, aiDateValue: "2024/2025", aiDateSourceHash: hash, content: "Changed" }), null);
    assert.equal(normalizedDateLabel("2024/2025"), "2024\u20132025 session");
    assert.equal(normalizedDateLabel("2015"), "2015");
    assert.equal(normalizedDateLabel("2015-05"), "May 2015");
    assert.equal(normalizedDateSortAnchor("2024/2025")?.toISOString(), "2024-06-01T12:00:00.000Z");
    assert.equal(normalizedDateSortAnchor("2015")?.toISOString(), "2015-01-01T12:00:00.000Z");

    const shown = documentDateText({ id: "fresh", datedAt: new Date("2015-01-01T12:00:00.000Z"), aiDateValue: "2015" });
    assert.equal(shown?.text, "2015");
    assert.equal(shown?.note, "Source establishes the year only; the exact day is unknown.");
    const archived = documentDateText({ id: "03ca3bc2-fa35-44dd-8c9e-bda34af5e106", datedAt: new Date("2016-01-01T12:00:00.000Z") });
    assert.equal(archived?.text, "2016");
    const exact = documentDateText({ id: "fresh", datedAt: normalizedDateSortAnchor("2015-05-04"), aiDateValue: "2015-05-04" });
    assert.equal(exact?.text, "May 4, 2015");
    assert.equal(exact?.note, null);

    const accepted = { ...filed, datedAt: null, aiDateValue: "2024/2025", aiDateSourceHash: hash };
    assert.equal(resolveRecordedDate(accepted).datedAt?.toISOString(), "2024-06-01T12:00:00.000Z");
    assert.equal(resolveRecordedDate(accepted).clearAi, false);
    assert.equal(resolveRecordedDate({ ...accepted, passageOn: "2019-04-02" }).datedAt?.toISOString(), "2024-06-01T12:00:00.000Z");
    const stale = resolveRecordedDate({ ...filed, datedAt: new Date("2024-06-01T12:00:00.000Z"), aiDateValue: "2024/2025", aiDateSourceHash: "stale", kind: "minutes.senate" });
    assert.equal(stale.datedAt, null);
    assert.equal(stale.clearAi, true);
    const kept = resolveRecordedDate({ ...filed, datedAt: new Date("2018-03-02T12:00:00.000Z"), kind: "minutes.senate", aiDateValue: "", aiDateSourceHash: "" });
    assert.equal(kept.datedAt?.toISOString(), "2018-03-02T12:00:00.000Z");
    assert.equal(kept.clearAi, false);
    const unverified = resolveRecordedDate({
        ...filed,
        driveFileId: "1ZnG1_4EuxXb0-_CowTbrfaOUJ4wBjCxQv3nJsVZhJFs",
        datedAt: new Date("2026-10-13T12:00:00.000Z"),
        kind: "minutes.senate",
    });
    assert.equal(unverified.datedAt, null);

    const db = new PGlite();
    try {
        await db.exec(`CREATE TABLE "Document" (id TEXT PRIMARY KEY); INSERT INTO "Document" VALUES ('existing');`);
        await db.exec(await readFile("prisma/migrations/20261125030000_ai_document_dates/migration.sql", "utf8"));
        const result = await db.query<{ aiDateValue: string; aiDateSourceHash: string }>(`SELECT * FROM "Document"`);
        assert.equal(result.rows[0]!.aiDateValue, "");
        assert.equal(result.rows[0]!.aiDateSourceHash, "");
    } finally {
        await db.close();
    }
    console.log("AI document date validation, display, sync preservation, and migration checks passed.");
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
