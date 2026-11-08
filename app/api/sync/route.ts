import { after } from "next/server";

import { invalidateArchiveCache } from "@/lib/archive-cache";
import { MANUAL_SYNC_COOLDOWN_MS, manualSyncEnabled } from "@/config/sync";
import { demoModeEnabled } from "@/lib/data-mode";
import { prisma } from "@/lib/prisma";
import { consumeRateLimit } from "@/lib/ratelimit";
import {
    abandonSyncRun,
    activeSyncRun,
    continueSyncRun,
    isAbandoned,
    isStalled,
    startSyncRun,
    syncRunStatus,
} from "@/lib/sync-run";

/**
 * The Request sync button on the documents page.
 *
 * The same pass the nightly cron runs, started by a reader. Anyone can press
 * it, so it is guarded four ways: `MANUAL_SYNC_ENABLED=false` turns it off,
 * the request has to come from this site, only one sync runs at a time with a
 * cooldown after each, and each network is rate limited on top of that.
 *
 * POST starts the run, or resumes one that stalled, and answers at once; the
 * run is worked through in slices after the response (lib/sync-run.ts). GET
 * reports on it, which is what the button polls until the run is done.
 */

export const dynamic = "force-dynamic";
// Keep this literal within the deployed Hobby plan limit; see config/sync.ts.
export const maxDuration = 60;

function reply(status: number, ok: boolean, message: string, runId?: string) {
    return Response.json({ ok, message, ...(runId ? { runId } : {}) }, { status });
}

/** Browsers send Origin on every POST; a page on another site cannot fake it. */
function sameSite(request: Request): boolean {
    const origin = request.headers.get("origin");
    const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
    if (!origin || !host) return false;

    try {
        return new URL(origin).host === host;
    } catch {
        return false;
    }
}

function minutes(ms: number): string {
    const count = Math.max(1, Math.ceil(ms / 60_000));
    return `${count} minute${count === 1 ? "" : "s"}`;
}

function work(runId: string, request: Request) {
    const origin = new URL(request.url).origin;
    after(async () => {
        try {
            await continueSyncRun(runId, origin);
        } finally {
            invalidateArchiveCache();
        }
    });
}

export async function POST(request: Request) {
    if (!manualSyncEnabled()) return reply(403, false, "Manual sync is turned off.");
    if (demoModeEnabled()) return reply(403, false, "Sync is not available in demo mode.");
    if (!sameSite(request)) return reply(403, false, "Request sync from the documents page.");

    const now = Date.now();

    const active = await activeSyncRun();
    if (active && isAbandoned(active, now)) {
        await abandonSyncRun(active.id);
    } else if (active && isStalled(active, now)) {
        work(active.id, request);
        return reply(202, true, "Resuming the sync that was interrupted.", active.id);
    } else if (active) {
        return reply(202, true, "A sync is already running.", active.id);
    }

    const last = await prisma.syncRun.findFirst({
        where: { status: "success", finishedAt: { not: null } },
        orderBy: { finishedAt: "desc" },
        select: { finishedAt: true },
    });
    const sinceLast = last?.finishedAt ? now - last.finishedAt.getTime() : Infinity;
    if (sinceLast < MANUAL_SYNC_COOLDOWN_MS) {
        return reply(
            429,
            false,
            `Synced ${minutes(sinceLast)} ago. Try again in ${minutes(MANUAL_SYNC_COOLDOWN_MS - sinceLast)}.`,
        );
    }

    // Counted only once the request would otherwise run, so pressing the
    // button during a cooldown does not use up a reader's allowance.
    const verdict = await consumeRateLimit("sync_request");
    if (!verdict.allowed) {
        return reply(
            429,
            false,
            `Too many sync requests. Try again in ${minutes(verdict.retryAfterSeconds * 1_000)}.`,
        );
    }

    const runId = await startSyncRun("button");
    work(runId, request);
    return reply(202, true, "Sync started.", runId);
}

export async function GET(request: Request) {
    if (demoModeEnabled()) return reply(404, false, "Sync is not available in demo mode.");

    const runId = new URL(request.url).searchParams.get("run") ?? undefined;
    const status = await syncRunStatus(runId);
    if (!status) return reply(404, false, "No such sync.");

    const message =
        status.status === "running"
            ? `${status.label}…`
            : status.status === "success"
                ? status.documentsChanged === 0
                    ? "Synced. Nothing had changed in Drive."
                    : `Synced. ${status.documentsChanged} document${status.documentsChanged === 1 ? "" : "s"} updated.`
                : "The sync failed. It will be retried tonight.";

    return Response.json({
        ok: status.status !== "error",
        runId: status.runId,
        status: status.status,
        stalled: status.stalled,
        message,
    });
}
