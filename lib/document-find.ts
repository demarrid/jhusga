/**
 * Ranking document-finder results by how closely they match the query.
 *
 * Every row the listing returns already contains the typed string somewhere,
 * so what separates them is where. Sorted by date alone, "rules bill" put
 * this week's bylaws -- which mention the rules bill in passing -- above the
 * rules bill itself. A match in the title outranks one in the blurb, and a
 * match only in the body ranks by date among the rest.
 */

export function documentFindRank(
    fields: { title: string; description?: string; summary?: string },
    query: string,
): number {
    const phrase = query.trim().toLowerCase();
    if (!phrase) return 0;

    const terms = phrase.split(/\s+/).filter(Boolean);
    const title = fields.title.toLowerCase();
    const blurb = `${fields.description ?? ""}\n${fields.summary ?? ""}`.toLowerCase();

    let score = 0;

    if (title.includes(phrase)) score += 10_000;
    else if (terms.every((term) => title.includes(term))) score += 5_000;

    for (const term of terms) {
        if (title.includes(term)) score += 100;
    }

    if (blurb.includes(phrase)) score += 800;
    else if (terms.every((term) => blurb.includes(term))) score += 400;

    return score;
}
