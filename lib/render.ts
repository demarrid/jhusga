import type { AnnotationSpan } from "@/lib/anchor";

/**
 * Rendering a document's markdown without breaking its citations.
 *
 * The viewer printed the export verbatim for a reason: citation offsets index
 * into that exact string, so handing the text to a markdown renderer would
 * shift every position and land the highlights on the wrong words. The cost
 * was that readers saw `**`, `|` and `\.` instead of a document.
 *
 * This module keeps both. It parses the export into blocks whose inline runs
 * each remember the range of the original string they came from, so a
 * highlight is applied by splitting runs at offsets rather than by searching
 * rendered text. Syntax characters are dropped from the output but stay inside
 * the ranges, which is why a quote spanning `**emphasis**` still highlights as
 * one continuous passage.
 *
 * Only what Google Docs actually exports is handled: headings, ordered and
 * bulleted lists, pipe tables, block quotes, rules, bold, italic,
 * strikethrough, links and backslash escapes. Indented code blocks are
 * deliberately absent -- Docs indents nested list items by four spaces, and
 * reading those as code would turn most agendas into grey boxes. Underscores
 * are never emphasis either: the export escapes them as `\_` instead.
 */

export type InlineRun = {
    text: string;
    bold: boolean;
    italic: boolean;
    strike: boolean;
    /** An http(s) or mailto target, or null for ordinary text. */
    href: string | null;
    /** The citation highlighted here, or null between citations. */
    annotationId: string | null;
    /**
     * True on the first run of an annotation, which carries the `id` a
     * SourceChip links to. A citation split across runs by a bold word must
     * not repeat that id.
     */
    anchor: boolean;
};

export type ListItem = {
    runs: InlineRun[];
    /** Nested lists, and the heading Docs sometimes puts inside an item. */
    blocks: Block[];
};

export type TableRow = { cells: InlineRun[][] };

export type Block =
    | { kind: "heading"; level: number; runs: InlineRun[] }
    | { kind: "paragraph"; runs: InlineRun[] }
    | { kind: "quote"; blocks: Block[] }
    | { kind: "list"; ordered: boolean; start: number; items: ListItem[] }
    | { kind: "table"; header: TableRow | null; rows: TableRow[] }
    | { kind: "rule" };

/** A half-open slice of the original document. */
type Range = { start: number; end: number };

/** A source line, with the offset it begins at. */
type Line = { text: string; start: number };

type Inline = (ranges: Range[]) => InlineRun[];

// Indentation carries no meaning outside a list here. Docs indents headings
// and rules to whatever the paragraph style used, and with no support for
// indented code blocks there is nothing for the usual three-space limit to
// guard against.
const HEADING = /^\s*(#{1,6})(?:\s+|\s*$)/;
const RULE = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/;
const QUOTE = /^\s*(?:>\s?)+/;
// A marker with nothing after it is an empty item -- Docs exports the blank
// bullets people leave behind as a bare "2." line. Reading it as a paragraph
// would print that number as body text and break the numbering below it.
const BULLET = /^(\s*)[-*+](?:\s+|\s*$)/;
const ORDERED = /^(\s*)(\d+)[.)](?:\s+|\s*$)/;
const TABLE_ROW = /^\s*\|/;
/** `| :---- | ----- |`. Must contain dashes: a row of empty cells is data. */
const TABLE_DELIMITER = /^\s*\|(?:\s*:?-+:?\s*\|)+\s*$/;

/** `[text](url)`. Docs escapes parentheses inside a URL rather than dropping them. */
const LINK = /^\[([^\]\n]*)\]\(((?:\\.|[^()\s])*)\)/;
const SAFE_URL = /^(?:https?:|mailto:)/i;
/** Docs escapes punctuation aggressively: `SECTION 1\.`, `first\_last`. */
const ESCAPABLE = /[^0-9A-Za-z\s]/;

/**
 * Parse a document into renderable blocks with its citations attached.
 *
 * Pure, so the viewer is a plain walk over the result and no offset arithmetic
 * lives in a component.
 */
export function renderDocument(
    content: string,
    spans: AnnotationSpan[],
): Block[] {
    const resolved = resolveSpans(content, spans);
    const anchored = new Set<string>();
    const inline: Inline = (ranges) =>
        inlineRuns(content, ranges, resolved, anchored);

    return parseBlocks(toLines(content), inline);
}

type ResolvedSpan = { id: string; startOffset: number; endOffset: number };

/**
 * Drop unusable spans and reduce the rest to a non-overlapping, ordered list.
 *
 * Overlapping highlights cannot be represented as a flat sequence of runs, so
 * the first one claims the range. Ordering is what lets the scan below walk
 * spans with a single forward cursor.
 */
