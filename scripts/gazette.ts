/**
 * Ingest The Johns Hopkins Gazette's coverage of the student government, read
 * from the Internet Archive's Wayback Machine (see config/gazette.ts for why).
 *
 *   npm run gazette                    -- 1994 to 2015, until the article budget
 *   npm run gazette -- --year 2001     -- one year; repeatable
 *   npm run gazette -- --dry           -- list only: fetch and store nothing
 *   npm run gazette -- --limit 50      -- override the per-run article budget
 *   npm run gazette -- --all           -- no article budget: run to the end
 *   npm run gazette -- --refetch       -- re-read articles already decided
 *
 * Every article has to be read to learn whether it mentions the student
 * government, and the Wayback Machine is read slowly on purpose, so a full
 * backfill is many hours. Stopping it is safe: everything stored or refused is
 * skipped next time, and the run resumes from the year it stopped in.
 */

import path from "node:path";

process.loadEnvFile(path.join(process.cwd(), ".env"));

function value(argv: string[], flag: string): string | null {
    const at = argv.indexOf(flag);
    return at === -1 ? null : argv[at + 1] ?? null;
}

function years(argv: string[]): number[] {
    const found: number[] = [];
    for (const [index, argument] of argv.entries()) {
        if (argument !== "--year") continue;
        const year = Number(argv[index + 1]);
        if (!Number.isInteger(year)) throw new Error(`--year needs a year, not ${argv[index + 1] ?? "nothing"}`);
        found.push(year);
    }
    return found;
}

async function main() {
    const argv = process.argv.slice(2);
    const args = new Set(argv);
    const chosen = years(argv);

    const { GAZETTE_EARLIEST_YEAR, GAZETTE_LATEST_YEAR, GAZETTE_MAX_ARTICLES_PER_RUN, GAZETTE_REQUEST_DELAY_MS } =
        await import("../config/gazette");
    for (const year of chosen) {
        if (year < GAZETTE_EARLIEST_YEAR || year > GAZETTE_LATEST_YEAR) {
            throw new Error(`The Gazette was online from ${GAZETTE_EARLIEST_YEAR} to ${GAZETTE_LATEST_YEAR}; ${year} is outside that`);
        }
    }

    const limit = args.has("--all")
        ? Number.POSITIVE_INFINITY
        : Number(value(argv, "--limit")) || GAZETTE_MAX_ARTICLES_PER_RUN;

    const { gazetteDecided, gazetteHeld, gazetteYears, ingestGazetteCoverage } = await import("../lib/gazette-coverage");

    if (args.has("--dry")) {
        const { listYear } = await import("../lib/gazette");
        const { held, refused } = await gazetteDecided();
        let total = 0;
        let pending = 0;

        for (const year of gazetteYears({ years: chosen })) {
            const captures = await listYear(year, {
                onPrefix: (prefix, found) => console.log(`list ${year} ${prefix}: ${found} article capture(s)`),
            });
            const fresh = captures.filter((capture) => !held.has(capture.fileId) && !refused.has(capture.fileId));
            total += captures.length;
            pending += fresh.length;
            console.log(`  ${year}: ${captures.length} article(s), ${fresh.length} not yet read`);
            for (const capture of fresh.slice(0, 5)) {
                console.log(`    ${capture.listedOn ?? "undated   "} ${capture.fileId}`);
            }
            if (fresh.length > 5) console.log(`    ... and ${fresh.length - 5} more`);
        }

        console.log(
            `\n${total} article(s) listed; ${pending} not yet read. At ${GAZETTE_REQUEST_DELAY_MS / 1000}s a request` +
            ` that is about ${Math.ceil((pending * GAZETTE_REQUEST_DELAY_MS) / 3_600_000)} hour(s) of fetching.` +
            "\nNothing was fetched or stored.",
        );
        return;
    }

    console.log(
        `reading the Wayback Machine at ${GAZETTE_REQUEST_DELAY_MS / 1000}s between requests,` +
        ` up to ${Number.isFinite(limit) ? limit : "every"} article(s)\n`,
    );

    const summary = await ingestGazetteCoverage({
        years: chosen.length ? chosen : undefined,
        refetch: args.has("--refetch"),
        limit,
        onListing: (year, prefix, found) => console.log(`list ${year} ${prefix}: ${found} article capture(s)`),
        onEvent: (event) => {
            // A refusal is the common case, about nineteen in twenty; printing
            // each would bury the articles that were kept.
            if (event.status === "rejected") return;
            console.log(
                `${event.status.padEnd(10)} ${(event.publishedOn ?? "undated").padEnd(10)}` +
                ` ${event.sessionNumber === null ? "  -" : String(event.sessionNumber).padStart(3)}` +
                ` [${event.phrases.join(", ") || "no phrase"}] ${event.headline}`,
            );
        },
    });

    console.log("\ngazette:", summary);

    if (summary.budgetReached) {
        const from = summary.completedThrough === null ? "the start" : `after ${summary.completedThrough}`;
        console.log(`\nStopped on the article budget, ${from}. Run again to carry on; nothing above is fetched twice.`);
    }

    const held = await gazetteHeld();
    const range =
        held.earliest && held.latest
            ? ` spanning ${held.earliest.toISOString().slice(0, 10)} to ${held.latest.toISOString().slice(0, 10)}`
            : "";
    console.log(`\nthe archive now holds ${held.count} Gazette article(s)${range}`);
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
