import { timingSafeEqual } from "node:crypto";

import { generateStaleSections } from "@/lib/generate";
import { pruneEphemeral } from "@/lib/prune";
import {
    SUMMARY_RUN_BUDGET,
    type SummarizeResult,
    summarizeStaleDocuments,
} from "@/lib/summarize";
import { syncMasterFolder } from "@/lib/sync";

/**
 * The daily automated pass: re-read the master folder, then regenerate any
 * section whose sources changed and restate any document whose summary is
 * missing or out of date.
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

/** Counts rather than rows: this response is a log line, not a reading list. */
function summarised(results: SummarizeResult[]) {
    const counts = { written: 0, nothingToRestate: 0, failed: 0 };

    for (const result of results) {
        if (result.status === "fresh") counts.written += 1;
        else if (result.status === "empty") counts.nothingToRestate += 1;
        else counts.failed += 1;
    }

    return { considered: results.length, ...counts };
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

        // Not gated on this sync having changed anything, unlike the sections
        // above. A document with no summary is one nothing has been spent on
        // yet, which is the state every new document arrives in and stays in
        // until a run gets to it -- so a quiet night is when the backlog moves.
        const summaries = await summarizeStaleDocuments({
            limit: SUMMARY_RUN_BUDGET,
        });

        // Expired sessions, sign-in codes and rate buckets. Nothing reads them
        // once their clock has run out; this is so they are not kept anyway.
        const pruned = await pruneEphemeral();

        return Response.json({
            ok: true,
            sync,
            sections,
            summaries: summarised(summaries),
            pruned,
        });
    } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause);
        return Response.json({ ok: false, error: message }, { status: 500 });
    }
}
