import type { AnnotationSpan } from "@/lib/anchor";
import { csvCellRanges, SHEET_BREAK } from "@/lib/csv";
import { cellBreakAt } from "@/lib/markdown";
import { sectionAnchors } from "@/lib/outline";

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
    checked?: boolean;
    runs: InlineRun[];
    /** Nested lists, and the heading Docs sometimes puts inside an item. */
    blocks: Block[];
    /**
     * Set when this item is a section the outline scrolls to. The id matches
     * lib/outline.ts, which keyed it by the line the item starts on.
     */
    sectionId?: string;
    /**
     * The ordinal the export printed for this item. An agenda's notes restart
     * at 1 under each item and the export skips numbers, so counting from
     * `start` would show numbers the author never wrote.
     */
    value?: number;
    /**
     * How many characters at the start of `runs` are the "a." or "iv." the
     * author typed. Those are text in the source rather than list syntax, so
     * they stay in the runs; the viewer sets them where a marker would go.
     */
    typedMarker?: number;
};

export type TableRow = { cells: InlineRun[][] };

export type HeadingBlock = {
    kind: "heading";
    level: number;
    runs: InlineRun[];
    sectionId?: string;
    /** An agenda item's own number, "7.", as the export printed it. */
    marker?: string;
    /** Docs drew a line under it: the `---` the export put on the next line. */
    ruled?: boolean;
};

export type Block =
    | HeadingBlock
    | { kind: "paragraph"; runs: InlineRun[]; sectionId?: string; clause?: { depth: number; markerLength: number } }
    | { kind: "quote"; blocks: Block[] }
    | {
        kind: "list";
        ordered: boolean;
        start: number;
        items: ListItem[];
        /** Set when the author typed "a." or "iv." rather than a number. */
        numbering?: "letter" | "roman";
        /**
         * The numbered items of an agenda, each item's first block its
         * heading and the rest of its blocks what falls under it.
         */
        agenda?: boolean;
    }
    | { kind: "table"; header: TableRow | null; rows: TableRow[] }
    /** A table the author used to lay out a page rather than to hold data. */
    | { kind: "layout"; rows: TableRow[] }
    | { kind: "rule" };

/** The text a cell's runs spell out, with the markdown syntax already gone. */
export function runsText(runs: InlineRun[]): string {
    return runs.map((run) => run.text).join("");
}

/** Inline markdown in generated prose: bold, italic, links, without document anchors. */
export function proseInlineRuns(text: string): InlineRun[] {
    return inlineRuns(text, [{ start: 0, end: text.length }], [], new Set());
}

/** A half-open slice of the original document. */
type Range = { start: number; end: number };

/** The same, named for the modules outside this one that read offsets. */
export type SourceRange = Range;

/** A source line, with the offset it begins at. */
type Line = { text: string; start: number };

type Inline = (ranges: Range[], mode?: "cell") => InlineRun[];

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
/**
 * "a." and "iv.", which Docs leaves as typed text when an agenda's levels were
 * lettered by hand. Only counted when indented, or inside an agenda: a PDF's
 * text puts every line at the margin, wrapped lines included, so a list there
 * would cut each item off at its first wrap.
 */
const LETTERED = /^(\s*)([a-z]|[ivx]+)[.)]\s+(?=\S)/;
const ROMAN = /^x{0,3}(?:ix|iv|v?i{0,3})$/;
/** A link reduced to its label, for testing what an item says rather than where it points. */
const LINK_LABEL = /\[([^\]\n]*)\]\((?:\\.|[^()\s])*\)/g;
/** "The first 3 hours are required!" is a bold notice, not an agenda item. */
const SENTENCE_VERB =
    /\b(is|are|was|were|be|will|would|shall|should|must|can|could|has|have|had)\b/i;
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
    options: RenderOptions = {},
): Block[] {
    const resolved = resolveSpans(content, spans);
    const anchored = new Set<string>();
    const inline: Inline = (ranges, mode) =>
        inlineRuns(content, ranges, resolved, anchored, mode);

    const lines = toLines(content);
    // Same keys the outline links to. Stamping them here, rather than wrapping
    // the stored text, leaves citation offsets where they were.
    const anchors = sectionAnchors(content);

    return options.sheetDelimiter
        ? parseSheet(lines, options.sheetDelimiter, inline, anchors)
        : parseBlocks(lines, inline, anchors);
}

