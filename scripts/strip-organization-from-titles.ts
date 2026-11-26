/**
 * Drop "Johns Hopkins Student Government Association" from stored meeting
 * titles ("114th Johns Hopkins Student Government Association Executive
 * Meeting #11" -> "114th Executive Meeting #11"). No model calls.
 *
 * node --env-file=.env --import tsx scripts/strip-organization-from-titles.ts [--apply]
 */
import { mkdir, writeFile } from "node:fs/promises";
import { prisma } from "../lib/prisma";
import { withoutOrganizationName } from "../lib/minute-title-ai";
import { invalidateArchiveCache } from "../lib/archive-cache";

async function main() {
    const apply = process.argv.includes("--apply");
    const documents = await prisma.document.findMany({
        where: { kind: { startsWith: "minutes." } },
        select: { id: true, displayTitle: true, aiNormalizedTitle: true, updatedAt: true },
    });
    const changes = documents.flatMap((document) => {
        const displayTitle = document.displayTitle ? withoutOrganizationName(document.displayTitle) : document.displayTitle;
        const aiNormalizedTitle = document.aiNormalizedTitle ? withoutOrganizationName(document.aiNormalizedTitle) : document.aiNormalizedTitle;
        return displayTitle !== document.displayTitle || aiNormalizedTitle !== document.aiNormalizedTitle
            ? [{ document, displayTitle, aiNormalizedTitle }]
            : [];
    });
    for (const change of changes) console.log(`${change.document.displayTitle}\n  -> ${change.displayTitle}`);
    console.log(`\n${changes.length} titles${apply ? "" : " (dry run; pass --apply)"}`);
    if (!apply || changes.length === 0) return;

    await mkdir(".archive-local", { recursive: true });
    const file = `.archive-local/organization-titles-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
    await writeFile(file, JSON.stringify(changes, null, 2));
    console.log(`backup: ${file}`);
    for (const { document, displayTitle, aiNormalizedTitle } of changes) {
        const result = await prisma.document.updateMany({
            where: { id: document.id, updatedAt: document.updatedAt },
            data: { displayTitle, aiNormalizedTitle },
        });
        if (!result.count) console.log(`stale; skipped ${document.id}`);
    }
    try { await invalidateArchiveCache(); } catch { /* outside Next: the deployment's cache expires on its own schedule */ }
    console.log("done");
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
