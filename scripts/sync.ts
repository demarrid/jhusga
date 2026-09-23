/**
 * Manual ingest, for local runs and one-off backfills.
 *
 *   npm run sync                         -- re-read Drive, then new News-Letter coverage
 *   npm run sync -- --dry                -- list what the walk finds, write nothing
 *   npm run sync -- --force              -- re-export and regenerate everything
 *   npm run sync -- --newsletter-backfill -- also search every year since 2001
 *   npm run sync -- --skip-newsletter    -- Drive only
 *
 * The nightly Drive cron does not do the paper: honouring jhunewsletter.com's
 * crawl delay would blow its five-minute budget. A manual run has no such
 * ceiling, so it is the place a new article is noticed without waiting for
 * `/api/cron/newsletter`. Reaching 2001 is `--newsletter-backfill`, or
 * `npm run newsletter -- --backfill`.
 */

import path from "node:path";

process.loadEnvFile(path.join(process.cwd(), ".env"));

async function main() {
    const args = new Set(process.argv.slice(2));
    const dry = args.has("--dry");
    const force = args.has("--force");
    const skipNewsletter = args.has("--skip-newsletter");
    const newsletterBackfill = args.has("--newsletter-backfill");

    // Imported lazily so .env is loaded before any module reads process.env.
    const { MASTER_FOLDER_ID } = await import("../config/sga");

    if (dry) {
        const { walkFolder, GOOGLE_DOC_MIME, isPdfFile } = await import("../lib/drive");
        const { classifyDocument } = await import("../lib/kinds");

        const files = await walkFolder(MASTER_FOLDER_ID);
        const docs = files.filter(
            (file) => file.mimeType === GOOGLE_DOC_MIME || isPdfFile(file),
        );

        console.log(`${files.length} files, ${docs.length} documents (Docs and PDFs)\n`);
        for (const file of docs) {
            const kind = classifyDocument({
                name: file.name,
                folderPath: file.folderPath,
            });
            console.log(`${kind.padEnd(30)} ${file.folderPath}/${file.name}`);
        }

        const unknown = docs.filter(
            (file) =>
                classifyDocument({
                    name: file.name,
                    folderPath: file.folderPath,
                }) === "unknown",
        ).length;
        console.log(
            `\n${docs.length - unknown} classified, ${unknown} unknown (tune classifyDocument in lib/kinds.ts)`,
        );
        console.log(
            skipNewsletter
                ? "\nNews-Letter coverage would be skipped."
                : newsletterBackfill
                    ? "\nA live sync would then search the News-Letter from 2001 to now."
                    : "\nA live sync would then search the News-Letter for new coverage (last three days).",
        );
        return;
    }

    const { syncMasterFolder } = await import("../lib/sync");
    const summary = await syncMasterFolder({ trigger: "manual", force });
    console.log("sync:", summary);

    if (summary.documentsHeld > 0) {
        console.log(
            `\n${summary.documentsHeld} document(s) changed too much to publish unread.` +
            "\nThe site is still serving the last checked text. Run `npm run review`.",
        );
    }

    if (summary.documentsCreated + summary.documentsUpdated > 0 || force) {
        const { generateStaleSections } = await import("../lib/generate");
        for (const result of await generateStaleSections({ force })) {
            console.log("section:", result);
        }
    } else {
        console.log("sections: nothing changed, skipped generation");
    }

    // After Drive, before summaries, so an article this run stored is restated
    // in the same pass rather than sitting unsummarised until the next night.
    if (skipNewsletter) {
        console.log("newsletter: skipped");
    } else {
        const { MAX_ARTICLES_PER_RUN, NEWSLETTER_REQUEST_DELAY_MS } = await import(
            "../config/newsletter"
        );
        const { ingestNewsletterCoverage, coverageHeld } = await import("../lib/coverage");

        console.log(
            `\ncrawling the News-Letter at ${NEWSLETTER_REQUEST_DELAY_MS / 1000}s between requests,` +
            ` up to ${MAX_ARTICLES_PER_RUN} article(s)` +
            (newsletterBackfill ? ", every year since 2001" : ", last three days") +
            "\n",
        );

        const newsletter = await ingestNewsletterCoverage({
            backfill: newsletterBackfill,
            // A manual run is not a serverless function. Bound by the article
            // budget, not the four-minute wall the cron uses.
            runBudgetMs: Number.POSITIVE_INFINITY,
            onSearch: (phrase, year, page, found) =>
                console.log(`search ${year} "${phrase}" page ${page}: ${found} result(s)`),
            onEvent: (event) =>
                console.log(
                    `${event.status.padEnd(10)} ${(event.publishedOn ?? "undated").padEnd(10)}` +
                    ` ${event.headline}`,
                ),
        });

        console.log("newsletter:", newsletter);

        if (newsletter.truncatedYears.length > 0) {
            console.log(
                `\nThe search reported its own result cap for ${newsletter.truncatedYears.join(", ")}.` +
                "\nThose years are incomplete; narrow the date fence in searchUrl.",
            );
        }

        if (newsletter.budgetReached) {
            console.log(
                "\nStopped on the article budget with candidates left." +
                (newsletterBackfill
                    ? " Run again with --newsletter-backfill to carry on."
                    : " Run `npm run newsletter -- --backfill` to reach 2001."),
            );
        }

        const held = await coverageHeld();
        const range =
            held.earliest && held.latest
                ? ` spanning ${held.earliest.toISOString().slice(0, 10)} to ${held.latest.toISOString().slice(0, 10)}`
                : "";
        console.log(`the archive now holds ${held.count} News-Letter article(s)${range}`);

        if (!newsletterBackfill && held.count === 0) {
            console.log(
                "\nNothing from the paper is held yet. Reaching 2001 is" +
                " `npm run sync -- --newsletter-backfill`, or `npm run newsletter -- --backfill`.",
            );
        }
    }

    // The same budgeted pass the cron route runs, so a manual sync leaves the
    // database in the state a nightly one would. Anything left over is what
    // `npm run summarize` is for.
    const { SUMMARY_RUN_BUDGET, summarizeStaleDocuments } = await import(
        "../lib/summarize"
    );
    const summaries = await summarizeStaleDocuments({
        limit: SUMMARY_RUN_BUDGET,
        onResult: (result) =>
            console.log(`summary: ${result.status.padEnd(7)} ${result.title}`),
    });
    if (summaries.length === SUMMARY_RUN_BUDGET) {
        console.log(
            `\nStopped after ${SUMMARY_RUN_BUDGET} summaries. Run \`npm run summarize\` for the rest.`,
        );
    }
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