/** The section ids the blocks carry: every target an outline link can land on. */
export function blockSectionIds(blocks: Block[]): Set<string> {
    const ids = new Set<string>();
    const walk = (list: Block[]) => {
        for (const block of list) {
            if ((block.kind === "heading" || block.kind === "paragraph") && block.sectionId) {
                ids.add(block.sectionId);
            }
            if (block.kind === "quote") walk(block.blocks);
            if (block.kind === "list") {
                for (const item of block.items) {
                    if (item.sectionId) ids.add(item.sectionId);
                    walk(item.blocks);
                }
            }
        }
    };
    walk(blocks);
    return ids;
}

export type RenderOptions = {
    /**
     * Set for a spreadsheet, to the delimiter its rows use. See
     * `sheetDelimiter` in lib/csv.ts, which decides this from the mime type.
     */
    sheetDelimiter?: "," | "\t" | null;
};

/**
 * One table per tab, rather than the raw export.
 *
 * A sheet has no headings or paragraphs to find, and running the markdown
 * parser over it produces nonsense -- a row beginning with a hyphen becomes
 * a bullet, and a cell containing an asterisk italicises the rest of the
 * line. A workbook with a single tab is still one table, and its first row
 * is the header. A later tab is announced by a form-feed line (`\fBudget`);
 * that line is the heading, and the rows under it are their own table, so a
 * second header is not swallowed as another data row of the first.
 *
 * Rows are padded to the widest one. Drive pads its export already, but the
 * xlsx path drops trailing empty cells, and a table whose rows disagree about
 * their width renders as a staircase.
 */
function parseSheet(
    lines: Line[],
    delimiter: "," | "\t",
    inline: Inline,
    anchors: Map<number, string>,
): Block[] {
    const blocks: Block[] = [];
    let rows: Line[] = [];
    let heading: { start: number; end: number; sectionId?: string } | null = null;

    const flush = () => {
        if (heading) {
            blocks.push({
                kind: "heading",
                level: 2,
                runs: inline([{ start: heading.start, end: heading.end }]),
                ...(heading.sectionId ? { sectionId: heading.sectionId } : {}),
            });
            heading = null;
        }
        const table = sheetTable(rows, delimiter, inline);
        rows = [];
        if (table) blocks.push(table);
    };

    for (const line of lines) {
        if (line.text.startsWith(SHEET_BREAK)) {
            flush();
            const name = line.text.slice(SHEET_BREAK.length).trim();
            if (name) {
                const lead =
                    line.text.slice(SHEET_BREAK.length).match(/^\s*/)?.[0].length ?? 0;
                const start = line.start + SHEET_BREAK.length + lead;
                heading = {
                    start,
                    end: start + name.length,
                    sectionId: anchors.get(line.start),
                };
            }
            continue;
        }
        if (!isBlank(line.text)) rows.push(line);
    }

    flush();
    return blocks;
}

