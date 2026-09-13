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

/**
 * Midnight UTC on 1 June of the session's first calendar year.
 *
 * Sessions turn over in June (see sessionForDate in lib/identity.ts), so a
 * seat recorded for the 113th starts here and, unless still held, ends when
 * the 114th begins. Used to give non-consecutive terms distinct start dates:
 * the same person can be RSO senator as a sophomore, leave, and sit as a KSAS
 * senator as a senior, and the two rows do not collide.
 */
export function sessionStartDate(session: number): Date {
    return new Date(Date.UTC(academicYearStart(session), 5, 1, 12, 0, 0));
}

/** The instant the next session begins, i.e. when this one's seats lapse. */
export function sessionEndDate(session: number): Date {
    return sessionStartDate(session + 1);
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
