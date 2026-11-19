import path from "node:path";

process.loadEnvFile(path.join(process.cwd(), ".env"));

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
    const { HISTORY_TOPICS } = await import("../config/history");
    const { generateHistoryTopic } = await import("../lib/history-generate");

    const args = process.argv.slice(2);
    const flag = (name: string) => args.includes(`--${name}`);
    const limitAt = args.indexOf("--limit");
    const limit = limitAt === -1 ? undefined : Number(args[limitAt + 1]);
    if (limit !== undefined && !(Number.isInteger(limit) && limit >= 0)) {
        throw new Error("--limit takes a whole number");
    }

    const slugs = args.filter((arg, index) => !arg.startsWith("--") && index !== limitAt + 1);
    const topics = slugs.length > 0 ? slugs : HISTORY_TOPICS.map((topic) => topic.slug);

    for (const slug of topics) {
        const result = await generateHistoryTopic(slug, {
            force: flag("force"),
            dryRun: flag("dry-run"),
            extractOnly: flag("extract-only"),
            limit,
            log: (line) => console.log(line),
        });
        console.log("history:", result);
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
