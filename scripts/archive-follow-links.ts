/**
 * Import the files that named archive documents link to.
 *
 * Sync never follows links out of `discoveredVia: archive` records
 * (linkedSyncTargets), because archive imports are manual-only: see
 * "Manual-only archive policy" in docs/local-archive-import.md. When the owner
 * asks in chat for an archive document's linked files, this imports them the
 * way sync imports any linked file: public Drive metadata only, files in
 * manual-only folders refused, the same file types (worthFollowing), and
 * ingestFile's redaction and session rules. Each target takes the earliest
 * session among the documents linking it, as sync does.
 *
 *   node_modules/.bin/tsx scripts/archive-follow-links.ts <documentId|driveFileId>... [--from <file>] [--apply]
 *
 * `--from` reads one ID per line. Dry run by default. Imported files are
 * `discoveredVia: link`, so later syncs keep them current like any other
 * linked file; references are rebuilt after an apply.
 */
import { readFileSync } from "node:fs";

process.loadEnvFile(".env");

async function main() {
    const { prisma } = await import("../lib/prisma");
    const { SESSION_NUMBER } = await import("../config/sga");
    const { getFile } = await import("../lib/drive");
    const { extractDocumentLinks } = await import("../lib/links");
    const { manualArchiveIds } = await import("../lib/manual-archive");
    const { emptySyncSummary, ingestFile, rebuildReferences, worthFollowing } = await import("../lib/sync");

    const argv = process.argv.slice(2);
    const apply = argv.includes("--apply");
    const fromAt = argv.indexOf("--from");
    const fromFile = fromAt >= 0 ? argv[fromAt + 1] : undefined;
    const named = [
        ...argv.filter((arg, index) => !arg.startsWith("--") && (fromAt < 0 || index !== fromAt + 1)),
        ...(fromFile ? readFileSync(fromFile, "utf8").split(/\s+/) : []),
    ].filter(Boolean);
    if (!named.length) throw new Error("Name the archive documents whose links to follow.");

    try {
        const sources = await prisma.document.findMany({
            where: { discoveredVia: "archive", OR: [{ id: { in: named } }, { driveFileId: { in: named } }] },
            select: { id: true, driveFileId: true, title: true, content: true, sessionNumber: true },
        });
        const found = new Set(sources.flatMap(source => [source.id, source.driveFileId]));
        for (const id of named) if (!found.has(id)) console.log("not an archive document", id);

        const held = new Set((await prisma.document.findMany({ select: { driveFileId: true } })).map(d => d.driveFileId));
        const targets = new Map<string, { url: string; sessionNumber: number | null; from: string[] }>();
        for (const source of sources) {
            for (const link of extractDocumentLinks(source.content)) {
                if (link.source !== "drive" || held.has(link.fileId) || manualArchiveIds.has(link.fileId)) continue;
                const target = targets.get(link.fileId) ?? { url: link.url, sessionNumber: null, from: [] };
                if (!target.from.includes(source.title)) target.from.push(source.title);
                if (source.sessionNumber !== null && (target.sessionNumber === null || source.sessionNumber < target.sessionNumber)) {
                    target.sessionNumber = source.sessionNumber;
                }
                targets.set(link.fileId, target);
            }
        }
        console.log(`${sources.length} archive documents link ${targets.size} files the archive does not hold`);

        const summary = emptySyncSummary("archive-follow-links");
        const tally = { unavailable: 0, notFollowed: 0, imported: 0, failed: 0, wouldImport: 0 };
        for (const [fileId, target] of targets) {
            const file = await getFile(fileId);
            if (!file) { tally.unavailable++; console.log("unavailable (private, deleted or manual-only)", fileId); continue; }
            if (!worthFollowing(file)) { tally.notFollowed++; console.log("not a followed type", fileId, file.mimeType, file.name); continue; }
            const sessionNumber = target.sessionNumber ?? SESSION_NUMBER;
            if (!apply) { tally.wouldImport++; console.log("would import", fileId, file.name, `(session ${sessionNumber})`); continue; }
            const ok = await ingestFile({ ...file, folderPath: "", sessionNumber }, "link", {}, summary).catch(error => {
                console.log("failed", fileId, file.name, String(error).slice(0, 200));
                return false;
            });
            if (ok) { tally.imported++; console.log("imported", fileId, file.name); } else tally.failed++;
        }
        if (apply) console.log("references linked", await rebuildReferences());
        console.log(tally, apply ? { created: summary.documentsCreated, updated: summary.documentsUpdated } : "");
    } finally {
        await prisma.$disconnect();
    }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