function resolveSpans(
    content: string,
    spans: AnnotationSpan[],
): ResolvedSpan[] {
    const usable = spans
        .filter(
            (span): span is ResolvedSpan =>
                span.startOffset !== null &&
                span.endOffset !== null &&
                span.startOffset >= 0 &&
                span.endOffset <= content.length &&
                span.startOffset < span.endOffset,
        )
        // Longest first at a given start so the widest highlight wins.
        .sort((a, b) => a.startOffset - b.startOffset || b.endOffset - a.endOffset);

    const kept: ResolvedSpan[] = [];
    let cursor = 0;
    for (const span of usable) {
        if (span.startOffset < cursor) continue;
        kept.push(span);
        cursor = span.endOffset;
    }
    return kept;
}

function toLines(content: string): Line[] {
    const lines: Line[] = [];
    let start = 0;
    for (const text of content.split("\n")) {
        lines.push({ text, start });
        start += text.length + 1;
    }
    return lines;
}

/** A line with its first `width` characters -- a marker -- left behind. */
function afterMarker(line: Line, width: number): Line {
    return { text: line.text.slice(width), start: line.start + width };
}

function isBlank(text: string): boolean {
    return text.trim().length === 0;
}

/** Whether a line opens a block of its own, and so ends the one before it. */
function startsBlock(text: string): boolean {
    return (
        RULE.test(text) ||
        HEADING.test(text) ||
        QUOTE.test(text) ||
        TABLE_ROW.test(text) ||
        itemMarker(text) !== null
    );
}

type Marker = {
    ordered: boolean;
    indent: number;
    /** The number the export itself printed, so `<ol>` can start there. */
    number: number;
    width: number;
};

function itemMarker(text: string): Marker | null {
    if (RULE.test(text)) return null;

    const ordered = ORDERED.exec(text);
    if (ordered) {
        return {
            ordered: true,
            indent: ordered[1].length,
            number: Number(ordered[2]),
            width: ordered[0].length,
        };
    }

    const bullet = BULLET.exec(text);
    if (bullet) {
        return {
            ordered: false,
            indent: bullet[1].length,
            number: 1,
            width: bullet[0].length,
        };
    }

    return null;
}

function parseBlocks(lines: Line[], inline: Inline): Block[] {
    const blocks: Block[] = [];
    let index = 0;

    while (index < lines.length) {
        const line = lines[index];

        if (isBlank(line.text)) {
            index += 1;
            continue;
        }

        if (RULE.test(line.text)) {
            blocks.push({ kind: "rule" });
            index += 1;
            continue;
        }

        const heading = HEADING.exec(line.text);
        if (heading) {
            const rest = line.text.slice(heading[0].length);
            // `## ---` is how a horizontal line inside a heading comes out.
            blocks.push(
                RULE.test(rest)
                    ? { kind: "rule" }
                    : {
                        kind: "heading",
                        level: heading[1].length,
                        runs: inline([lineRange(afterMarker(line, heading[0].length))]),
                    },
            );
            index += 1;
            continue;
        }

        if (QUOTE.test(line.text)) {
            // Docs uses stacked `> > >` markers for indentation rather than for
            // nested quotation, so every depth collapses to one quote.
            const quoted: Line[] = [];
            while (index < lines.length) {
                const marker = QUOTE.exec(lines[index].text);
                if (!marker) break;
                quoted.push(afterMarker(lines[index], marker[0].length));
                index += 1;
            }
            blocks.push({ kind: "quote", blocks: parseBlocks(quoted, inline) });
            continue;
        }

        if (TABLE_ROW.test(line.text)) {
            const rows: Line[] = [];
            while (index < lines.length && TABLE_ROW.test(lines[index].text)) {
                rows.push(lines[index]);
                index += 1;
            }
            blocks.push(parseTable(rows, inline));
            continue;
        }

        if (itemMarker(line.text)) {
            const list = parseList(lines, index, inline);
            blocks.push(list.block);
            index = list.next;
            continue;
        }

        const paragraph: Line[] = [];
        do {
            paragraph.push(lines[index]);
            index += 1;
        } while (
            index < lines.length &&
            !isBlank(lines[index].text) &&
            !startsBlock(lines[index].text)
        );

        blocks.push({ kind: "paragraph", runs: inline(joinedRanges(paragraph)) });
    }

    return blocks;
}

function lineRange(line: Line): Range {
    return { start: line.start, end: line.start + line.text.length };
}

/**
 * Ranges for consecutive lines of one block, keeping the newline between them.
 *
 * The export never soft-wraps a paragraph, so a newline inside one is a break
 * the author typed. Carrying it through as a character means the viewer can
 * reproduce it with `whitespace-pre-wrap` and the offsets stay contiguous.
 * Leading indentation is dropped for the same reason: under pre-wrap it would
 * otherwise show up as a ragged left edge.
 */
