import { normalizeForMatch } from "@/lib/anchor";
import { CELL_BREAK, cellBreakAt } from "@/lib/markdown";
import { markdownTables, type SourceRange } from "@/lib/render";

/**
 * Putting line breaks back into table cells.
 *
 * Google Docs' markdown export writes every table row on one line. The minutes
 * template keeps a whole discussion inside a cell, so an hour of notes arrives
 * as a single sentence. The HTML export still has the paragraphs the author
 * typed; this module copies those breaks into the markdown as `CELL_BREAK`,
 * which lib/render.ts already reads as a newline.
 *
 * Offsets into the stored string change when a break is inserted. That is
 * fine: citations are re-anchored after ingest, and a failed repair leaves
 * the export untouched.
 */

/** `[text](url)`. Same shape the renderer uses, so a label is found the same way. */
const LINK = /^\[([^\]\n]*)\]\(((?:\\.|[^()\s])*)\)/;

/**
 * Restore the author's line breaks inside markdown table cells, using the
 * HTML export as the source of those breaks.
 */
export function restoreCellBreaks(markdown: string, html: string): string {
    const mdTables = markdownTables(markdown);
    if (mdTables.length === 0) return markdown;

    const fromHtml = extractHtmlTables(html);
    if (fromHtml.length === 0) return markdown;

    const paired = pairTables(mdTables, fromHtml, markdown);
    const edits: { start: number; end: number; text: string }[] = [];

    for (const [md, htmlRows] of paired) {
        const rows = Math.min(md.length, htmlRows.length);
        for (let row = 0; row < rows; row += 1) {
            const mdRow = md[row]!;
            const htmlRow = htmlRows[row]!;
            const cells = Math.min(mdRow.length, htmlRow.length);
            for (let cell = 0; cell < cells; cell += 1) {
                const range = mdRow[cell]!;
                const original = markdown.slice(range.start, range.end);
                const restored = spliceBreaks(original, htmlRow[cell]!);
                if (restored !== original) {
                    edits.push({ start: range.start, end: range.end, text: restored });
                }
            }
        }
    }

    if (edits.length === 0) return markdown;

    edits.sort((left, right) => right.start - left.start);
    let result = markdown;
    for (const edit of edits) {
        result = result.slice(0, edit.start) + edit.text + result.slice(edit.end);
    }
    return result;
}

type HtmlTable = string[][][];

/** Every HTML table, including nested ones, each as rows of cells of lines. */
function extractHtmlTables(html: string): HtmlTable[] {
    return allBodies(html, "table").map(parseTable);
}

function parseTable(body: string): HtmlTable {
    return outermost(body, "tr").map((row) =>
        outermost(row, "td|th").map(cellLines),
    );
}

/**
 * Inner HTML of each `tag` in `html`.
 *
 * Nested matches are included: Docs sometimes wraps a real table in a
 * one-cell layout table, and the inner one is the one the markdown export
 * kept. Rows and cells use the same walk so a nested table does not leak
 * its rows into the parent.
 */
function outermost(html: string, tag: string): string[] {
    return taggedBodies(html, tag, false);
}

function allBodies(html: string, tag: string): string[] {
    return taggedBodies(html, tag, true);
}

function taggedBodies(html: string, tag: string, includeNested: boolean): string[] {
    const open = new RegExp(`<(?:${tag})\\b[^>]*>`, "gi");
    const close = new RegExp(`</(?:${tag})\\s*>`, "gi");
    const parts: string[] = [];
    let from = 0;

    while (from < html.length) {
        open.lastIndex = from;
        const start = open.exec(html);
        if (!start) break;

        let depth = 1;
        let cursor = open.lastIndex;
        let end = -1;

        while (depth > 0 && cursor < html.length) {
            open.lastIndex = cursor;
            close.lastIndex = cursor;
            const nextOpen = open.exec(html);
            const nextClose = close.exec(html);
            if (!nextClose) break;

            if (nextOpen && nextOpen.index < nextClose.index) {
                depth += 1;
                cursor = nextOpen.index + nextOpen[0].length;
            } else {
                depth -= 1;
                cursor = nextClose.index + nextClose[0].length;
                if (depth === 0) end = nextClose.index;
            }
        }

        if (end === -1) break;
        parts.push(html.slice(start.index + start[0].length, end));
        from = includeNested ? start.index + start[0].length : cursor;
    }

    return parts;
}

/**
 * The lines an author put in a cell, in order.
 *
 * Docs writes a paragraph as `<p>`, a typed break as `<br>`, and a list item
 * as `<li>`. Everything else is chrome.
 */
function cellLines(html: string): string[] {
    const text = html
        .replace(/<script[\s\S]*?<\/script>/gi, "")
        .replace(/<style[\s\S]*?<\/style>/gi, "")
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<\/(?:p|div|li|h[1-6]|blockquote)\s*>/gi, "\n")
        .replace(/<[^>]+>/g, "")
        .replace(/&nbsp;/gi, " ")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#39;|&apos;/g, "'")
        .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) =>
            String.fromCharCode(Number.parseInt(hex, 16)),
        )
        .replace(/&#(\d+);/g, (_, dec: string) =>
            String.fromCharCode(Number.parseInt(dec, 10)),
        );

    return text
        .split("\n")
        .map((line) => line.replace(/\s+/g, " ").trim())
        .filter(Boolean);
}

/**
 * Pair each markdown table with the HTML table that holds the same words.
 *
 * Equal counts zip. When Docs wraps a page in an extra table, the leftover
 * HTML table is the one whose first cells do not appear in any markdown table,
 * and is dropped.
 */
