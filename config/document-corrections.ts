/** Reviewed archive metadata; original filenames and source text remain intact. */
export const DOCUMENT_CORRECTIONS: Record<string, { displayTitle: string; datedOn?: string | null }> = {
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