function joinedRanges(lines: Line[]): Range[] {
    return lines.map((line, position) => ({
        start: line.start + (/^\s*/.exec(line.text)?.[0].length ?? 0),
        end: line.start + line.text.length + (position < lines.length - 1 ? 1 : 0),
    }));
}

function parseTable(rows: Line[], inline: Inline): Block {
    const toRow = (line: Line): TableRow => ({
        cells: cellRanges(line).map((range) => inline([range])),
    });

    const headed = rows.length > 1 && TABLE_DELIMITER.test(rows[1].text);

    return {
        kind: "table",
        header: headed ? toRow(rows[0]) : null,
        rows: (headed ? rows.slice(2) : rows).map(toRow),
    };
}

/** The cells of `| a | b |`, as trimmed ranges into the document. */
function cellRanges(line: Line): Range[] {
    const ranges: Range[] = [];
    let cell: number | null = null;

    for (let index = 0; index < line.text.length; index += 1) {
        const character = line.text[index];
        // An escaped pipe belongs to the cell, not to the table.
        if (character === "\\") {
            index += 1;
            continue;
        }
        // Neither does one inside a link, which Docs writes without escaping:
        // `[S.B. 26-27 | The Accountability Act](...)` is a single cell.
        if (character === "[") {
            const link = LINK.exec(line.text.slice(index));
            if (link) {
                index += link[0].length - 1;
                continue;
            }
        }
        if (character !== "|") continue;

        if (cell !== null) ranges.push(trimmedRange(line, cell, index));
        cell = index + 1;
    }

    // A row that forgot its closing pipe still has a last cell.
    if (cell !== null && line.text.slice(cell).trim().length > 0) {
        ranges.push(trimmedRange(line, cell, line.text.length));
    }

    return ranges;
}

function trimmedRange(line: Line, from: number, to: number): Range {
    let start = from;
    let end = to;
    while (start < end && /\s/.test(line.text[start])) start += 1;
    while (end > start && /\s/.test(line.text[end - 1])) end -= 1;
    return { start: line.start + start, end: line.start + end };
}

type PendingItem = {
    ranges: Range[];
    blocks: Block[];
    /** Non-zero when the item's own text is a heading; see below. */
    headingLevel: number;
};

/**
 * One list, from `from` until a line that belongs to something else.
 *
 * Indentation decides nesting: deeper than the first item starts a sublist,
 * shallower hands the line back to the caller. The export is inconsistent
 * about widths -- 2, 3, 4 and 6 spaces all appear -- so relative depth is the
 * only workable rule.
 */
function parseList(
    lines: Line[],
    from: number,
    inline: Inline,
): { block: Block; next: number } {
    const first = itemMarker(lines[from].text)!;
    const items: ListItem[] = [];
    let current: PendingItem | null = null;
    let index = from;

    const finish = () => {
        if (!current) return;
        const runs = inline(current.ranges);
        items.push(
            current.headingLevel > 0
                ? {
                    runs: [],
                    blocks: [
                        { kind: "heading", level: current.headingLevel, runs },
                        ...current.blocks,
                    ],
                }
                : { runs, blocks: current.blocks },
        );
        current = null;
    };

    while (index < lines.length) {
        const line = lines[index];

        if (isBlank(line.text)) {
            // Docs leaves a blank line between items often enough that ending
            // the list here would restart the numbering mid-agenda. One blank
            // line before another item keeps the list together.
            const next = index + 1 < lines.length ? itemMarker(lines[index + 1].text) : null;
            if (next && next.indent >= first.indent) {
                index += 1;
                continue;
            }
            break;
        }

        const marker = itemMarker(line.text);

        if (!marker) {
            // A wrapped line continues the item above it.
            if (current && /^\s+\S/.test(line.text) && !startsBlock(line.text)) {
                const last = current.ranges[current.ranges.length - 1];
                last.end += 1;
                current.ranges.push({
                    start: line.start + (/^\s*/.exec(line.text)?.[0].length ?? 0),
                    end: line.start + line.text.length,
                });
                index += 1;
                continue;
            }
            break;
        }

        if (marker.indent < first.indent) break;

        if (marker.indent > first.indent) {
            const nested = parseList(lines, index, inline);
            if (current) current.blocks.push(nested.block);
            else items.push({ runs: [], blocks: [nested.block] });
            index = nested.next;
            continue;
        }

        // A bulleted list starting where a numbered one left off is a new list.
        if (marker.ordered !== first.ordered) break;

        finish();

        // Docs nests a heading inside a list item -- "1. ## Call to Order" --
        // whenever an agenda item is styled as a heading in the source.
        const rest = line.text.slice(marker.width);
        const heading = HEADING.exec(rest);
        const width = marker.width + (heading?.[0].length ?? 0);

        current = {
            ranges: [lineRange(afterMarker(line, width))],
            blocks: [],
            headingLevel: heading ? heading[1].length : 0,
        };
        index += 1;
    }

    finish();

    return {
        block: {
            kind: "list",
            ordered: first.ordered,
            start: first.number,
            items,
        },
        next: index,
    };
}

