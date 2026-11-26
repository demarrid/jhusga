import { revalidateTag } from "next/cache";

export const ARCHIVE_CACHE_TAG = "archive-derived";

// CLI imports/reviews cannot invalidate the deployed Next cache. Refresh on
// demand after an hour too, including time-dependent homepage eligibility.
// Cached pages inherit this lifetime from the reads they make, so it also sets
// how often a busy page is re-rendered: shorter costs function CPU on every
// popular page, not just a database read.
export const ARCHIVE_CACHE_SECONDS = 60 * 60;

// Roles change with archive updates, not the homepage clock. Sync invalidates
// this tag immediately; the fallback also picks up out-of-band CLI changes.
export const DIRECTORY_CACHE_SECONDS = 6 * 60 * 60;

// Keep the existing router configuration: unstable_cache supports database
// reads without the app-wide Cache Components migration required by use cache.
export function invalidateArchiveCache(): void {
    // Expire both the carousel and its directory inputs together, so rebuilding
    // the carousel cannot capture stale offices after an archive update.
    revalidateTag(ARCHIVE_CACHE_TAG, { expire: 0 });
}
