import { generateStaleSections, type GenerateSectionResult } from "@/lib/generate";
import { pruneEphemeral } from "@/lib/prune";
import {
    SUMMARY_RUN_BUDGET,
    type SummarizeResult,
    summarizeStaleDocuments,
} from "@/lib/summarize";
import { type SyncSummary, type SyncTrigger, syncMasterFolder } from "@/lib/sync";

/**
 * Everything a scheduled sync does, for the two routes that start one: the
 * nightly cron and the Request sync button. Re-read the master folder, then
 * regenerate any section whose sources changed, restate any document whose
 * summary is missing or out of date, and clear expired rows.
 */

/**
 * No model call is started after this long. One already running is let
 * finish, and a single call can take tens of seconds, so the margin against
 * a five-minute maxDuration is wide.
 */
export const MODEL_WORK_CUTOFF_MS = 210_000;

export type FullSyncResult = {
    sync: SyncSummary;
    sections: GenerateSectionResult[];
    summaries: { considered: number; written: number; nothingToRestate: number; failed: number };
    pruned: Awaited<ReturnType<typeof pruneEphemeral>>;
    timings: Record<string, number>;
};

/** Counts rather than rows: this is a log line, not a reading list. */
function summarised(results: SummarizeResult[]): FullSyncResult["summaries"] {
    const counts = { written: 0, nothingToRestate: 0, failed: 0 };

    for (const result of results) {
        if (result.status === "fresh") counts.written += 1;
        else if (result.status === "empty") counts.nothingToRestate += 1;
        else counts.failed += 1;
    }

    return { considered: results.length, ...counts };
}

export async function runFullSync(trigger: SyncTrigger): Promise<FullSyncResult> {
    const startedAt = Date.now();
    const modelDeadline = startedAt + MODEL_WORK_CUTOFF_MS;

    const sync = await syncMasterFolder({ trigger });

    // Every run, not only when this sync changed something: a section whose
    // sources are unchanged is skipped without a model call, and a run that
    // hit the deadline last time leaves sections to finish.
    const sectionsStarted = Date.now();
    const sections = await generateStaleSections({ deadline: modelDeadline });
    const sectionsMs = Date.now() - sectionsStarted;
    console.log(`sync phase sections: ${sectionsMs}ms`);

    // A document with no summary is one nothing has been spent on yet, which
    // is the state every new document arrives in and stays in until a run
    // gets to it -- so a quiet night is when the backlog moves.
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

    return {
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
    };
}
