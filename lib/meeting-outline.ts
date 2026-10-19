import type { DocumentSection } from "@/lib/outline";
import type { AgendaMatch } from "@/lib/agenda-mapping";
import type { RelatedDocument, UnresolvedLink } from "@/server/documents";

/** Keep the agenda's ancestry while locating each branch in the minutes. */
export function meetingOutline(sections: DocumentSection[], matches: AgendaMatch[], documents: RelatedDocument[], unresolved: UnresolvedLink[] = []): DocumentSection[] {
    const result = structuredClone(sections);
    const used = new Set<string>();
    const usedUrls = new Set<string>();
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
        links.push(...unresolved.filter(link => match.linkedUrls?.includes(link.url)).map(link => {
            usedUrls.add(link.url);
            return { title: link.text || "Document", href: link.url };
        }));
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
    // A uniquely named authored section can hold its document link even when
    // there is no generated agenda-to-minutes passage match.
    const flatten = (rows: DocumentSection[]): DocumentSection[] => rows.flatMap(row => [row, ...flatten(row.children)]);
    const candidates = flatten(result).filter(row => !row.group);
    const attach = (titles: string[], link: { title: string; href: string }) => {
        const names = new Set(titles.filter(Boolean).map(normalize));
        const matching = candidates.filter(row => names.has(normalize(row.title)) ||
            names.has(normalize(row.title.replace(/^[a-z][.)]\s+/i, "").split(/\s[-–—]\s/)[0])));
        if (matching.length !== 1) return false;
        const section = matching[0];
        section.documentLinks = [...new Map([...(section.documentLinks ?? []), link].map(item => [item.href, item])).values()];
        return true;
    };
    for (const document of documents) {
        if (!used.has(document.id) && attach([document.anchorText ?? "", document.title],
            { title: document.anchorText || document.title, href: `/documents/${document.id}` })) used.add(document.id);
    }
    for (const link of unresolved) {
        if (!usedUrls.has(link.url) && attach([link.text], { title: link.text || "Document", href: link.url })) usedUrls.add(link.url);
    }
    // Retain links with no unambiguous section rather than guessing a location.
    const remaining = [
        ...documents.filter(document => !used.has(document.id)).map(document => ({ title: document.anchorText || document.title, href: `/documents/${document.id}` })),
        ...unresolved.filter(link => !usedUrls.has(link.url)).map(link => ({ title: link.text || "Document", href: link.url })),
    ];
    if (remaining.length) result.push({ id: "linked-documents", title: "Documents", group: true, documentLinks: remaining, children: [] });
    return result;
}
