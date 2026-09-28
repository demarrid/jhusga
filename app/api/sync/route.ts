import {
    MANUAL_SYNC_COOLDOWN_MS,
    SYNC_STALE_AFTER_MS,
    manualSyncEnabled,
} from "@/config/sync";
import { demoModeEnabled } from "@/lib/data-mode";
import { runFullSync } from "@/lib/full-sync";
import { prisma } from "@/lib/prisma";
import { consumeRateLimit } from "@/lib/ratelimit";

/**
 * The Request sync button on the documents page.
 *
 * The same pass the nightly cron runs, started by a reader. Anyone can press
 * it, so it is guarded four ways: `MANUAL_SYNC_ENABLED=false` turns it off,
 * the request has to come from this site, only one sync runs at a time with a
 * cooldown after each, and each network is rate limited on top of that.
 */

export const dynamic = "force-dynamic";
export const maxDuration = 300;

function reply(status: number, ok: boolean, message: string) {
    return Response.json({ ok, message }, { status });
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

export async function POST(request: Request) {
    if (!manualSyncEnabled()) return reply(403, false, "Manual sync is turned off.");
    if (demoModeEnabled()) return reply(403, false, "Sync is not available in demo mode.");
    if (!sameSite(request)) return reply(403, false, "Request sync from the documents page.");

    const now = Date.now();

    const running = await prisma.syncRun.findFirst({
        where: { status: "running", startedAt: { gt: new Date(now - SYNC_STALE_AFTER_MS) } },
        select: { id: true },
    });
    if (running) return reply(409, false, "A sync is already running.");

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

    try {
        const result = await runFullSync("button");
        const changed = result.sync.documentsCreated + result.sync.documentsUpdated;
        return reply(
            200,
            true,
            changed === 0
                ? "Synced. Nothing had changed in Drive."
                : `Synced. ${changed} document${changed === 1 ? "" : "s"} updated.`,
        );
    } catch (cause) {
        console.error("Requested sync failed:", cause);
        return reply(500, false, "The sync failed. It will be retried tonight.");
    }
}
