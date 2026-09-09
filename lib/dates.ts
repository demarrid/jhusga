/**
 * Dates as the site shows them.
 *
 * The timezone is pinned to Baltimore rather than left to the machine doing
 * the rendering. Drive stores UTC instants, and a document filed at 9pm on a
 * Tuesday would otherwise be dated Wednesday on a server running in UTC --
 * which matters here, because a meeting date is often the whole point of the
 * document.
 */
const ZONE = "America/New_York";

/** "September 8, 2026". For anywhere a reader reads the date as a date. */
export function formatDate(date: Date | null | undefined): string | null {
    if (!date) return null;

    return date.toLocaleDateString("en-US", {
        timeZone: ZONE,
        year: "numeric",
        month: "long",
        day: "numeric",
    });
}

/** "Sep 8, 2026". For listings, where the date sits beside other metadata. */
export function formatDateShort(date: Date | null | undefined): string | null {
    if (!date) return null;

    return date.toLocaleDateString("en-US", {
        timeZone: ZONE,
        year: "numeric",
        month: "short",
        day: "numeric",
    });
}

/**
 * "09/08/26". For the date a standardised title carries, where the whole
 * point is that every title in a listing is the same width and sorts by eye.
 */
export function formatDateNumeric(date: Date | null | undefined): string | null {
    if (!date) return null;

    return date.toLocaleDateString("en-US", {
        timeZone: ZONE,
        year: "2-digit",
        month: "2-digit",
        day: "2-digit",
    });
}

/** "September 8, 2026 at 9:14 PM". For hover text, where precision is cheap. */
export function formatDateTime(date: Date | null | undefined): string | null {
    if (!date) return null;

    return date.toLocaleString("en-US", {
        timeZone: ZONE,
        year: "numeric",
        month: "long",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
    });
}
