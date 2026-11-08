/**
 * The Request sync button on the documents page.
 *
 * On unless `MANUAL_SYNC_ENABLED=false`. Read on the server both when the page
 * renders, to decide whether to show the button, and when a request arrives,
 * so turning it off takes effect for a tab that is already open.
 */
export function manualSyncEnabled(): boolean {
    return process.env.MANUAL_SYNC_ENABLED?.trim().toLowerCase() !== "false";
}

/**
 * How soon after a sync finishes the button will start another, in
 * milliseconds. Site-wide rather than per reader: one sync is enough for
 * everybody, and Drive does not change fast enough to justify more.
 */
export const MANUAL_SYNC_COOLDOWN_MS = Number(
    process.env.MANUAL_SYNC_COOLDOWN_MS || 10 * 60_000,
);

/**
 * The function time limit every sync route declares, in seconds. The routes
 * have to repeat it as a literal for the build to read it; this is the number
 * the slice budget below is planned against.
 */
export const SYNC_FUNCTION_LIMIT_SECONDS = 60;

/**
 * How far into an invocation a sync slice keeps starting new work. What is
 * left of the function limit is for the file or pass already under way, the
 * checkpoint after it, and handing the run to the next invocation.
 */
export const SYNC_SLICE_BUDGET_MS = 40_000;

/**
 * How long an invocation holds a run. Longer than the function limit, so a
 * live slice is never preempted; once the platform has killed one, the lease
 * runs out and the next invocation can pick the run up.
 */
export const SYNC_LEASE_MS = (SYNC_FUNCTION_LIMIT_SECONDS + 15) * 1_000;

/**
 * A running sync with no checkpoint for this long, and no live lease, was cut
 * off between slices. The button or the cron resumes it from its checkpoint.
 */
export const SYNC_STALLED_AFTER_MS = 2 * 60_000;

/** A run stalled for longer than this is given up and a fresh one started. */
export const SYNC_ABANDON_AFTER_MS = 3 * 60 * 60_000;

/**
 * How many invocations in a row may start the same piece of work without
 * finishing it. One that never fits in the function limit fails the run
 * rather than being retried forever.
 */
export const SYNC_MAX_ATTEMPTS = 3;
