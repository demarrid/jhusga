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

/** The pieces of a document a listing reads a date off. */
export type DatedDocument = {
    /** The date the document states, when it states one. */
    datedAt: Date | null;
    driveCreatedTime: Date | null;
    driveModifiedTime: Date | null;
};

/**
 * The date a document is filed under.
 *
 * What the document says about itself first, and only then what Drive says.
 * A bill copied from last year's template has a createdTime from last July,
 * so Drive is the answer of last resort rather than the first one.
 */
export function listedDate(document: DatedDocument): Date | null {
    return document.datedAt ?? document.driveCreatedTime ?? document.driveModifiedTime;
}

/**
 * Newest first, which is the order a record is read in.
 *
 * Someone opening the listing wants this week's meeting, not the constitution
 * that has sat at the top of the alphabet since 2019. Documents the archive
 * cannot date sink below the ones it can, rather than being dated zero and
 * taking the bottom of the list in a random order.
 */
export function byNewestFirst<T extends DatedDocument & { title: string }>(
    left: T,
    right: T,
): number {
    const a = listedDate(left);
    const b = listedDate(right);

    if (a && b && a.getTime() !== b.getTime()) return b.getTime() - a.getTime();
    if (a && !b) return -1;
    if (b && !a) return 1;

    return left.title.localeCompare(right.title, undefined, { sensitivity: "base" });
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
