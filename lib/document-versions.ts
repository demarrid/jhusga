import { DOCUMENT_DATE_LABELS, formatDate } from "@/lib/dates";
import { normalizedDateDay } from "@/lib/document-date-value";

/**
 * The stated day versions are chosen against, or null when the document has
 * none. A partial AI date (a year, month, or session range such as 2026/2027)
 * keeps datedAt only as a sort anchor, as do reviewed partial archive labels;
 * treating that anchor as a day would pick an early version, or the earliest
 * when every edit came after it.
 */
export function versionCutoffDate(document: { id: string; datedAt?: Date | null; aiDateValue?: string | null }): Date | null {
    if (!document.datedAt) return null;
    const value = document.aiDateValue?.trim();
    if (value) return normalizedDateDay(value) ? document.datedAt : null;
    return DOCUMENT_DATE_LABELS[document.id] ? null : document.datedAt;
}

export type DocumentVersionOption = {
    id: string;
    modifiedAt: string | null;
    observedAt: string;
    label: string;
};

/** Compare campus calendar days, including both DST transitions. */
export function versionDay(instant: string | Date): string {
    const parts = new Intl.DateTimeFormat("en-US", {
        timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
    }).formatToParts(new Date(instant));
    return ["year", "month", "day"].map(type => parts.find(part => part.type === type)!.value).join("-");
}

export function versionOptions(rows: Omit<DocumentVersionOption, "label">[]): DocumentVersionOption[] {
    const counts = new Map<string, number>();
    for (const row of rows) {
        const day = versionDay(row.modifiedAt ?? row.observedAt);
        counts.set(day, (counts.get(day) ?? 0) + 1);
    }
    return rows.map(row => {
        const instant = new Date(row.modifiedAt ?? row.observedAt);
        const time = (counts.get(versionDay(instant)) ?? 0) > 1
            ? `, ${instant.toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit", second: "2-digit", timeZoneName: "short" })}` : "";
        return { ...row, label: `${formatDate(instant)}${time}${row.modifiedAt ? "" : " (first saved)"}` };
    });
}

/** Rows are chronological. An explicit version always overrides the default. */
export function selectDocumentVersion(versions: DocumentVersionOption[], datedAt: Date | null, requested?: string) {
    const latest = versions.at(-1);
    if (!latest) return null;
    const cutoff = datedAt ? versionDay(datedAt) : null;
    const asOf = cutoff ? versions.filter(row => versionDay(row.modifiedAt ?? row.observedAt) <= cutoff).at(-1) : latest;
    const selected = requested === "latest" ? latest
        : requested ? versions.find(row => row.id === requested)
        : asOf ?? versions[0];
    if (!selected) return null;
    return { selected, latest, missingDatedVersion: !!cutoff && !asOf };
}
