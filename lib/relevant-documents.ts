import type { RelatedDocument, UnresolvedLink } from "@/server/documents";
import { extractDocumentLinks } from "@/lib/links";

/** Agenda order first; each linked target appears once with its provenance. */
export function relevantDocuments(agenda: RelatedDocument[], minutes: RelatedDocument[], excluded: string[] = []) {
    const documents = new Map<string, RelatedDocument>();
    const sources: Record<string, string[]> = {};
    for (const [label, rows] of [["Agenda", agenda], ["Minutes", minutes]] as const) {
        for (const row of rows) {
            if (excluded.includes(row.id)) continue;
            if (!documents.has(row.id)) documents.set(row.id, row);
            const labels = sources[row.id] ??= [];
            if (!labels.includes(label)) labels.push(label);
        }
    }
    return { documents: [...documents.values()], sources };
}

export function uniqueUnresolvedLinks(links: UnresolvedLink[]): UnresolvedLink[] {
    const unique = new Map<string, UnresolvedLink>();
    for (const link of links) {
        const key = extractDocumentLinks(link.url)[0]?.fileId ?? link.url;
        if (!unique.has(key)) unique.set(key, link);
    }
    return [...unique.values()];
}
