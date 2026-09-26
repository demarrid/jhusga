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

/** Three and a half minutes in, against the five-minute maxDuration above. */
const MODEL_WORK_CUTOFF_MS = 210_000;

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

    const startedAt = Date.now();
    // No model call is started after this point. One already running is let
    // finish, and a single call can take tens of seconds, so the margin
    // against maxDuration is wide.
    const modelDeadline = startedAt + MODEL_WORK_CUTOFF_MS;

    try {
        const sync = await syncMasterFolder({ trigger: "cron" });

        // Every run, not only when this sync changed something: a section
        // whose sources are unchanged is skipped without a model call, and a
        // run that hit the deadline last night leaves sections to finish.
        const sectionsStarted = Date.now();
        const sections = await generateStaleSections({ deadline: modelDeadline });
        const sectionsMs = Date.now() - sectionsStarted;
        console.log(`sync phase sections: ${sectionsMs}ms`);

        // A document with no summary is one nothing has been spent on yet,
        // which is the state every new document arrives in and stays in until
        // a run gets to it -- so a quiet night is when the backlog moves.
        const summariesStarted = Date.now();
        const summaries = await summarizeStaleDocuments({
            limit: SUMMARY_RUN_BUDGET,
            deadline: modelDeadline,
        });
        const summariesMs = Date.now() - summariesStarted;
        console.log(`sync phase summaries: ${summariesMs}ms`);

        // Expired sessions, sign-in codes and rate buckets. Nothing reads them
        // once their clock has run out; this is so they are not kept anyway.
        const pruned = await pruneEphemeral();

        const totalMs = Date.now() - startedAt;
        console.log(`sync total: ${totalMs}ms`);

        return Response.json({
            ok: true,
            sync,
            sections,
            summaries: summarised(summaries),
            pruned,
            timings: {
                ...sync.timings,
                sections: sectionsMs,
                summaries: summariesMs,
                total: totalMs,
            },
        });
    } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause);
        return Response.json({ ok: false, error: message }, { status: 500 });
    }
}
