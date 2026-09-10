import { prisma } from "@/lib/prisma";

/**
 * Deleting the rows that only exist until a clock runs out.
 *
 * Separate from lib/login.ts and lib/ratelimit.ts, which own these tables,
 * because both of those reach for `next/headers` and so can only be imported
 * inside a request. This is the same work with no request behind it, which is
 * what the nightly script and the cron route need.
 *
 * Nothing depends on it for correctness. An expired session is rejected on
 * read, an expired code will not match, and a stale rate bucket is never
 * looked up again because the window is part of its key. It runs because an
 * expired session row is a record of somebody having signed in, and there is
 * no reason to keep one.
 */

export type PruneResult = {
    sessions: number;
    codes: number;
    rateBuckets: number;
};

export async function pruneEphemeral(): Promise<PruneResult> {
    const now = new Date();

    const [sessions, codes, rateBuckets] = await Promise.all([
        prisma.forumSession.deleteMany({ where: { expiresAt: { lt: now } } }),
        prisma.loginCode.deleteMany({ where: { expiresAt: { lt: now } } }),
        prisma.rateBucket.deleteMany({ where: { expiresAt: { lt: now } } }),
    ]);

    return {
        sessions: sessions.count,
        codes: codes.count,
        rateBuckets: rateBuckets.count,
    };
}