function sheetTable(
    lines: Line[],
    delimiter: "," | "\t",
    inline: Inline,
): Block | null {
    const rows = lines.map((line) => csvCellRanges(line.text, line.start, delimiter));
    if (rows.length === 0) return null;

    const width = rows.reduce((widest, row) => Math.max(widest, row.length), 0);

    const toRow = (cells: Range[][]): TableRow => ({
        cells: Array.from({ length: width }, (_, index) =>
            inline(cells[index] ?? []),
        ),
    });

    // The first row is a header only if it is not the only row; a
    // single-row sheet is data, and heading it would leave the table empty.
    return {
        kind: "table",
        header: rows.length > 1 ? toRow(rows[0]!) : null,
        rows: (rows.length > 1 ? rows.slice(1) : rows).map(toRow),
    };
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

/** Typed legislative numbering, including Docs' escaped dots and quote indentation. */
function clauseLine(line: Line): { line: Line; depth: number; markerLength: number } | null {
    const quote = QUOTE.exec(line.text);
    const source = quote ? afterMarker(line, quote[0].length) : line;
    const match = /^\s*((?:\d{1,3}(?:\\?\.\d{1,3})+)(?:\\?\.)?|\d{1,3}\\\.)(?=\s|[A-Za-z])\s*/.exec(source.text);
    if (!match) return null;
    const marker = match[1].replace(/\\/g, "");
    return { line: source, depth: marker.replace(/\.$/, "").split(".").length - 1, markerLength: match[0].replace(/\\/g, "").trimEnd().length };
}

/** Whether a line opens a block of its own, and so ends the one before it. */
function startsBlock(text: string): boolean {
    return (
        RULE.test(text) ||
        HEADING.test(text) ||
        QUOTE.test(text) ||
        TABLE_ROW.test(text) ||
        clauseLine({ text, start: 0 }) !== null ||
        itemMarker(text) !== null
    );
}

type MarkerStyle = "number" | "letter" | "roman" | "bullet";

type Marker = {
    ordered: boolean;
    style: MarkerStyle;
    indent: number;
    /** The number the export itself printed, so `<ol>` can start there. */
    number: number;
    /** "i", "v" and "x" are letters too; this is their place in the alphabet. */
    letter?: number;
    width: number;
};

function itemMarker(text: string, bareLetters = false): Marker | null {
    if (RULE.test(text)) return null;

    const ordered = ORDERED.exec(text);
    if (ordered) {
        return {
            ordered: true,
            style: "number",
            indent: ordered[1].length,
            number: Number(ordered[2]),
            width: ordered[0].length,
        };
    }

    const bullet = BULLET.exec(text);
    if (bullet) {
        return {
            ordered: false,
            style: "bullet",
            indent: bullet[1].length,
            number: 1,
            width: bullet[0].length,
        };
    }

    const lettered = LETTERED.exec(text);
    if (lettered && (bareLetters || lettered[1].length > 0)) {
        const name = lettered[2];
        const letter = name.length === 1 ? name.charCodeAt(0) - 96 : undefined;
        const roman = ROMAN.test(name);
        if (!roman && letter === undefined) return null;
        return {
            ordered: true,
            style: roman ? "roman" : "letter",
            indent: lettered[1].length,
            number: roman ? romanValue(name) : letter!,
            letter,
            width: lettered[0].length,
        };
    }

    return null;
}

function romanValue(numeral: string): number {
    const digits: Record<string, number> = { i: 1, v: 5, x: 10 };
    let total = 0;
    for (let index = 0; index < numeral.length; index += 1) {
        const value = digits[numeral[index]!]!;
        const next = digits[numeral[index + 1] ?? ""] ?? 0;
        total += value < next ? -value : value;
    }
    return total;
}

/**
 * A top-level agenda item: "7. **First Reading**", or "1. ## Call to Order".
 *
 * The export marks the agenda's own items only by emphasis. Without this they
 * render as body text while the plain lines under them, set off as separate
 * paragraphs, read as the larger and more important thing.
 */
function isAgendaItem(text: string): boolean {
    const marker = ORDERED.exec(text);
    if (!marker || marker[1].length > 3) return false;
    const rest = text.slice(marker[0].length);

    const heading = HEADING.exec(rest);
    if (heading) {
        const title = rest.slice(heading[0].length);
        return /[\p{L}\p{N}]/u.test(title) && !RULE.test(title);
    }

    const bold = /^\*\*((?:[^*]|\*(?!\*))+)\*\*$/.exec(rest.replace(LINK_LABEL, "$1").trim());
    if (!bold) return false;
    const plain = bold[1]!.replace(/\\(.)/g, "$1").trim();
    return (
        plain.length >= 2 &&
        plain.length <= 100 &&
        /\p{L}/u.test(plain) &&
        !/[.!?]$/.test(plain) &&
        !SENTENCE_VERB.test(plain)
    );
}

function parseBlocks(lines: Line[], inline: Inline, anchors: Map<number, string>): Block[] {
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
            const sectionId = anchors.get(line.start);
            blocks.push(
                RULE.test(rest)
                    ? { kind: "rule" }
                    : {
                        kind: "heading",
                        level: heading[1].length,
                        // Hide exported heading IDs without changing source offsets.
                        runs: inline([lineRange(afterMarker({ ...line, text: line.text.replace(/\s+\{#[^}\n]+\}\s*$/, "") }, heading[0].length))]),
                        ...(sectionId ? { sectionId } : {}),
                    },
            );
            index += 1;
            continue;
        }

        const clause = clauseLine(line);
        if (clause) {
            const ranges = [lineRange(clause.line)];
            index += 1;
            while (index < lines.length && !isBlank(lines[index].text) && !startsBlock(lines[index].text) && !anchors.has(lines[index].start)) {
                ranges[ranges.length - 1].end += 1;
                ranges.push(lineRange(lines[index]));
                index += 1;
            }
            blocks.push({ kind: "paragraph", runs: inline(ranges), sectionId: anchors.get(line.start),
                clause: { depth: clause.depth, markerLength: clause.markerLength } });
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
            blocks.push({ kind: "quote", blocks: parseBlocks(quoted, inline, anchors) });
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
            const list = parseList(lines, index, inline, anchors);
            blocks.push(list.block);
            index = list.next;
            continue;
        }

        // A paragraph that opens on a section line is its target as it stands.
        // One the export glued under the end of another paragraph starts a new
        // block there, or the outline would have nothing of its own to scroll
        // to. The ranges are unchanged, so a citation that crosses the break
        // still covers the same characters.
        const paragraph: Line[] = [];
        const emitParagraph = () => {
            if (paragraph.length === 0) return;
            const sectionId = anchors.get(paragraph[0]!.start);
            blocks.push({
                kind: "paragraph",
                runs: inline(joinedRanges(paragraph)),
                ...(sectionId ? { sectionId } : {}),
            });
            paragraph.length = 0;
        };

        while (
            index < lines.length &&
            !isBlank(lines[index]!.text) &&
            !startsBlock(lines[index]!.text)
        ) {
            const next = lines[index]!;
            if (paragraph.length > 0 && anchors.has(next.start)) emitParagraph();
            paragraph.push(next);
            index += 1;
        }

        emitParagraph();
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
        cells: cellRanges(line).map((range) => inline([range], "cell")),
    });

    const headed = rows.length > 1 && TABLE_DELIMITER.test(rows[1].text);

    // Built before the kind is decided so that the runs are produced in
    // document order either way: `inline` hands out citation anchors as it
    // goes, and the first run of a citation is the one that carries it.
    const header = headed ? toRow(rows[0]) : null;
    const body = (headed ? rows.slice(2) : rows).map(toRow);

    if (isValueGrid(header ? [header, ...body] : body)) {
        // Docs marks the first row of every table as a header, including a
        // roll whose first row is just the chair and their status. A real
        // header names the columns; it does not mark anyone present.
        if (header && (body.length === 0 || header.cells.some((cell) => ATTENDANCE_STATUS.test(runsText(cell).trim())))) {
            return { kind: "table", header: null, rows: [header, ...body] };
        }
        return { kind: "table", header, rows: body };
    }

    // The delimiter row is syntax, so it is dropped; the header row is not,
    // and in a layout table it is the first agenda item.
    return { kind: "layout", rows: header ? [header, ...body] : body };
}

/**
 * Whether a pipe table is a roster of values rather than page furniture.
 *
 * Spreadsheets are a separate path (`sheetDelimiter`) and always render as a
 * table. Everything else in a Google Doc that looks like a table is usually
 * the minutes template laying out an agenda item next to who leads it, and
 * those are printed as text. The one grid in a Doc that is still a table is
 * the attendance roll: names in one cell, Present/Absent/Excused in the next.
 */
function isValueGrid(rows: TableRow[]): boolean {
    if (rows.length === 0) return false;

    const columns = rows.reduce((widest, row) => Math.max(widest, row.cells.length), 0);
    if (columns < 2) return false;

    // A minutes row is an item beside a short aside ("All Present", "Chair").
    // A bill's amendment table is two columns of the provision itself, and
    // squeezing the second into that aside collapses both of them.
    return looksLikeAttendance(rows) || hasTwoLongColumns(rows) || looksLikeDataTable(rows);
}

/**
 * A grid of column headings and values: a funding table, not an agenda item
 * set beside who leads it.
 *
 * The minutes template is two cells, the item and a short aside. Three or
 * more columns whose first row is a row of short names is a table, and
 * printing it as an aside stacks those columns down the margin.
 */
function looksLikeDataTable(rows: TableRow[]): boolean {
    const columns = rows.reduce((widest, row) => Math.max(widest, row.cells.length), 0);
    if (columns < 3) return false;

    const header = rows[0]!.cells.map((cell) => runsText(cell).trim()).filter((cell) => cell.length > 0);
    if (header.length < 3 || header.some((cell) => cell.length > 40)) return false;

    return rows.slice(1).some((row) => row.cells.filter((cell) => runsText(cell).trim().length > 0).length >= 2);
}

/** Two different columns each hold a passage, not a label. */
function hasTwoLongColumns(rows: TableRow[]): boolean {
    const longest: number[] = [];
    for (const row of rows) {
        row.cells.forEach((cell, index) => {
            const length = runsText(cell).trim().length;
            longest[index] = Math.max(longest[index] ?? 0, length);
        });
    }
    return longest.filter((length) => length >= 80).length >= 2;
}

const ATTENDANCE_STATUS = /^(present|absent|excused|late|here)\b/i;

function looksLikeAttendance(rows: TableRow[]): boolean {
    const cells = rows
        .flatMap((row) => row.cells.map((cell) => runsText(cell).trim()))
        .filter(Boolean);

    const statuses = cells.filter((cell) => ATTENDANCE_STATUS.test(cell)).length;
    if (statuses < 2) return false;

    // "All Present" on an agenda row is a status word, but the rest of that
    // row is a sentence. A roster's other cells are names and seats.
    return cells.every((cell) => ATTENDANCE_STATUS.test(cell) || cell.length <= 60);
}

/**
 * Every pipe table in a document, as offsets into it: tables, then rows, then
 * cells. Delimiter rows are syntax and are left out.
 *
 * Exported for lib/cells.ts, which repairs cells at ingest and has to agree
 * with this module about where one begins and ends -- a repair written into a
 * span the renderer then read differently would be worse than no repair.
 */
export function markdownTables(content: string): SourceRange[][][] {
    const tables: SourceRange[][][] = [];
    let rows: SourceRange[][] | null = null;

    for (const line of toLines(content)) {
        if (!TABLE_ROW.test(line.text)) {
            if (rows) tables.push(rows);
            rows = null;
            continue;
        }

        rows ??= [];
        if (!TABLE_DELIMITER.test(line.text)) rows.push(cellRanges(line));
    }

    if (rows) tables.push(rows);

    return tables;
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
    checked?: boolean;
    ranges: Range[];
    blocks: Block[];
    /** Non-zero when the item's own text is a heading; see below. */
    headingLevel: number;
    sectionId?: string;
    value?: number;
    typedMarker?: number;
    /** An agenda item's heading, already the first of its blocks. */
    title?: HeadingBlock;
};

/**
 * A list under an agenda item: the column the agenda's own items start at,
 * and the number the next of them will carry.
 */
type AgendaContext = { indent: number; next: number };

/** A line indented under the item above it that is not a block of its own. */
function isIndentedText(text: string): boolean {
    return /^\s+\S/.test(text) && !startsBlock(text);
}

/**
 * One list, from `from` until a line that belongs to something else.
 *
 * Indentation decides nesting: deeper than the first item starts a sublist,
 * shallower hands the line back to the caller. The export is inconsistent
 * about widths -- 2, 3, 4 and 6 spaces all appear -- so relative depth is the
 * only workable rule.
 *
 * An agenda is the exception. Its sub-items often come out at the same column
 * as the items themselves ("1. Present" right under "1. **Call to Order**"),
 * so there the emphasis decides: everything up to the next agenda item belongs
 * to the one above it, as lib/outline.ts reads it too.
 */
function parseList(
    lines: Line[],
    from: number,
    inline: Inline,
    anchors: Map<number, string>,
    agenda: AgendaContext | null = null,
    nested = false,
): { block: Block; next: number } {
    const isAgenda = !nested && isAgendaItem(lines[from].text);
    const bare = isAgenda || agenda !== null;
    const first = itemMarker(lines[from].text, bare)!;
    const items: ListItem[] = [];
    let current: PendingItem | null = null;
    /** The ordinal of the last item at this list's own depth. */
    let last = Number.NaN;
    let index = from;

    const finish = () => {
        if (!current) return;
        const value = first.ordered && current.value !== undefined ? { value: current.value } : {};
        if (current.title) {
            items.push({ runs: [], blocks: current.blocks, ...value });
            current = null;
            return;
        }
        const runs = inline(current.ranges);
        const sectionId = current.sectionId;
        items.push(
            current.headingLevel > 0
                ? {
                    runs: [],
                    blocks: [
                        {
                            kind: "heading",
                            level: current.headingLevel,
                            runs,
                            ...(sectionId ? { sectionId } : {}),
                        },
                        ...current.blocks,
                    ],
                    ...value,
                }
                : {
                    runs,
                    blocks: current.blocks,
                    ...(sectionId ? { sectionId } : {}),
                    ...value,
                    ...(current.typedMarker ? { typedMarker: current.typedMarker } : {}),
                    ...(current.checked !== undefined ? { checked: current.checked } : {}),
                },
        );
        current = null;
    };

    const sublist = () => {
        const context = isAgenda ? { indent: first.indent, next: last + 1 } : agenda;
        const child = parseList(lines, index, inline, anchors, context, true);
        if (current) current.blocks.push(child.block);
        else items.push({ runs: [], blocks: [child.block] });
        index = child.next;
    };

    const startAgendaItem = (line: Line, marker: Marker) => {
        const rest = line.text.slice(marker.width);
        const heading = HEADING.exec(rest);
        const range = lineRange(afterMarker(line, marker.width + (heading?.[0].length ?? 0)));
        const sectionId = anchors.get(line.start);
        if (isBlank(line.text.slice(range.start - line.start))) {
            current = { ranges: [range], blocks: [], headingLevel: 0, sectionId, value: marker.number };
            return;
        }
        // Inlined here rather than in `finish`, so the item's title claims a
        // citation's anchor before the notes under it do.
        const title: HeadingBlock = {
            kind: "heading",
            level: 2,
            runs: inline([range]),
            marker: line.text.slice(marker.indent, marker.width).trim(),
            ...(sectionId ? { sectionId } : {}),
        };
        current = { ranges: [], blocks: [title], headingLevel: 0, value: marker.number, title };
    };

    while (index < lines.length) {
        const line = lines[index];

        if (isBlank(line.text)) {
            // Docs leaves a blank line between items often enough that ending
            // the list here would restart the numbering mid-agenda. One blank
            // line before another item keeps the list together.
            const following = lines[index + 1];
            const next = following ? itemMarker(following.text, bare) : null;
            if (next && next.indent >= first.indent) {
                index += 1;
                continue;
            }
            // So does a note indented under an agenda item, like the reminder
            // under "Adjournment".
            if (current?.title && following && isIndentedText(following.text)) {
                index += 1;
                continue;
            }
            break;
        }

        // Docs draws a line under each agenda item, and the export puts it on
        // the next line as `---`. Read as a rule it would end the agenda after
        // its first item.
        if (current?.title && current.blocks.length === 1 && /^\s*-{3,}\s*$/.test(line.text)) {
            current.title.ruled = true;
            index += 1;
            continue;
        }

        const marker = itemMarker(line.text, bare);

        if (!marker) {
            if (current?.title && isIndentedText(line.text)) {
                const note: Line[] = [];
                while (index < lines.length && isIndentedText(lines[index]!.text)) {
                    note.push(lines[index]!);
                    index += 1;
                }
                current.blocks.push(...parseBlocks(note, inline, anchors));
                continue;
            }
            // A wrapped line continues the item above it. A section does not:
            // "i. Excused" is indented like a wrap and is its own target.
            if (
                current &&
                !current.title &&
                !anchors.has(line.start) &&
                /^\s+\S/.test(line.text) &&
                !startsBlock(line.text)
            ) {
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

        if (index > from && agenda && marker.indent <= agenda.indent) {
            // The next agenda item ends the notes under this one. So does a
            // plain line numbered as the item after it: "6. Student Advisory
            // Board" following "1." to "4." under item 5.
            const resumes =
                marker.style === "number" &&
                marker.number === agenda.next &&
                marker.number !== last + 1;
            if (isAgendaItem(line.text) || resumes) break;
        }

        // A plain list gives way to an agenda that starts partway down it.
        if (
            index > from &&
            !nested &&
            !isAgenda &&
            marker.indent <= first.indent &&
            isAgendaItem(line.text)
        ) {
            break;
        }

        if (marker.indent < first.indent) break;

        const style: MarkerStyle =
            first.style === "letter" && marker.letter === last + 1 ? "letter" : marker.style;
        const ordinal = style === "letter" ? (marker.letter ?? marker.number) : marker.number;
        // The export indents "b." and "c." under "a." even when they are the
        // same kind of item. A sublist starts again from one.
        const continues =
            !isAgenda && first.ordered && style === first.style && ordinal > 1 && ordinal === last + 1;

        if (marker.indent > first.indent && !continues) {
            sublist();
            continue;
        }

        if (isAgenda) {
            // "3. Public Input", unbolded between two bold items, is still the
            // third item of the agenda rather than a note under the second.
            const sequel = marker.style === "number" && marker.number === last + 1;
            if (sequel || isAgendaItem(line.text)) {
                finish();
                startAgendaItem(line, marker);
                last = marker.number;
                index += 1;
            } else {
                sublist();
            }
            continue;
        }

        // A bulleted list starting where a numbered one left off is a new list.
        if (style !== first.style) break;

        finish();

        // Docs nests a heading inside a list item -- "1. ## Call to Order" --
        // whenever an agenda item is styled as a heading in the source.
        const rest = line.text.slice(marker.width);
        const heading = HEADING.exec(rest);
        const typed = !heading && (marker.style === "letter" || marker.style === "roman");
        const width = typed ? marker.indent : marker.width + (heading?.[0].length ?? 0);
        const task = !first.ordered && !heading ? /^\[([ xX])\]\s+/.exec(rest) : null;

        current = {
            ranges: [lineRange(afterMarker(line, width + (task?.[0].length ?? 0)))],
            ...(task ? { checked: task[1].toLowerCase() === "x" } : {}),
            blocks: [],
            headingLevel: heading ? heading[1].length : 0,
            sectionId: anchors.get(line.start),
            value: ordinal,
            ...(typed
                ? { typedMarker: line.text.slice(marker.indent, marker.width).trimEnd().length }
                : {}),
        };
        last = ordinal;
        index += 1;
    }

    finish();

    return {
        block: {
            kind: "list",
            ordered: first.ordered,
            start: first.number,
            items,
            ...(first.style === "letter" || first.style === "roman"
                ? { numbering: first.style }
                : {}),
            ...(isAgenda ? { agenda: true } : {}),
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
 * Minutes labels and speaker turns, used only when a cell is still one line.
 *
 * Tight on purpose: a colon after a short name is how these notes are taken,
 * and a URL or `Intr. Peter Tarpley` must not start a new line.
 */
const CELL_LABEL =
    /^(Discussion:|Changes Made:|Decision:|S-B\.|Motion by |Aye:|Nay:|Abstain:|Second:)/i;
const CELL_SPEAKER = /^[A-Za-z]{3,}(?:\s+\([^)]+\))?:/;

function suggestCellBreaks(input: {
    text: string;
    offsets: number[];
}): { text: string; offsets: number[] } {
    const characters: string[] = [];
    const offsets: number[] = [];
    let index = 0;
    let skipUntil = 0;

    while (index < input.text.length) {
        if (input.text[index] === "[") {
            const link = LINK.exec(input.text.slice(index));
            if (link) {
                for (let step = 0; step < link[0].length; step += 1) {
                    characters.push(input.text[index + step]!);
                    offsets.push(input.offsets[index + step]!);
                }
                index += link[0].length;
                continue;
            }
        }

        const atWord = index === 0 || /\s/.test(input.text[index - 1]!);
        const rest = input.text.slice(index);
        if (atWord && index > 0 && index >= skipUntil) {
            const label = CELL_LABEL.exec(rest);
            if (label || CELL_SPEAKER.test(rest)) {
                if (characters.length > 0 && /\s/.test(characters[characters.length - 1]!)) {
                    characters.pop();
                    offsets.pop();
                }
                characters.push("\n");
                offsets.push(input.offsets[index]!);
                if (label) skipUntil = index + label[0].length;
            }
        }

        characters.push(input.text[index]!);
        offsets.push(input.offsets[index]!);
        index += 1;
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
    mode?: "cell",
): InlineRun[] {
    let flattened = flatten(content, ranges);
    // Layout cells keep an hour of notes. HTML may have restored some
    // paragraphs; the rest still read as one line, so speaker turns and
    // minutes labels are broken out here for display only.
    if (mode === "cell") {
        flattened = suggestCellBreaks(flattened);
    }
    const { text, offsets } = flattened;
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

        // A break lib/cells.ts restored inside a flattened cell, rendered as
        // the newline it stands for. The viewer is pre-wrap, so it shows.
        const breakWidth = cellBreakAt(text, index);
        if (breakWidth > 0) {
            emit("\n", index);
            index += breakWidth;
            continue;
        }

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
