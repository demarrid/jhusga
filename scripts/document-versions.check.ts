import assert from "node:assert/strict";
import { selectDocumentVersion, versionDay, versionOptions } from "../lib/document-versions";
import { recordDocumentVersion } from "../lib/document-version-history";
import type { Prisma } from "@prisma/client";

const options = versionOptions([
    { id: "before", modifiedAt: "2026-10-31T20:00:00Z", observedAt: "2026-11-02T12:00:00Z" },
    { id: "end-of-day", modifiedAt: "2026-11-01T03:59:59Z", observedAt: "2026-11-02T12:01:00Z" },
    { id: "after", modifiedAt: "2026-11-01T04:00:00Z", observedAt: "2026-11-02T12:02:00Z" },
]);
const dated = new Date("2026-10-31T12:00:00Z");
assert.equal(selectDocumentVersion(options, dated)?.selected.id, "end-of-day");
assert.equal(selectDocumentVersion(options, null)?.selected.id, "after");
assert.equal(selectDocumentVersion(options, dated, "latest")?.selected.id, "after");
assert.equal(selectDocumentVersion(options, dated, "before")?.selected.id, "before");
assert.equal(selectDocumentVersion(options, dated, "private-version"), null);
assert.equal(selectDocumentVersion([], dated), null);
assert.equal(selectDocumentVersion(options, new Date("2026-10-30T12:00:00Z"))?.selected.id, "before");
assert.equal(selectDocumentVersion(options, new Date("2026-10-30T12:00:00Z"))?.missingDatedVersion, true);
assert.match(options[0].label, /4:00:00 PM EDT/);
assert.equal(versionDay("2026-11-02T04:59:59Z"), "2026-11-01", "fall-back day includes the extra hour");
assert.equal(versionDay("2026-11-02T05:00:00Z"), "2026-11-02");
assert.equal(versionDay("2026-03-09T03:59:59Z"), "2026-03-08", "spring-forward day uses EDT");
assert.equal(versionDay("2026-03-09T04:00:00Z"), "2026-03-09");
const unknownTime = versionOptions([{ id: "saved", modifiedAt: null, observedAt: "2026-10-31T16:00:00Z" }]);
assert.match(unknownTime[0].label, /first saved/);
assert.equal(selectDocumentVersion(unknownTime, dated)?.missingDatedVersion, false);

type Occurrence = { id: string; revisionId: string; sourceModifiedTime: Date | null; observedAt: Date; status: string };
async function main() {
    const occurrences = new Map<string, Occurrence>();
    const tx = { documentVersion: { upsert: async ({ where, create, update }: {
        where: { id: string }; create: Occurrence; update: Partial<Occurrence>;
    }) => {
        const row = occurrences.get(where.id);
        occurrences.set(where.id, row ? { ...row, ...update } : create);
    } } } as unknown as Prisma.TransactionClient;
    await recordDocumentVersion(tx, "snapshot-A", new Date("2026-10-29T12:00:00Z"), "published");
    await recordDocumentVersion(tx, "snapshot-B", new Date("2026-10-30T12:00:00Z"), "published");
    await recordDocumentVersion(tx, "snapshot-A", new Date("2026-10-31T12:00:00Z"), "published");
    await recordDocumentVersion(tx, "snapshot-A", new Date("2026-10-31T12:00:00Z"), "held");
    assert.equal(occurrences.size, 3, "A -> B -> A keeps both occurrences of A; retries are idempotent");
    assert.ok([...occurrences.values()].every(row => row.status === "published"));

    const current = {
        id: "document", driveFileId: "file", title: "Current title", displayTitle: "Current title",
        content: "# Current\n\nAccepted text", kind: "bill", folderPath: "", sessionNumber: 114,
        description: "Current description", lineageKey: "", discoveredVia: "walk", matchedPhrases: "",
        source: "https://example.test/document", driveCreatedTime: dated, driveModifiedTime: new Date("2026-11-01T18:00:00Z"),
        datedAt: dated, lastSyncedAt: new Date("2026-11-01T19:00:00Z"), meetingRole: "", meetingKey: "",
        mimeType: "text/plain", driveOwnerName: null, driveLastEditorName: "Current editor",
        reviewState: "held", heldRevisionId: "held-snapshot", heldReason: "Changed text", anyoneCanEdit: false,
        documentAnnotations: [{ id: "current-annotation", startOffset: 0, endOffset: 9 }],
        contributors: [], referencesOut: [], referencesIn: [], _count: { revisions: 4 },
        summary: { content: "Summary of current text", status: "fresh", model: "fixture", generatedAt: dated, citations: [] },
    };
    const rows = [
        { id: "old", status: "published", sourceModifiedTime: new Date("2026-10-31T20:00:00Z"), observedAt: dated,
            revision: { documentId: "document", content: "# Earlier\n\nEarlier text", title: "Earlier title", editorName: "Earlier editor" } },
        { id: "new", status: "published", sourceModifiedTime: new Date("2026-11-01T18:00:00Z"), observedAt: dated,
            revision: { documentId: "document", content: current.content, title: current.title, editorName: "Current editor" } },
        { id: "held", status: "held", sourceModifiedTime: new Date("2026-11-02T18:00:00Z"), observedAt: dated,
            revision: { documentId: "document", content: "Do not expose", title: "Held", editorName: "" } },
        { id: "rejected", status: "rejected", sourceModifiedTime: new Date("2026-11-03T18:00:00Z"), observedAt: dated,
            revision: { documentId: "document", content: "Do not expose", title: "Rejected", editorName: "" } },
        { id: "foreign", status: "published", sourceModifiedTime: dated, observedAt: dated,
            revision: { documentId: "another-document", content: "Other document", title: "Other", editorName: "" } },
    ];
    type Where = { id?: string; status: string; revision: { documentId: string } };
    const matches = (row: typeof rows[number], where: Where) => row.status === where.status
        && row.revision.documentId === where.revision.documentId && (!where.id || row.id === where.id);
    Object.assign(globalThis, { prisma: {
        document: { findUnique: async () => structuredClone(current), findMany: async () => [] },
        documentVersion: {
            findMany: async ({ where }: { where: Where }) => rows.filter(row => matches(row, where)),
            findFirst: async ({ where }: { where: Where }) => rows.find(row => matches(row, where)) ?? null,
        },
        amendmentClearance: { findFirst: async () => null },
    } });
    const { getVersionedDocument } = await import("../server/document-versions");
    const { loadDocument } = await import("../server/documents");
    const historical = await getVersionedDocument("document");
    assert.equal(historical?.selected.id, "old");
    assert.equal(historical?.document.content, "# Earlier\n\nEarlier text");
    assert.equal(historical?.document.restatement, null);
    assert.equal(historical?.document.driveTitle, "Earlier title");
    assert.ok(!JSON.stringify(historical?.document.blocks).includes("current-annotation"));
    assert.deepEqual(historical?.options.map(row => row.id), ["old", "new"]);
    for (const id of ["held", "rejected", "foreign", "nonexistent"]) {
        assert.equal(await getVersionedDocument("document", id), null);
        assert.equal(await loadDocument("document", id), null, "direct historical reads also enforce publication and document ownership");
    }
    const latest = await getVersionedDocument("document", "latest");
    assert.equal(latest?.selected.id, "new");
    assert.equal(latest?.historical, false);
    assert.equal(latest?.document.restatement?.content, current.summary.content);
    assert.ok(latest?.document.heldNotice, "held source warning remains visible");
    console.log("Document version checks passed: date defaults, DST, reversions, publication, scoping and summaries.");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
