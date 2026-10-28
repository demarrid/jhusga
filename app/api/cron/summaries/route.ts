import { invalidateArchiveCache } from "@/lib/archive-cache";
import { timingSafeEqual } from "node:crypto";

import { summarizeStaleDocuments, SUMMARY_RUN_BUDGET } from "@/lib/summarize";

/** An independent budget so ingestion cannot starve document summaries. */
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
        const results = await summarizeStaleDocuments({ limit: SUMMARY_RUN_BUDGET, deadline: Date.now() + 260_000 });
        return Response.json({ ok: true, considered: results.length, written: results.filter(row => row.status === "fresh" && !row.skipped).length, failed: results.filter(row => row.status === "failed").length });
    } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause);
        return Response.json({ ok: false, error: message }, { status: 500 });
    } finally {
        invalidateArchiveCache();
    }
}
