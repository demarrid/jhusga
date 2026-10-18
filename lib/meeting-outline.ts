import type { DocumentSection } from "@/lib/outline";
import type { AgendaMatch } from "@/lib/agenda-mapping";
import type { RelatedDocument, UnresolvedLink } from "@/server/documents";

/** Keep the agenda's ancestry while locating each branch in the minutes. */
export function meetingOutline(sections: DocumentSection[], matches: AgendaMatch[], documents: RelatedDocument[], unresolved: UnresolvedLink[] = []): DocumentSection[] {
    const result = structuredClone(sections);
    const used = new Set<string>();
    const position = (section: DocumentSection): number => Number(/^section-(\d+)$/.exec(section.id)?.[1] ?? Infinity);
    const normalize = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    const place = (rows: DocumentSection[], match: AgendaMatch, links: { title: string; href: string }[]): DocumentSection => {
        const authored = rows.filter(row => Number.isFinite(position(row)));
        const parent = authored.find((row, index) => position(row) <= match.startOffset && match.startOffset < (authored[index + 1] ? position(authored[index + 1]) : Infinity));
        if (parent && normalize(parent.title) === normalize(match.title)) {
            parent.href = match.minutesHref;
            parent.documentLinks = [...(parent.documentLinks ?? []), ...links];
            return parent;
        }
        if (parent) return place(parent.children, match, links);
        const added = { id: `agenda-${match.agendaId}-${match.sectionId}-${match.startOffset}`, title: match.title,
            href: match.minutesHref, documentLinks: links, children: [] };
        rows.push(added);
        const offset = (row: DocumentSection) => row.id.startsWith("agenda-") ? Number(row.id.split("-").at(-1)) : position(row);
        rows.sort((a, b) => offset(a) - offset(b));
        return added;
    };
    const branches = new Map<string, DocumentSection>();
    for (const match of [...matches].sort((a, b) => a.startOffset - b.startOffset)) {
        const links = documents.filter(document => match.linkedDocumentIds?.includes(document.id)).map(document => {
            used.add(document.id);
            return { title: document.anchorText || document.title, href: `/documents/${document.id}` };
        });
        let siblings = result;
        for (const ancestor of match.ancestors ?? []) {
            const key = `${match.agendaId}:${ancestor.id}`;
            let branch = branches.get(key);
            if (!branch) {
                branch = place(siblings, { ...match, sectionId: ancestor.id, title: ancestor.title }, []);
                branches.set(key, branch);
            }
            siblings = branch.children;
        }
        const key = `${match.agendaId}:${match.sectionId}`;
        const existing = branches.get(key);
        if (existing) {
            existing.documentLinks = [...new Map([...(existing.documentLinks ?? []), ...links].map(link => [link.href, link])).values()];
        } else {
            branches.set(key, place(siblings, match, links));
        }
    }
    // Retain actual links that have no inferred passage rather than inventing a match.
    const remaining = [
        ...documents.filter(document => !used.has(document.id)).map(document => ({ title: document.anchorText || document.title, href: `/documents/${document.id}` })),
        ...unresolved.map(link => ({ title: link.text || "Document", href: link.url })),
    ];
    if (remaining.length) result.push({ id: "linked-documents", title: "Documents", group: true, documentLinks: remaining, children: [] });
    return result;
}
