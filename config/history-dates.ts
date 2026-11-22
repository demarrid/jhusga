/** Reviewed contextual dates for otherwise undated sources, not printed dates.
 * Keep the archive Document.datedAt unchanged. See the linked research note.
 */
export const HISTORY_DOCUMENT_DATES: Record<string, { year: number; note: string }> = {
    "2c260844-f5e7-4de2-b8fe-505abdd9c23b": {
        year: 1989,
        note: "Date estimated: circa 1989, possibly 1989–90. The report has no printed date; its signatories and policy references place it around this period.",
    },
};

/** Event-level dates: a year-long work log must not lend one date to every row.
 * See docs/research/sexual-violence-work-log-dates.md for corroboration.
 */
export const HISTORY_FINDING_DATES = [
    {
        documentId: "203da8e0-2ec3-443b-880c-fc9cbe26c220",
        quotePattern: /jumpstarted collaboration with CHEW|foundations for an anonymous blog|reached out to SARU|interactive resources flowchart/i,
        date: "2021-04-15T12:00:00.000Z",
        precision: "month" as const,
        note: "Date reflects documentation by April 2021, not a known project start date. The April 20 WGMC Website Bill describes the collaboration, resource map, and moderated survivor blog. [Dating evidence](/documents/e33c2981-7875-4945-b27f-236b682f5c72?version=latest)",
    },
    {
        documentId: "203da8e0-2ec3-443b-880c-fc9cbe26c220",
        quotePattern: /FSL OIE Investigation Team/i,
        date: "2020-12-01T12:00:00.000Z",
        precision: "session" as const,
        note: "Dated to the 2020–21 session from the work log. The entry records attendance at investigation-team meetings but supplies no meeting dates; the nearby September 29 date belongs to the member heading.",
    },
    {
        documentId: "203da8e0-2ec3-443b-880c-fc9cbe26c220",
        quotePattern: /special forum.*(?:drugging|fraternit)|forum be held to discuss the drugging/i,
        date: "2020-11-15T12:00:00.000Z",
        precision: "month" as const,
        note: "The forum proposal was already under discussion in November 2020. Contemporary reports disagree on the initial meeting day (November 17 versus 22), so the timeline uses month precision. [Dating evidence](/documents/1a81e29f-4f4e-40c2-98b2-0576fcaf5f58?version=latest)",
    },
    {
        documentId: "243b8b92-fdd0-40f8-9531-8b4c2fa84a31",
        quotePattern: /Sexual Assault Resources|OIE Reform/i,
        date: "2019-10-29T12:00:00.000Z",
        precision: "day" as const,
        note: "Dated by the October 29, 2019 Senate agenda, which lists President Daniels Reception Topics. This establishes the agenda date, not the date of the reception itself. [Dating evidence](/documents/3ab0b069-9a87-41e4-a51e-debefae77d69?version=latest)",
    },
];

export function reviewedFindingDate(documentId: string, quote: string) {
    return HISTORY_FINDING_DATES.find((entry) => entry.documentId === documentId && entry.quotePattern.test(quote));
}
