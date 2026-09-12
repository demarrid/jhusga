import { timingSafeEqual } from "node:crypto";

import { NEWSLETTER_RUN_BUDGET_MS } from "@/config/newsletter";
import { ingestNewsletterCoverage } from "@/lib/coverage";

/**
 * The daily pass over The Johns Hopkins News-Letter.
 *
 * A route of its own rather than a step inside /api/cron/sync, because the two
 * jobs are bounded by different things. The Drive sync is bounded by how much
 * the SGA changed, which is usually nothing and always finishes. This one is
 * bounded by a crawl delay the paper asked for in robots.txt, and honouring it
 * means a single run cannot finish -- ten seconds an article against a serverless
 * function's five minutes is about twenty articles. Folding that into the sync
 * would give a job that reliably times out and a sync that stops reporting.
 *
 * So the run stops itself on a budget and says so, and the next night carries
 * on: an article already stored is skipped without a request. Reaching 2008 from
 * an empty database this way takes months, which is why `npm run newsletter --
 * --backfill` exists and is the intended way to do the first load.
 */

export const dynamic = "force-dynamic";
export const maxDuration = 300;

function isAuthorised(request: Request): boolean {
    const secret = process.env.CRON_SECRET;
    if (!secret) return false;

    const provided = request.headers.get("authorization") ?? "";
    const expected = `Bearer ${secret}`;

    // Equal-length buffers are required by timingSafeEqual.
    const providedBuffer = Buffer.from(provided);
    const expectedBuffer = Buffer.from(expected);
    if (providedBuffer.length !== expectedBuffer.length) return false;

    return timingSafeEqual(providedBuffer, expectedBuffer);
}

export async function GET(request: Request) {
    if (!process.env.CRON_SECRET) {
        return Response.json(
            { error: "CRON_SECRET is not configured" },
            { status: 500 },
        );
    }

    if (!isAuthorised(request)) {
        return Response.json({ error: "Unauthorised" }, { status: 401 });
    }

    try {
        const newsletter = await ingestNewsletterCoverage({
            // A little under the platform's limit, so the run records what it
            // did instead of being killed mid-article with nothing to show.
            runBudgetMs: Math.min(NEWSLETTER_RUN_BUDGET_MS, 240_000),
        });

        return Response.json({ ok: true, newsletter });
    } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause);
        return Response.json({ ok: false, error: message }, { status: 500 });
    }
}
