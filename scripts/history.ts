import path from "node:path";
import { parseHistoryArgs } from "../lib/history-cli";

/**
 * Compute history timelines.
 *
 *   npm run history -- sexual-violence --dry-run     candidates and excerpt sizes, no model calls
 *   npm run history -- sexual-violence --limit 20    extract 20 uncached documents, then merge
 *   npm run history -- sexual-violence               everything not already cached
 *   npm run history -- --force                       every topic, ignoring the cache
 *
 * Flags: --dry-run, --force, --extract-only, --limit N.
 */
async function main() {
    const { options, slugs } = parseHistoryArgs(process.argv.slice(2));
    const { HISTORY_TOPICS } = await import("../config/history");
    const topics = slugs.length > 0 ? slugs : HISTORY_TOPICS.map((topic) => topic.slug);
    for (const slug of topics) {
        if (!HISTORY_TOPICS.some((topic) => topic.slug === slug)) throw new Error(`Unknown history topic "${slug}"`);
    }
    process.loadEnvFile(path.join(process.cwd(), ".env"));
    const { generateHistoryTopic } = await import("../lib/history-generate");

    for (const slug of topics) {
        const result = await generateHistoryTopic(slug, {
            ...options,
            log: (line) => console.log(line),
        });
        console.log("history:", result);
        if (result.extractFailures || result.mergeFailures) process.exitCode = 1;
    }
}

main()
    .catch((error) => {
        console.error(error);
        process.exitCode = 1;
    })
    .finally(async () => {
        const { prisma } = await import("../lib/prisma");
        if (process.env.DATABASE_URL) await prisma.$disconnect();
    });
