/**
 * The review queue for changes the sync would not publish on its own.
 *
 *   npm run review                     -- what is waiting, and why
 *   npm run review -- --show <id>      -- the diff, collapsed to the changes
 *   npm run review -- --approve <id>   -- publish it, and re-anchor everything
 *   npm run review -- --reject <id>    -- keep the current text; do not ask again
 *
 * Approving is the same operation the sync would have performed, run late and
 * by a person. Rejecting records the hash so the next sync recognises the same
 * change instead of queueing it a second time; it does not touch Drive, so the
 * fix at the source is still somebody's job.
 */

import path from "node:path";

process.loadEnvFile(path.join(process.cwd(), ".env"));

function argumentAfter(args: string[], flag: string): string | undefined {
    const at = args.indexOf(flag);
    return at === -1 ? undefined : args[at + 1];
}

async function main() {
    const args = process.argv.slice(2);
    const { prisma } = await import("../lib/prisma");

    const showId = argumentAfter(args, "--show");
    const approveId = argumentAfter(args, "--approve");
    const rejectId = argumentAfter(args, "--reject");
    const by = argumentAfter(args, "--by") ?? "unattributed";

    if (showId) return show(showId);
    if (approveId) return approve(approveId, by);
    if (rejectId) return reject(rejectId);

    const held = await prisma.document.findMany({
        where: { reviewState: "held" },
        select: {
            id: true,
            title: true,
            displayTitle: true,
            kind: true,
            anyoneCanEdit: true,
            heldReason: true,
            heldAt: true,
            source: true,
        },
        orderBy: { heldAt: "asc" },
    });

    if (held.length === 0) {
        console.log("Nothing held. Every synced change has been published.");
        return;
    }

    console.log(`${held.length} change(s) held:\n`);
    for (const document of held) {
        console.log(`${document.displayTitle || document.title}`);
        console.log(`  id      ${document.id}`);
        console.log(`  kind    ${document.kind}${document.anyoneCanEdit ? "  ANYONE CAN EDIT" : ""}`);
        console.log(`  held    ${document.heldAt?.toISOString() ?? "?"}`);
        console.log(`  why     ${document.heldReason}`);
        console.log(`  drive   ${document.source}`);
        console.log("");
    }
    console.log("Inspect one with:  npm run review -- --show <id>");
}

async function show(documentId: string) {
    const { prisma } = await import("../lib/prisma");
    const { collapseUnchanged, diffLines } = await import("../lib/diff");

    const document = await prisma.document.findUnique({
        where: { id: documentId },
        select: {
            title: true,
            displayTitle: true,
            content: true,
            heldReason: true,
            heldRevision: { select: { content: true, driveModifiedTime: true } },
        },
    });

    if (!document) throw new Error(`No document ${documentId}`);
    if (!document.heldRevision) {
        console.log("Nothing is held for this document.");
        return;
    }

    console.log(`${document.displayTitle || document.title}`);
    console.log(`${document.heldReason}\n`);

    const diff = diffLines(document.content, document.heldRevision.content);
    console.log(`${diff.added} line(s) added, ${diff.removed} removed${diff.coarse ? " (coarse)" : ""}\n`);

    for (const op of collapseUnchanged(diff)) {
        if (op.type === "skipped") {
            console.log(`  … ${op.count} unchanged line(s)`);
            continue;
        }
        const marker = op.type === "added" ? "+" : op.type === "removed" ? "-" : " ";
        for (const line of op.lines) console.log(`${marker} ${line}`);
    }

    console.log("\nPublish it:  npm run review -- --approve " + documentId + " --by 'your name'");
}

/**
 * Publish a held revision.
 *
 * This is deliberately the same work `ingestFile` does on an ordinary change,
 * in the same order: the point of holding was to delay it, not to do something
 * different with it.
 */
async function approve(documentId: string, by: string) {
    const { prisma } = await import("../lib/prisma");
    const { deriveDescription } = await import("../lib/markdown");
    const { indexDocumentPassages } = await import("../lib/search");
    const { reanchorDocument, recordContributors } = await import("../lib/sync");

    const document = await prisma.document.findUnique({
        where: { id: documentId },
        select: {
            title: true,
            heldRevision: { select: { id: true, content: true, contentHash: true } },
        },
    });

    if (!document?.heldRevision) throw new Error(`Nothing held for document ${documentId}`);

    const { content, contentHash } = document.heldRevision;

    await prisma.document.update({
        where: { id: documentId },
        data: {
            content,
            contentHash,
            description: deriveDescription(content),
            reviewState: "published",
            heldRevisionId: null,
            heldReason: "",
            heldAt: null,
        },
    });

    await prisma.documentRevision.update({
        where: { id: document.heldRevision.id },
        data: { reviewedAt: new Date(), reviewedBy: by },
    });

    const contributors = await recordContributors(documentId, content);
    const passages = await indexDocumentPassages(documentId, content);
    const reanchored = await reanchorDocument(documentId, content);

    await prisma.documentSummary.updateMany({
        where: { documentId, status: "fresh" },
        data: { status: "stale" },
    });

    console.log(`Published: ${document.title}`);
    console.log(
        `  ${contributors} contributor(s), ${passages} passage(s), ` +
        `${reanchored.orphaned} citation(s) orphaned, ` +
        `${reanchored.sectionsInvalidated} section(s) marked stale`,
    );
    console.log("  Run `npm run generate` and `npm run summarize` to refresh what went stale.");
}

async function reject(documentId: string) {
    const { prisma } = await import("../lib/prisma");

    const document = await prisma.document.findUnique({
        where: { id: documentId },
        select: {
            title: true,
            source: true,
            heldRevision: { select: { contentHash: true } },
        },
    });

    if (!document?.heldRevision) throw new Error(`Nothing held for document ${documentId}`);

    await prisma.document.update({
        where: { id: documentId },
        data: {
            reviewState: "published",
            heldRevisionId: null,
            heldReason: "",
            heldAt: null,
            rejectedContentHash: document.heldRevision.contentHash,
        },
    });

    console.log(`Rejected the change to: ${document.title}`);
    console.log("The site keeps the text it had. The revision is still in the history.");
    console.log(`Fix it at the source if it was vandalism: ${document.source}`);
}

main()
    .catch((error) => {
        console.error(error);
        process.exitCode = 1;
    })
    .finally(async () => {
        const { prisma } = await import("../lib/prisma");
        await prisma.$disconnect();
    });
