/** Audit unknowns; use --apply only after deploying the category taxonomy.
 * Saves a reversible manifest locally. Never contacts Drive or generates AI text. */
import { mkdir, writeFile } from "node:fs/promises";
import { classifyDocument } from "../lib/kinds";
import { lineageKeyFor } from "../lib/lineage";
import { documentMeetingRole } from "../lib/meetings";
import { SESSION_NUMBER } from "../config/session";

process.loadEnvFile(".env");
async function main() {
    const { prisma } = await import("../lib/prisma");
    try {
        const totals = await prisma.document.groupBy({ by: ["sessionNumber"], _count: { _all: true } });
        const documents = await prisma.document.findMany({ where: { kind: "unknown" }, select: {
            id: true, driveFileId: true, title: true, displayTitle: true, folderPath: true,
            mimeType: true, content: true, contentHash: true, kind: true, meetingRole: true,
            lineageKey: true, sessionNumber: true,
        } });
        const changes = documents.flatMap(document => {
            const kind = classifyDocument({ ...document, name: document.title });
            if (kind === "unknown") return [];
            return [{ id: document.id, title: document.title, sessionNumber: document.sessionNumber,
                contentHash: document.contentHash,
                source: { driveFileId: document.driveFileId, folderPath: document.folderPath,
                    displayTitle: document.displayTitle, mimeType: document.mimeType },
                before: { kind: document.kind, meetingRole: document.meetingRole, lineageKey: document.lineageKey },
                after: { kind, meetingRole: documentMeetingRole({ ...document, kind }) || document.meetingRole,
                    lineageKey: lineageKeyFor(document.title, document.driveFileId, kind) },
            }];
        });
        const total = totals.reduce((sum, row) => sum + row._count._all, 0);
        const currentTotal = totals.find(row => row.sessionNumber === SESSION_NUMBER)?._count._all ?? 0;
        const currentUnknown = documents.filter(row => row.sessionNumber === SESSION_NUMBER).length;
        const currentChanges = changes.filter(row => row.sessionNumber === SESSION_NUMBER).length;
        const coverage = {
            all: { total, before: documents.length, after: documents.length - changes.length },
            current: { total: currentTotal, before: currentUnknown, after: currentUnknown - currentChanges },
            pastAndUndated: { total: total - currentTotal, before: documents.length - currentUnknown,
                after: documents.length - changes.length - currentUnknown + currentChanges },
        };
        await mkdir(".archive-local", { recursive: true });
        const manifest = `.archive-local/category-backfill-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
        await writeFile(manifest, JSON.stringify({ coverage, changes,
            remaining: documents.filter(document => !changes.some(change => change.id === document.id))
                .map(({id,title,sessionNumber}) => ({id,title,sessionNumber})),
        }, null, 2));
        console.log(JSON.stringify({ mode: process.argv.includes("--apply") ? "apply" : "audit", manifest, coverage, changes: changes.length }, null, 2));
        if (!process.argv.includes("--apply")) return;
        // Each update checks the audited source and classification. A concurrent sync
        // must cause a retry, never an overwrite with an obsolete classification.
        for (let offset = 0; offset < changes.length; offset += 100) {
            await prisma.$transaction(async tx => {
                for (const change of changes.slice(offset, offset + 100)) {
                    const result = await tx.document.updateMany({ where: {
                        ...change.source, id: change.id, kind: change.before.kind, contentHash: change.contentHash,
                        title: change.title, meetingRole: change.before.meetingRole, lineageKey: change.before.lineageKey,
                    }, data: change.after });
                    if (result.count !== 1) throw new Error(`Document changed during audit: ${change.id}`);
                }
            }, { timeout: 60_000 });
            console.log(`Classified ${Math.min(offset + 100, changes.length)}/${changes.length}`);
        }
        const remaining = await prisma.document.count({ where: { kind: "unknown" } });
        const remainingCurrent = await prisma.document.count({ where: {kind: "unknown",sessionNumber: SESSION_NUMBER} });
        console.log(JSON.stringify({ remaining, remainingCurrent, total, currentTotal }, null, 2));
    } finally { await prisma.$disconnect(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
