/**
 * Generate the per-document summaries shown beside each document.
 *
 *   npm run summarize                    -- documents with no current summary
 *   npm run summarize -- --session 114   -- one session only
 *   npm run summarize -- --limit 20      -- stop after 20 model calls
 *   npm run summarize -- --force         -- redo everything, including fresh
 *   npm run summarize -- --document <id> -- one document
 *
 * Every run costs one model call per document that is missing or stale, so
 * --limit is the way to work through the archive in affordable batches. An
 * unchanged document is free: its fingerprint still matches and it is skipped.
 */

import path from "node:path";

process.loadEnvFile(path.join(process.cwd(), ".env"));

function numeric(args: string[], flag: string): number | undefined {
    const at = args.indexOf(flag);
    if (at === -1) return undefined;
    const value = Number(args[at + 1]);
    if (!Number.isFinite(value)) throw new Error(`${flag} needs a number`);
    return value;
}

async function main() {
    const args = process.argv.slice(2);
    const force = args.includes("--force");
    const session = numeric(args, "--session");
    const limit = numeric(args, "--limit");
    const documentId = args[args.indexOf("--document") + 1];

    const { summarizeDocument, summarizeStaleDocuments } = await import("../lib/summarize");

    if (args.includes("--document")) {
        if (!documentId) throw new Error("--document needs a document id");
        console.log(await summarizeDocument(documentId, { force }));
        return;
    }

    const counts = { fresh: 0, empty: 0, failed: 0, skipped: 0 };

    const results = await summarizeStaleDocuments({
        force,
        session,
        limit,
        onResult: (result) => {
            if (result.skipped) {
                counts.skipped += 1;
                return;
            }
            if (result.status === "fresh") counts.fresh += 1;
            else if (result.status === "empty") counts.empty += 1;
            else counts.failed += 1;

            const detail = result.error
                ? result.error
                : `${result.citationsVerified} cited, ${result.citationsRejected} rejected`;
            console.log(`${result.status.padEnd(7)} ${result.title.slice(0, 60).padEnd(62)} ${detail}`);
        },
    });

    console.log(
        `\n${results.length} considered: ${counts.fresh} summarised, ${counts.empty} nothing to say, ` +
        `${counts.failed} failed, ${counts.skipped} already current`,
    );
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
