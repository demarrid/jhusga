/**
 * Delete the rows that exist only until a clock runs out.
 *
 *   npm run prune
 *
 * See lib/prune.ts for why this is worth doing when nothing depends on it.
 * Safe at any time; worth running nightly, alongside the sync, which already
 * does it at the end of its own pass.
 */

import path from "node:path";

process.loadEnvFile(path.join(process.cwd(), ".env"));

async function main() {
    const { pruneEphemeral } = await import("../lib/prune");
    const { prisma } = await import("../lib/prisma");

    try {
        const result = await pruneEphemeral();
        console.log(`Expired sessions deleted:           ${result.sessions}`);
        console.log(`Expired sign-in codes deleted:      ${result.codes}`);
        console.log(`Expired rate-limit buckets deleted: ${result.rateBuckets}`);
    } finally {
        await prisma.$disconnect();
    }
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
