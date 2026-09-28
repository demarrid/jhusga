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
 * A sync still marked running after this long is assumed to have been killed
 * by the platform rather than to be in progress. Just over maxDuration.
 */
export const SYNC_STALE_AFTER_MS = 6 * 60_000;
