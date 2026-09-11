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
