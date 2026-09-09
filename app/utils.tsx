import { SESSION_NUMBER, sessionOrdinal } from "@/config/session";

export { SESSION_NUMBER };

export function getSessionString() {
    return sessionOrdinal(SESSION_NUMBER);
}
