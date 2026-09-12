/**
 * Ingest The Johns Hopkins News-Letter's coverage of the SGA.
 *
 *   npm run newsletter                  -- the last two years, as the cron does
 *   npm run newsletter -- --backfill    -- every year since 2001, until budget
 *   npm run newsletter -- --year 2015   -- one year; repeatable
 *   npm run newsletter -- --dry         -- search only, fetch and store nothing
 *   npm run newsletter -- --refetch     -- re-read articles already held
 *   npm run newsletter -- --limit 25    -- override the per-run article budget
 *
 * Every request waits out the crawl delay jhunewsletter.com asks for, so this
 * is slow on purpose: a full backfill is hours of wall clock spread over as many
 * runs as it takes. Stopping it early is safe and losing nothing -- an article
 * already stored is skipped by the next run.
 */

import path from "node:path";

process.loadEnvFile(path.join(process.cwd(), ".env"));

/** `--limit 25`, `--year 2015` -- a flag and the value after it. */
function value(argv: string[], flag: string): string | null {
    const at = argv.indexOf(flag);
    return at === -1 ? null : argv[at + 1] ?? null;
}

/** Every `--year Y`, so a range can be given a year at a time. */
function years(argv: string[]): number[] {
    const found: number[] = [];

    for (const [index, argument] of argv.entries()) {
        if (argument !== "--year") continue;
        const year = Number(argv[index + 1]);
        if (Number.isInteger(year)) found.push(year);
    }

    return found;
}

async function main() {
    const argv = process.argv.slice(2);
    const args = new Set(argv);

    const {
        MAX_ARTICLES_PER_RUN,
        MAX_SEARCH_PAGES_PER_WINDOW,
        NEWSLETTER_PHRASES,
        NEWSLETTER_REQUEST_DELAY_MS,
    } = await import("../config/newsletter");

    const chosen = years(argv);
    const limit = Number(value(argv, "--limit")) || MAX_ARTICLES_PER_RUN;

    if (args.has("--dry")) {
        const { searchYear } = await import("../lib/newsletter");
        const { prisma } = await import("../lib/prisma");
        const { NEWSLETTER_FILE_PREFIX } = await import("../lib/newsletter");

        const held = new Set(
            (
                await prisma.document.findMany({
                    where: { driveFileId: { startsWith: NEWSLETTER_FILE_PREFIX } },
                    select: { driveFileId: true },
                })
            ).map((document) => document.driveFileId),
        );

        const searchYears = chosen.length ? chosen : [new Date().getUTCFullYear()];
        const candidates = new Map<string, { headline: string; phrase: string }>();

        for (const year of searchYears) {
            for (const phrase of NEWSLETTER_PHRASES) {
                const results = await searchYear(phrase, year, {
                    maxPages: MAX_SEARCH_PAGES_PER_WINDOW,
                    onPage: (page, found, reported) =>
                        console.log(
                            `search ${year} "${phrase}" page ${page}: ${found} result(s)` +
                            `${reported === null ? "" : ` of ${reported} reported`}`,
                        ),
                });

                for (const result of results) {
                    if (candidates.has(result.fileId)) continue;
                    candidates.set(result.fileId, {
                        headline: result.headline,
                        phrase,
                    });
                }
            }
        }

        const refused = new Set(
            (await prisma.newsletterMiss.findMany({ select: { fileId: true } })).map(
                (miss) => miss.fileId,
            ),
        );

        const fresh = [...candidates.keys()].filter(
            (fileId) => !held.has(fileId) && !refused.has(fileId),
        );
        console.log(
            `\n${candidates.size} distinct article(s) found; ${fresh.length} neither held` +
            ` nor already refused\n`,
        );
        for (const fileId of fresh) {
            const candidate = candidates.get(fileId)!;
            console.log(`  ${fileId.padEnd(52)} ${candidate.headline}`);
        }
        console.log(
            "\nNothing was fetched or stored. The phrase test runs against the" +
            " article text, so some of these will be dropped once read.",
        );
        return;
    }

    const { ingestNewsletterCoverage, coverageHeld } = await import("../lib/coverage");

    console.log(
        `crawling at ${NEWSLETTER_REQUEST_DELAY_MS / 1000}s between requests,` +
        ` up to ${limit} article(s)\n`,
    );

    const summary = await ingestNewsletterCoverage({
        backfill: args.has("--backfill"),
        years: chosen.length ? chosen : undefined,
        refetch: args.has("--refetch"),
        limit,
        // A manual run is not a serverless function, so it is bounded by the
        // article budget alone rather than being cut off part way through.
        runBudgetMs: Number.POSITIVE_INFINITY,
        onSearch: (phrase, year, page, found) =>
            console.log(`search ${year} "${phrase}" page ${page}: ${found} result(s)`),
        onEvent: (event) =>
            console.log(
                `${event.status.padEnd(10)} ${(event.publishedOn ?? "undated").padEnd(10)}` +
                ` ${event.sessionNumber === null ? "  -" : String(event.sessionNumber).padStart(3)}` +
                ` [${event.phrases.join(", ") || "no phrase"}] ${event.headline}`,
            ),
    });

    console.log("\nnewsletter:", summary);

    if (summary.truncatedYears.length > 0) {
        console.log(
            `\nThe search reported its own result cap for ${summary.truncatedYears.join(", ")}.` +
            "\nThose years are incomplete; narrow the date fence in searchUrl.",
        );
    }

    if (summary.budgetReached) {
        console.log(
            "\nStopped on the run budget with candidates left. Run again to carry on;" +
            "\neverything stored above is skipped next time.",
        );
    }

    const held = await coverageHeld();
    const range =
        held.earliest && held.latest
            ? ` spanning ${held.earliest.toISOString().slice(0, 10)} to ${held.latest.toISOString().slice(0, 10)}`
            : "";
    console.log(`\nthe archive now holds ${held.count} News-Letter article(s)${range}`);
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
