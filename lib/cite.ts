/**
 * Footnote markers the model plants in generated prose, e.g. [1] after a claim.
 * The number is the 1-based index into that section's citations array.
 */

const MARKER = /\[(\d+)\]/g;

export type CitedPart =
    | { type: "text"; value: string }
    | { type: "cite"; index: number };

export function splitCitedParts(text: string): CitedPart[] {
    const parts: CitedPart[] = [];
    let last = 0;

    for (const match of text.matchAll(MARKER)) {
        const index = match.index ?? 0;
        if (index > last) {
            parts.push({ type: "text", value: text.slice(last, index) });
        }
        parts.push({ type: "cite", index: Number(match[1]) });
        last = index + match[0].length;
    }

    if (last < text.length) {
        parts.push({ type: "text", value: text.slice(last) });
    }

    return parts;
}

/** Citation indexes referenced in the text, 1-based, in first-seen order. */
export function citedIndexes(text: string): number[] {
    const seen = new Set<number>();
    const order: number[] = [];
    for (const part of splitCitedParts(text)) {
        if (part.type === "cite" && !seen.has(part.index)) {
            seen.add(part.index);
            order.push(part.index);
        }
    }
    return order;
}

/**
 * Map the model's original citation list onto the quotes that survived
 * verification, collapsing duplicates onto the first copy.
 *
 * `keyOf` returns a stable key for a kept quote, or null to reject it.
 * The remap is 1-based on both sides, matching `[n]` in the prose.
 */
export function assignCitationOrdinals<T>(
    items: T[],
    keyOf: (item: T) => string | null,
): { kept: T[]; remap: Map<number, number>; rejected: number } {
    const kept: T[] = [];
    const remap = new Map<number, number>();
    const indexByKey = new Map<string, number>();
    let rejected = 0;

    for (const [i, item] of items.entries()) {
        const key = keyOf(item);
        if (key === null) {
            rejected += 1;
            continue;
        }

        const existing = indexByKey.get(key);
        if (existing !== undefined) {
            remap.set(i + 1, existing);
            continue;
        }

        kept.push(item);
        const ordinal = kept.length;
        indexByKey.set(key, ordinal);
        remap.set(i + 1, ordinal);
    }

    return { kept, remap, rejected };
}

/**
 * Rewrite `[n]` markers after verification drops or collapses quotes.
 *
 * A marker with no surviving quote is removed rather than left as raw `[9]`
 * in the published prose: that is a footnote that points at nothing, and
 * showing the brackets makes it look like the document itself.
 */
export function remapCitedContent(content: string, remap: Map<number, number>): string {
    if (!content) return content;

    return content
        .replace(/\[(\d+)\]/g, (_full, digits: string) => {
            const next = remap.get(Number(digits));
            return next === undefined ? "" : `[${next}]`;
        })
        .replace(/[ \t]+\n/g, "\n")
        .replace(/[ \t]{2,}/g, " ")
        .replace(/ +([.,;:!?])/g, "$1")
        .split("\n")
        .map((line) => line.replace(/[ \t]+$/g, ""))
        .join("\n")
        .trim();
}

/**
 * Generated prose as one line, for a listing.
 *
 * A restatement is a lead sentence and then bullets, which is right on the
 * document's own page and wrong in a row of search results. Flattened here
 * with the markers dropped: the chips they resolve to belong beside the
 * claim, and there is no room for them in a preview.
 */
export function proseLine(content: string, max: number): string {
    const lines = content
        .replace(MARKER, "")
        .split("\n")
        .map((line) => line.trim().replace(/^[-*•]\s+/, ""))
        .filter(Boolean);

    return truncateAtWord(lines.join(" · "), max);
}

export function truncateAtWord(text: string, max: number): string {
    const collapsed = text.replace(/\s+/g, " ").trim();
    if (collapsed.length <= max) return collapsed;

    const cut = collapsed.slice(0, max - 1);
    const at = cut.lastIndexOf(" ");
    return `${(at > max * 0.5 ? cut.slice(0, at) : cut).trimEnd()}…`;
}
