/**
 * Splitting documents into retrievable passages.
 *
 * Search matches passages, not documents. A reader asking how many caucus
 * senators there can be wants the clause that says so; matching whole files
 * would surface every document that mentions caucuses and leave them to read
 * a constitution to find out which sentence answered them.
 *
 * Passages are derived data with no authority of their own. Nothing is ever
 * quoted from one: retrieval decides what the model reads, and every quote it
 * returns is checked against the whole document before it can be published.
 * That keeps a chunking mistake from becoming a citation mistake.
 *
 * Text in, passages out, and no database: lib/search.ts stores them.
 */

/** Size a passage aims for, and the point past which it is split regardless. */
const TARGET_CHARS = 1_400;
const MAX_CHARS = 2_600;

/** Below this a passage is folded into its neighbour rather than stored. */
const MIN_CHARS = 240;

export type Passage = {
    ordinal: number;
    /** The heading trail this passage sits under, e.g. "Article IV > Section 2". */
    heading: string;
    content: string;
    startOffset: number;
    endOffset: number;
};

const MARKDOWN_HEADING = /^(#{1,6})\s+(.+?)\s*#*$/;

/**
 * The headings SGA governing documents actually use.
 *
 * Constitutions and bylaws are written in Word and pasted into Docs, so their
 * structure is usually "ARTICLE IV" on its own line rather than a markdown
 * heading. Recognising those is what lets a passage carry the article it came
 * from, which is often the only place the topic is named.
 */
const STRUCTURAL_HEADING =
    /^\s*(?:\*\*|__)?\s*(article|section|amendment|title|chapter|part|clause)\s+([ivxlcdm]+|\d+)\b/i;

function headingLevel(line: string): { level: number; text: string } | null {
    const markdown = MARKDOWN_HEADING.exec(line);
    if (markdown) {
        return { level: markdown[1]!.length, text: markdown[2]!.trim() };
    }

    // Long lines are prose that happens to open with "Section 3", not headings.
    if (line.length > 100) return null;

    const structural = STRUCTURAL_HEADING.exec(line);
    if (!structural) return null;

    const text = line.replace(/[*_#]/g, "").trim();
    if (!text) return null;

    // "Article" outranks "Section" so that a section does not discard the
    // article it belongs to from the trail.
    const keyword = structural[1]!.toLowerCase();
    const level = keyword === "section" || keyword === "clause" ? 3 : 2;
    return { level, text };
}

function trailFrom(headings: (string | null)[]): string {
    return headings.filter((heading): heading is string => Boolean(heading)).join(" > ");
}

/** Narrow a range onto its non-whitespace content, keeping offsets true. */
function trimRange(content: string, start: number, end: number) {
    let from = start;
    let to = end;
    while (from < to && /\s/.test(content[from]!)) from += 1;
    while (to > from && /\s/.test(content[to - 1]!)) to -= 1;
    return { from, to };
}

/**
 * Split a document into passages.
 *
 * Splits on the document's own structure first -- a heading always starts a
 * new passage -- and on paragraph boundaries once a passage has reached its
 * target size. Passages are contiguous and non-overlapping, so their offsets
 * remain meaningful as a range of the stored text.
 */
export function splitIntoPassages(content: string): Passage[] {
    if (!content.trim()) return [];

    const ranges: Range[] = [];

    // Index 0 is unused so that a level maps to its own slot.
    const headings: (string | null)[] = [null, null, null, null, null, null, null];

    let blockStart = 0;
    let cursor = 0;
    let blockHeading = "";
    let sawContent = false;

    function flush(end: number) {
        if (!sawContent) return;
        const { from, to } = trimRange(content, blockStart, end);
        if (to > from) ranges.push({ start: from, end: to, heading: blockHeading });
        sawContent = false;
    }

    for (const line of content.split("\n")) {
        const lineStart = cursor;
        const lineEnd = cursor + line.length;
        // Every line but a trailing one is followed by the newline it was split on.
        cursor = lineEnd + 1;

        const heading = headingLevel(line);

        if (heading) {
            flush(lineStart);

            headings[heading.level] = heading.text;
            for (let deeper = heading.level + 1; deeper < headings.length; deeper += 1) {
                headings[deeper] = null;
            }

            // The heading opens the passage it introduces, and the trail it
            // carries includes itself.
            blockStart = lineStart;
            blockHeading = trailFrom(headings);
            sawContent = true;
            continue;
        }

        if (!line.trim()) {
            // A paragraph break is where a passage that has grown big enough
            // gets to end cleanly.
            if (sawContent && lineStart - blockStart >= TARGET_CHARS) {
                flush(lineStart);
                blockStart = cursor;
                blockHeading = trailFrom(headings);
            }
            continue;
        }

        if (!sawContent) {
            blockStart = lineStart;
            blockHeading = trailFrom(headings);
            sawContent = true;
        }

        // A document with no blank lines -- a CSV export, or minutes typed as
        // one block -- would otherwise never reach a split point.
        if (lineEnd - blockStart >= MAX_CHARS) {
            flush(lineEnd);
            blockStart = cursor;
            blockHeading = trailFrom(headings);
        }
    }

    flush(content.length);

    return merge(content, ranges);
}

type Range = { start: number; end: number; heading: string };

/** Whether one heading trail sits under another, or is the same one. */
function nestedUnder(child: string, parent: string): boolean {
    return parent === "" || child === parent || child.startsWith(`${parent} > `);
}

/**
 * Fold undersized passages into a neighbour.
 *
 * A heading on its own line, or the title block above the first article, would
 * otherwise be stored as a passage that can match a query and then tell the
 * reader nothing.
 *
 * What decides the neighbour is the heading trail, not the sizes. A short
 * passage joins the one after it when that one sits underneath it -- an
 * article's title belongs with its first section -- and joins the one before
 * it only when both are under the same heading. A clause short enough to fit
 * in a sentence is left alone rather than being merged under a heading it does
 * not belong to, because the heading is most of what makes it findable.
 */
function merge(content: string, ranges: Range[]): Passage[] {
    const out: Range[] = [];
    let held: Range | null = null;

    function keep(range: Range) {
        const previous = out[out.length - 1];

        if (
            previous &&
            range.end - range.start < MIN_CHARS &&
            previous.heading === range.heading &&
            range.end - previous.start <= MAX_CHARS
        ) {
            previous.end = range.end;
            return;
        }

        out.push(range);
    }

    for (const range of ranges) {
        let current = { ...range };

        if (held) {
            if (
                nestedUnder(current.heading, held.heading) &&
                current.end - held.start <= MAX_CHARS
            ) {
                current = {
                    start: held.start,
                    end: current.end,
                    heading: current.heading,
                };
            } else {
                keep(held);
            }
            held = null;
        }

        if (current.end - current.start < MIN_CHARS) {
            held = current;
            continue;
        }

        keep(current);
    }

    if (held) keep(held);

    return out.map((range, ordinal) => ({
        ordinal,
        heading: range.heading,
        content: content.slice(range.start, range.end),
        startOffset: range.start,
        endOffset: range.end,
    }));
}
