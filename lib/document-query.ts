/** OR separates alternatives; whitespace/AND/+ combine terms; - excludes a term. */
export type QueryTerm = { text: string; excluded: boolean };
export function parseDocumentQuery(query: string): QueryTerm[][] {
    const groups: QueryTerm[][] = [[]];
    for (const token of query.match(/[+-]?"[^"]*"|[^\s]+/g) ?? []) {
        if (/^(OR|\|)$/i.test(token)) { if (groups.at(-1)!.length) groups.push([]); continue; }
        if (/^(AND|\+)$/i.test(token)) continue;
        const excluded = token.startsWith('-');
        const text = token.replace(/^[+-]/, '').replace(/^"|"$/g, '').trim();
        if (text) groups.at(-1)!.push({ text, excluded });
    }
    return groups.filter(group => group.length);
}

export function documentQueryHighlights(query: string): string[] {
    return [...new Set(parseDocumentQuery(query).flat().filter(term => !term.excluded).map(term => term.text))];
}
