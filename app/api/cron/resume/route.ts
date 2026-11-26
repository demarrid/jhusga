import { after } from "next/server";

import { invalidateArchiveCache } from "@/lib/archive-cache";
import { hasCronSecret } from "@/lib/cron-auth";
import { continueSyncRun, stalledSyncRun } from "@/lib/sync-run";

/**
 * Picks up a run whose hand-off was lost, and does nothing else.
 *
 * A run hands itself from slice to slice by calling /api/sync/continue, and
 * Vercel's recursion protection cuts that chain off with HTTP 508 after a few
 * hops. Without this the run waited for the next daily cron. Hobby allows each
 * cron job once a day, so vercel.json lists this path once per hour; each
 * request is a fresh chain. It never starts a run, so the daily summary budget
 * and Drive pass are unchanged; see lib/sync-run.ts.
 */

export const dynamic = "force-dynamic";
// Keep this literal within the deployed Hobby plan limit; see config/sync.ts.
export const maxDuration = 60;

export async function GET(request: Request) {
    if (!process.env.CRON_SECRET) {
        return Response.json(
            { error: "CRON_SECRET is not configured" },
            { status: 500 },
        );
    }

    if (!hasCronSecret(request)) {
        return Response.json({ error: "Unauthorised" }, { status: 401 });
    }

    const run = await stalledSyncRun();
    if (!run) {
        return Response.json({ ok: true, message: "No stalled sync to resume." });
    }

    const origin = new URL(request.url).origin;
    after(async () => {
        try {
            await continueSyncRun(run.id, origin);
        } finally {
            invalidateArchiveCache();
        }
    });

    return Response.json(
        { ok: true, runId: run.id, message: "Resumed the interrupted sync." },
        { status: 202 },
    );
}