/** The characters of `ranges`, with the offset each one came from. */
function flatten(
    content: string,
    ranges: Range[],
): { text: string; offsets: number[] } {
    const characters: string[] = [];
    const offsets: number[] = [];

    for (const range of ranges) {
        for (let index = range.start; index < range.end; index += 1) {
            characters.push(content[index]);
            offsets.push(index);
        }
    }

    return { text: characters.join(""), offsets };
}

/**
 * Turn a block's ranges into styled runs, split wherever a citation begins or
 * ends.
 *
 * Markers are consumed rather than emitted, so `**Treasurer**` yields one bold
 * run of `Treasurer` whose characters still map back to offsets inside the
 * asterisks. A highlight covering the whole phrase therefore covers the run,
 * and a highlight covering half of it splits the run in the right place.
 */
function inlineRuns(
    content: string,
    ranges: Range[],
    spans: ResolvedSpan[],
    anchored: Set<string>,
): InlineRun[] {
    const { text, offsets } = flatten(content, ranges);
    const runs: InlineRun[] = [];

    let bold = false;
    let italic = false;
    let strike = false;
    let href: string | null = null;

    let buffer = "";
    let bufferId: string | null = null;
    let bufferAnchor = false;
    // Offsets only ever increase, so one forward cursor covers the block.
    let spanIndex = 0;

    function flush() {
        if (!buffer) return;
        runs.push({
            text: buffer,
            bold,
            italic,
            strike,
            href,
            annotationId: bufferId,
            anchor: bufferAnchor,
        });
        buffer = "";
        bufferAnchor = false;
    }

    function annotationAt(offset: number): string | null {
        while (spanIndex < spans.length && spans[spanIndex].endOffset <= offset) {
            spanIndex += 1;
        }
        const span = spans[spanIndex];
        return span && span.startOffset <= offset ? span.id : null;
    }

    function emit(character: string, index: number) {
        const id = annotationAt(offsets[index]);
        if (id !== bufferId) {
            flush();
            bufferId = id;
            if (id !== null && !anchored.has(id)) {
                anchored.add(id);
                bufferAnchor = true;
            }
        }
        buffer += character;
    }

    let linkTextEnd = -1;
    let linkResumeAt = -1;
    let index = 0;

    while (index < text.length) {
        // `>=` rather than `==`: an escape at the end of the label can step
        // over the closing bracket, and a link left open would swallow the block.
        if (linkTextEnd !== -1 && index >= linkTextEnd) {
            flush();
            href = null;
            index = linkResumeAt;
            linkTextEnd = -1;
            continue;
        }

        const character = text[index];

        if (
            character === "\\" &&
            index + 1 < text.length &&
            ESCAPABLE.test(text[index + 1])
        ) {
            emit(text[index + 1], index + 1);
            index += 2;
            continue;
        }

        if (linkTextEnd === -1 && character === "[") {
            const link = LINK.exec(text.slice(index));
            if (link) {
                const [whole, label, url] = link;
                // `[****](url)` is all that is left of an inline image once the
                // payload is stripped at ingest: a link with nothing to click.
                if (!/[^\s*~]/.test(label)) {
                    index += whole.length;
                    continue;
                }

                flush();
                const target = url.replace(/\\([^0-9A-Za-z])/g, "$1");
                // An unsafe or relative target keeps its words and loses its link.
                href = SAFE_URL.test(target) ? target : null;
                linkTextEnd = index + 1 + label.length;
                linkResumeAt = index + whole.length;
                index += 1;
                continue;
            }
        }

        if (character === "~" && text[index + 1] === "~") {
            if (strike || text.indexOf("~~", index + 2) !== -1) {
                flush();
                strike = !strike;
                index += 2;
                continue;
            }
        }

        if (character === "*") {
            let width = 1;
            while (width < 3 && text[index + width] === "*") width += 1;

            // A marker that never closes, or one followed by a space, is a
            // literal asterisk; treating it as emphasis would italicise the
            // rest of the block.
            const opening = !bold && !italic;
            const closes = text.indexOf("*", index + width) !== -1;
            const dangling = /^\s?$/.test(text[index + width] ?? "");

            if (!opening || (closes && !dangling)) {
                flush();
                if (width >= 2) bold = !bold;
                if (width !== 2) italic = !italic;
                index += width;
                continue;
            }
        }

        emit(character, index);
        index += 1;
    }

    flush();

    return runs;
}