function pairTables(
    mdTables: SourceRange[][][],
    htmlTables: HtmlTable[],
    markdown: string,
): [SourceRange[][], HtmlTable][] {
    if (mdTables.length === htmlTables.length) {
        return mdTables.map((table, index) => [table, htmlTables[index]!]);
    }

    const used = new Set<number>();
    const pairs: [SourceRange[][], HtmlTable][] = [];

    for (const md of mdTables) {
        const needle = projectCell(cellTexts(md, markdown).join(" ")).text;
        if (!needle) continue;

        const mdRows = md.length;
        const mdCols = md[0]?.length ?? 0;

        let best = -1;
        let bestScore = 0;
        for (let index = 0; index < htmlTables.length; index += 1) {
            if (used.has(index)) continue;
            const htmlTable = htmlTables[index]!;
            const haystack = projectCell(htmlTable.flat(2).join(" ")).text;
            let score = overlapScore(needle, haystack);
            if (
                htmlTable.length === mdRows &&
                (htmlTable[0]?.length ?? 0) === mdCols
            ) {
                score += 0.25;
            }
            if (score > bestScore) {
                best = index;
                bestScore = score;
            }
        }

        if (best === -1 || bestScore < 0.4) continue;
        used.add(best);
        pairs.push([md, htmlTables[best]!]);
    }

    return pairs;
}

function cellTexts(table: SourceRange[][], markdown: string): string[] {
    return table.flatMap((row) =>
        row.map((cell) => markdown.slice(cell.start, cell.end)),
    );
}

function overlapScore(left: string, right: string): number {
    if (!left || !right) return 0;
    if (left === right) return 1;
    if (right.includes(left.slice(0, Math.min(80, left.length)))) return 0.8;
    if (left.includes(right.slice(0, Math.min(80, right.length)))) return 0.8;

    const words = new Set(left.split(" ").filter((word) => word.length > 2));
    if (words.size === 0) return 0;
    let hits = 0;
    for (const word of words) {
        if (right.includes(word)) hits += 1;
    }
    return hits / words.size;
}

/**
 * Insert `CELL_BREAK` in `md` wherever `htmlLines` says a new line began.
 *
 * Each HTML line is found in the markdown with the same folding a citation
 * uses, so `**bold**` and `[label](url)` do not hide a paragraph that is
 * sitting right there. A line that cannot be found aborts the cell: a wrong
 * break is worse than a flattened one.
 */
function spliceBreaks(md: string, htmlLines: string[]): string {
    const lines = htmlLines
        .map((line) => line.replace(/\s+/g, " ").trim())
        .filter(Boolean);
    if (lines.length <= 1) return md;

    const haystack = projectCell(md);
    const insertions: number[] = [];
    let cursor = 0;

    for (let index = 0; index < lines.length; index += 1) {
        const needle = projectCell(lines[index]!);
        if (!needle.text) continue;

        const found = haystack.text.indexOf(needle.text, cursor);
        if (found === -1) return md;

        const last = found + needle.text.length - 1;
        if (index < lines.length - 1) {
            insertions.push(afterMarkup(md, haystack.map[last]! + 1));
        }
        cursor = last + 1;
        if (haystack.text[cursor] === " ") cursor += 1;
    }

    if (insertions.length === 0) return md;
    return applyInsertions(md, insertions);
}

/**
 * Walk past markdown that belongs to the words just matched: closing
 * `**` and the `](url)` of a link. The HTML line ended on the label, so
 * the break belongs after that chrome, not inside it.
 */
function afterMarkup(md: string, index: number): number {
    let cursor = index;
    while (cursor < md.length && md[cursor] === "*") cursor += 1;
    if (md[cursor] === "]" && md[cursor + 1] === "(") {
        let depth = 1;
        cursor += 2;
        while (cursor < md.length && depth > 0) {
            if (md[cursor] === "\\") {
                cursor += 2;
                continue;
            }
            if (md[cursor] === "(") depth += 1;
            else if (md[cursor] === ")") depth -= 1;
            cursor += 1;
        }
        while (cursor < md.length && md[cursor] === "*") cursor += 1;
    }
    return cursor;
}

function applyInsertions(md: string, points: number[]): string {
    const unique = [...new Set(points)].sort((left, right) => right - left);
    let result = md;

    for (const point of unique) {
        if (point < 0 || point > result.length) continue;
        if (cellBreakAt(result, point) > 0) continue;

        let end = point;
        while (end < result.length && /[ \t]/.test(result[end]!)) end += 1;
        result = result.slice(0, point) + CELL_BREAK + result.slice(end);
    }

    return result;
}

/**
 * The characters two exports can be compared on, mapped back to `input`.
 *
 * Link targets and emphasis markers are dropped: they exist in the markdown
 * and not in the HTML, and they are not the words the author broke between.
 */
function projectCell(input: string): { text: string; map: number[] } {
    const unwrapped = unwrapLinks(input);
    const folded = normalizeForMatch(unwrapped.text);
    return {
        text: folded.text,
        map: folded.map.map((index) => unwrapped.map[index]!),
    };
}

function unwrapLinks(input: string): { text: string; map: number[] } {
    const characters: string[] = [];
    const map: number[] = [];
    let index = 0;

    while (index < input.length) {
        if (input[index] === "[") {
            const link = LINK.exec(input.slice(index));
            if (link) {
                const label = link[1] ?? "";
                const labelStart = index + 1;
                for (let offset = 0; offset < label.length; offset += 1) {
                    characters.push(label[offset]!);
                    map.push(labelStart + offset);
                }
                index += link[0].length;
                continue;
            }
        }

        characters.push(input[index]!);
        map.push(index);
        index += 1;
    }

    return { text: characters.join(""), map };
}
