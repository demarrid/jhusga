import type { Prisma } from '@prisma/client';
import { parseDocumentQuery } from './document-query';

export function documentQueryFilter(query: string): Prisma.DocumentWhereInput {
    const groups = parseDocumentQuery(query);
    if (!groups.length) return {};
    return { OR: groups.map(group => ({ AND: group.map(term => {
        // Escape LIKE wildcards: quoted phrases and normal terms are literal text.
        const contains = term.text.replace(/[\\%_]/g, '\\$&');
        const match: Prisma.DocumentWhereInput = { OR: [
            { title: { contains, mode: 'insensitive' } },
            { displayTitle: { contains, mode: 'insensitive' } },
            { description: { contains, mode: 'insensitive' } },
            { content: { contains, mode: 'insensitive' } },
            { contributors: { some: { hopkinsAffiliate: { name: { contains, mode: 'insensitive' } } } } },
        ] };
        return term.excluded ? { NOT: match } : match;
    }) })) };
}
