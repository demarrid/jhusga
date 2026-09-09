/**
 * The current SGA session.
 *
 * Kept free of environment access so it is safe to import from client
 * components. Change this alongside MASTER_FOLDER_ID in config/sga.ts when a
 * new session begins; everything the previous session produced becomes
 * archive.
 */
export const SESSION_NUMBER = 114;

/**
 * The first calendar year of a session's academic year.
 *
 * The 1st session was 1913-1914, so the 114th is 2026-2027. Used to turn a
 * year the documents actually write ("2026-2027", "S.B.26-27") into a
 * session number, rather than guessing from Drive timestamps.
 */
export function academicYearStart(session: number): number {
    return session + 1912;
}

/** The session whose academic year begins in `year`, or null if implausible. */
export function sessionFromAcademicYearStart(year: number): number | null {
    const session = year - 1912;
    if (!Number.isInteger(session) || session < 1 || session > 300) return null;
    return session;
}

/** "114th", "113th", "1st". Handles the 11/12/13 exceptions. */
export function sessionOrdinal(session: number): string {
    const lastTwo = session % 100;
    if (lastTwo >= 11 && lastTwo <= 13) return `${session}th`;

    switch (session % 10) {
        case 1:
            return `${session}st`;
        case 2:
            return `${session}nd`;
        case 3:
            return `${session}rd`;
        default:
            return `${session}th`;
    }
}
