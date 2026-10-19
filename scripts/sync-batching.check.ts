import assert from "node:assert/strict";
import type { WalkedFile } from "../lib/drive";
import { PREFERRED_VOTING_RECORD_FILE } from "../lib/bill-votes";

async function main() {
    const time = "2026-10-18T12:00:00Z";
    const file = (id: string): WalkedFile => ({
        id, name: "Archive memo", mimeType: "application/vnd.google-apps.document",
        createdTime: time, modifiedTime: time, webViewLink: `https://docs.google.com/document/d/${id}/edit`,
        owner: null, lastModifyingUser: null, anyoneCanEdit: false, shortcutTo: null,
        folderPath: "", sessionNumber: 114,
    });
    const files = Array.from({ length: 837 }, (_, i) => file(`file-${i}`));
    const rows = files.map(f => ({
        id: `row-${f.id}`, driveFileId: f.id, source: f.webViewLink, title: f.name,
        mimeType: f.mimeType, kind: "unknown", folderPath: "", discoveredVia: "walk",
        lineageKey: "archive memo", driveCreatedTime: new Date(time), driveModifiedTime: new Date(time),
        anyoneCanEdit: false, driveOwnerName: null, driveOwnerEmail: null,
        driveLastEditorName: null, driveLastEditorEmail: null,
    }));
    let reads = 0;
    const updates: {where: {id: string}; data: Record<string, unknown>}[] = [];
    const batches: {where: {id: {in: string[]}}; data: Record<string, unknown>}[] = [];
    Object.assign(globalThis, { prisma: { document: {
        findMany: async (query: {select: Record<string, unknown>}) => {
            assert.equal(query.select.content, undefined, "stable-file checks must not download text");
            reads++; return rows;
        },
        update: async (query: typeof updates[number]) => { updates.push(query); return {id: query.where.id}; },
        updateMany: async (query: typeof batches[number]) => { batches.push(query); return {count: query.where.id.in.length}; },
    } } });
    const { refreshUnchangedFiles } = await import("../lib/sync");
    const summary = { documentsUnchanged: 0 };
    assert.equal((await refreshUnchangedFiles(files, "walk", {}, summary)).size, 837);
    assert.equal(reads, 1);
    assert.equal(updates.length, 0);
    assert.deepEqual(batches.map(b => b.where.id.in.length), [500, 337]);
    assert.equal(summary.documentsUnchanged, 837);
    assert.ok(batches.every(b => b.data.lastSyncedAt instanceof Date && Object.keys(b.data).length === 1));

    // Permissions/moves/ownership are not reliably reflected in modifiedTime.
    const changed = { ...files[0], anyoneCanEdit: true, folderPath: "Archive", owner: {displayName: "Writer", emailAddress: "writer@example.test"} };
    await refreshUnchangedFiles([changed], "walk", {}, summary);
    assert.equal(updates.length, 1);
    assert.equal(updates[0].data.anyoneCanEdit, true);
    assert.equal(updates[0].data.folderPath, "Archive");
    assert.equal(updates[0].data.driveOwnerName, "Writer");
    assert.equal(updates[0].data.content, undefined);
    assert.equal(updates[0].data.reviewState, undefined, "batching cannot publish held edits");
    assert.equal(updates[0].data.sessionNumber, undefined, "linked session attribution is preserved");

    const fallthrough = [
        {...files[1], modifiedTime: "2026-10-19T12:00:00Z"},
        {...files[2], modifiedTime: null},
        file("new-file"), file(PREFERRED_VOTING_RECORD_FILE),
    ];
    assert.equal((await refreshUnchangedFiles(fallthrough, "walk", {}, summary)).size, 0);
    const beforeForce = reads;
    assert.equal((await refreshUnchangedFiles(files, "walk", {force: true}, summary)).size, 0);
    assert.equal(reads, beforeForce, "force must take the normal export path");
    console.log("all sync batching checks passed (837 stable files: 1 read + 2 writes)");
}
main().catch(error => {console.error(error);process.exitCode=1});
