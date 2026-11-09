import { after } from "next/server";

import { invalidateArchiveCache } from "@/lib/archive-cache";
import { hasCronSecret } from "@/lib/cron-auth";
import { continueSyncRun } from "@/lib/sync-run";

/**
 * The next slice of a sync already under way. Only the sync itself calls this,
 * at the end of a slice that left work over; see lib/sync-run.ts.
 *
 * It answers before doing anything, so the slice that called it can finish,
 * and does its own slice after the response.
 */

export const dynamic = "force-dynamic";
// Keep this literal within the deployed Hobby plan limit; see config/sync.ts.
export const maxDuration = 60;

export async function POST(request: Request) {
    if (!hasCronSecret(request)) {
        return Response.json({ error: "Unauthorised" }, { status: 401 });
    }

    const body = (await request.json().catch(() => null)) as { runId?: unknown } | null;
    if (typeof body?.runId !== "string") {
        return Response.json({ error: "runId is required" }, { status: 400 });
    }

    const runId = body.runId;
    const origin = new URL(request.url).origin;
    after(async () => {
        try {
            await continueSyncRun(runId, origin);
        } finally {
            invalidateArchiveCache();
        }
    });

    return Response.json({ ok: true, runId }, { status: 202 });
}
