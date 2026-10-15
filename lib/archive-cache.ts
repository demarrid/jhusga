import { revalidateTag } from "next/cache";

export const ARCHIVE_CACHE_TAG = "archive-derived";

// CLI imports/reviews cannot invalidate the deployed Next cache. Refresh on
// demand after 15 minutes too, including time-dependent homepage eligibility.
export const ARCHIVE_CACHE_SECONDS = 15 * 60;

// Keep the existing router configuration: unstable_cache supports database
// reads without the app-wide Cache Components migration required by use cache.
export function invalidateArchiveCache(): void {
    // Expire both the carousel and its directory inputs together, so rebuilding
    // the carousel cannot capture stale offices after an archive update.
    revalidateTag(ARCHIVE_CACHE_TAG, { expire: 0 });
}
