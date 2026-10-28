import { documentDate } from "@/lib/identity";
import { meetingFor, meetingLog, type MeetingInput } from "@/lib/meetings";

type DatedMeeting = MeetingInput & { id: string; content: string; datedAt?: Date | null };
const DAY = 86_400_000;
function localDay(date: Date): Date {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
    const value = (type: string) => parts.find(part => part.type === type)?.value;
    return new Date(value("year") + "-" + value("month") + "-" + value("day") + "T12:00:00Z");
}

/** Detect copied weekly headers against an independently dated earlier record.
 * Creation time alone never changes a date; migrations and late uploads are common.
 * Keep the original content untouched, and return the evidence for repair logs.
 */
export function reconcileMeetingDates(documents: DatedMeeting[]): Map<string, { date: Date; evidenceId: string; statedDate: Date }> {
    const result = new Map<string, { date: Date; evidenceId: string; statedDate: Date }>();
    const rows = documents.flatMap(document => {
        if (!document.kind?.startsWith("minutes.") || meetingLog(document)) return [];
        const meeting = meetingFor(document);
        const stated = documentDate(document) ?? document.datedAt;
        if (!meeting.key || meeting.role !== "minutes" || !stated || !document.driveCreatedTime) return [];
        const created = localDay(document.driveCreatedTime);
        return [{ document, stated, created, body: meeting.key.slice(0, meeting.key.lastIndexOf(":")) }];
    });
    for (const row of rows) {
        const elapsed = Math.round((row.created.getTime() - row.stated.getTime()) / DAY);
        const weeks = Math.round(elapsed / 7);
        if (weeks < 1 || weeks > 6 || Math.abs(elapsed - weeks * 7) > 1) continue;
        const peer = rows.find(other => other.document.id !== row.document.id && other.body === row.body &&
            other.stated.getTime() === row.stated.getTime() &&
            Math.abs(other.created.getTime() - other.stated.getTime()) <= DAY);
        if (!peer) continue;
        const date = new Date(row.stated.getTime() + weeks * 7 * DAY);
        result.set(row.document.id, { date, evidenceId: peer.document.id, statedDate: row.stated });
    }
    return result;
}

/** Contradictory chronology is not a dated passage claim. */
export function passageDateFitsDocument(passed: Date, document: { title: string; content: string }): boolean {
    const presented = documentDate(document);
    return !presented || passed.toISOString().slice(0, 10) >= presented.toISOString().slice(0, 10);
}
