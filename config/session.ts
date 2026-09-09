/**
 * The current SGA session.
 *
 * Kept free of environment access so it is safe to import from client
 * components. Change this alongside MASTER_FOLDER_ID in config/sga.ts when a
 * new session begins; everything the previous session produced becomes
 * archive.
 */
export const SESSION_NUMBER = 114;

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
