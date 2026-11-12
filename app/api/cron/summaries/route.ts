import { after } from "next/server";

import { invalidateArchiveCache } from "@/lib/archive-cache";
import { hasCronSecret } from "@/lib/cron-auth";
import {
    abandonSyncRun,
    activeSyncRun,
    continueSyncRun,
    isAbandoned,
    isStalled,
    startSyncRun,
} from "@/lib/sync-run";

/** Independent summary recovery using the same leased, resumable run. */
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

    let active = await activeSyncRun();
    if (active && isAbandoned(active)) {
        await abandonSyncRun(active.id);
        active = null;
    }
    if (active && !isStalled(active)) {
        return Response.json({ ok: true, runId: active.id, message: "A sync is already running." });
    }

    const runId = active?.id ?? (await startSyncRun("cron", { summariesOnly: true }));
    const origin = new URL(request.url).origin;
    after(async () => {
        try {
            await continueSyncRun(runId, origin);
        } finally {
            invalidateArchiveCache();
        }
    });

    return Response.json(
        { ok: true, runId, message: active ? "Resumed the interrupted sync." : "Sync started." },
        { status: 202 },
    );
}
