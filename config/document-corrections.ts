/** Reviewed archive metadata; original filenames and source text remain intact. */
export const DOCUMENT_CORRECTIONS: Record<string, { displayTitle: string; datedOn?: string | null }> = {
    // Spring 2020 HSS folder, filename 2_14, and notes that still treat April
    // as upcoming. The meeting is with CHEW, so the committee folder must not
    // replace that name.
    "1le-nVHzhSp1NDlYhiIyW2IE7KgWPCGTQ": {
        displayTitle: "CHEW Meeting — Minutes (02/14/20)",
        datedOn: "2020-02-14",
    },
    // 2019-2020 executive folder, filename 9_13, and notes still looking ahead
    // to October. HSA is the body named in the file and the opening line.
    "1sxgP5wX58n_yB4zTfFM7SBjMMMdP-zQs": {
        displayTitle: "Executive Board × HSA Meeting — Minutes (09/13/19)",
        datedOn: "2019-09-13",
    },
    // The junior council agenda includes attendance, discussion, and a recorded vote.
    "1hKbdFVvA1kSHzMjb5wcT3Dbkqot232cc": {
        displayTitle: "Junior Class Council Meeting — Agenda and Minutes (12/02/18)",
    },
    // The agenda was filled with attributed discussion during the lunch.
    "1UAP6U5J0pS0Vq4-1amxCZ085vLVjOEJxCpi6X_LE6Do": {
        displayTitle: "Executive Board × President Daniels Lunch — Agenda and Minutes (3/25/26)",
    },
    // Reviewed 2026-11-18: exact copy of MINUTES 12, including its old header.
    // Keep undated until a substantive, distinct meeting record is verified;
    // a filename, header, or modified-time change alone does not clear this.
    "1ZnG1_4EuxXb0-_CowTbrfaOUJ4wBjCxQv3nJsVZhJFs": {
        displayTitle: "Senate Minutes — Duplicate Copy (Meeting Date Unverified)",
        datedOn: null,
    },
    // Confirmed by the user on 2026-10-25: the October 13 header was copied
    // forward. Demarri's October 20 notes corroborate the same meeting business.
    "1eNX_J_J1joa_uuhBMnhi9cwU91rC5Q1639RzSr_wUDs": {
        displayTitle: "Senate General Body Meeting #9 — Minutes (10/20/26)",
        datedOn: "2026-10-20",
    },
    // Drive filename "Miranda_s complaint OIE": Miranda Bannister's May 5, 2019
    // email to the incoming Executive Board about the late OIE follow-up meeting.
    "1OMUZGqKDGp0uCWUwes5BwoYN5OzuZ8hc": {
        displayTitle: "Miranda Bannister's Complaint About the Late OIE Meeting",
    },
    // The completed bill retains its template filename in Drive.
    "1sK0Q2N8sjJ-WJNFAgwaZHAtxAPUzyB2x5b36m3XP7qM": {
        displayTitle: "Take Back The Night Rally Funding Bill",
    },
};

export function hasUnverifiedMeetingDate(driveFileId?: string): boolean {
    return !!driveFileId && DOCUMENT_CORRECTIONS[driveFileId]?.datedOn === null;
}

/** User-requested homepage substitute; personal notes remain excluded as vote evidence. */
export const HOMEPAGE_MINUTES_SUBSTITUTE = "1a5cF1IOX5D-nXWxEe46ds2ZyvkwImhML4ciU06I6eIw";
