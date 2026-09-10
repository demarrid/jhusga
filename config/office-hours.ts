/**
 * Published office hours.
 *
 * The one part of the contact page that is not read out of the archive, and
 * marked as such on the page. Office hours are set in Slack and GroupMe and
 * changed mid-semester; there is no document to cite, and inventing one would
 * be worse than saying plainly that a person maintains this list.
 *
 * `name` should match the contact directory exactly, so the two line up.
 * Clear the list when a session ends: stale office hours send someone to an
 * empty room, which is worse than none at all.
 */

export type OfficeHour = {
    name: string;
    /** The office they hold these hours in, if it is not obvious from the directory. */
    position?: string;
    /** As a reader would say it: "Tuesdays, 3–4pm". */
    when: string;
    where: string;
    /** A booking link, where one is used instead of dropping in. */
    href?: string;
    note?: string;
};

/** When this list was last checked, ISO date. Shown to the reader. */
export const OFFICE_HOURS_CHECKED: string = "";

export const OFFICE_HOURS: OfficeHour[] = [];
