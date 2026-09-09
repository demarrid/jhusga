import { timingSafeEqual } from "node:crypto";

import { generateStaleSections } from "@/lib/generate";
import { syncMasterFolder } from "@/lib/sync";

/**
 * The daily automated pass: re-read the master folder, then regenerate any
 * section whose sources changed.
 *
 * Vercel Cron sends `Authorization: Bearer $CRON_SECRET` when CRON_SECRET is
 * set on the project, so the same check covers both the scheduler and manual
 * curl invocations.
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
        const sync = await syncMasterFolder({ trigger: "cron" });

        // Only worth spending model calls when something actually changed.
        const documentsChanged = sync.documentsCreated + sync.documentsUpdated;
        const sections =
            documentsChanged > 0 ? await generateStaleSections() : [];

        return Response.json({
            ok: true,
            sync,
            sections,
        });
    } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause);
        return Response.json({ ok: false, error: message }, { status: 500 });
    }
}
