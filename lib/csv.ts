/**
 * A line that opens a later tab of the same workbook.
 *
 * The first tab is stored as it always was, with no marker, so a one-tab
 * file and every citation into it stay put. Each further tab is a line
 * `\fName` and then that tab's rows. The character is a form feed, which
 * no stored cell contains: `formatDelimited` replaces it, and so does the
 * Drive export for the first tab.
 */
export const SHEET_BREAK = "\f";

/** The first tab of a stored workbook, or the whole text when it has one tab. */
export function firstSheetText(content: string): string {
    const at = content.indexOf(`\n${SHEET_BREAK}`);
    return at === -1 ? content : content.slice(0, at);
}

/**
 * One workbook's tabs as stored text.
 *
 * `first` is the leading tab and is not renamed: Google Sheets keep the CSV
 * Drive already exported, whose bytes citations may already point into.
 * Later tabs are appended. Empty tabs are dropped, and a workbook whose
 * first tab is blank starts at the next one that has rows.
 */
export function appendWorkbookSheets(
    first: string,
    rest: { name: string; text: string }[],
): string {
    const more = rest
        .map((sheet) => ({
            name: sheet.name.replace(/[\r\n\f]/g, " ").trim() || "Sheet",
            text: sheet.text.trim(),
        }))
        .filter((sheet) => sheet.text);

    const head = first.trim();
    if (more.length === 0) return head;
    if (!head) {
        const [primary, ...tail] = more;
        return appendWorkbookSheets(primary!.text, tail);
    }

    const appended = more
        .map((sheet) => `${SHEET_BREAK}${sheet.name}\n${sheet.text}`)
        .join("\n");
    return `${head}\n${appended}`;
}

/**
 * Rows joined for storage, one row per line.
 *
 * Every reader of stored sheets -- the renderer, the roster and attendance
 * parsers -- splits on newlines before it splits cells, so a line break or
 * form feed inside a cell is flattened to a space for both delimiters
 * rather than quoted across lines. Tabs never quote: the xlsx path has
 * always treated a quote as text, so a tab in a cell is flattened too.
 * Commas quote the way Drive's CSV export does, because that is the Google
 * Sheet dialect the roster and attendance readers already parse.
 */
export function formatDelimited(rows: string[][], delimiter: "," | "\t"): string {
    return rows
        .map((row) => row.map((cell) => formatCell(cell, delimiter)).join(delimiter))
        .join("\n");
}

function formatCell(value: string, delimiter: "," | "\t"): string {
    const clean = value.replace(/\r\n|[\r\n\f]/g, " ");
    if (delimiter === "\t") return clean.replace(/\t/g, " ");
    if (/[",]/.test(clean)) return `"${clean.replace(/"/g, '""')}"`;
    return clean;
}

/**
 * Which delimiter a stored document's rows are separated by, or null when it
 * is not a spreadsheet at all.
 *
 * Two formats reach the database and they do not agree. A Google Sheet is
 * exported through Drive as real CSV; an Excel file behind a SharePoint link
 * goes through `xlsxToText`, which joins cells with tabs and does no quoting.
 * Reading one as the other turns a table into a single column, so the caller
 * has to know which it has.
 */
export function sheetDelimiter(mimeType: string): "," | "\t" | null {
    if (/spreadsheetml|excel/i.test(mimeType)) return "\t";
    if (/spreadsheet|csv/i.test(mimeType)) return ",";
    return null;
}

/**
 * One CSV row into cells.
 *
 * Sheets exported from Drive are the only CSV this site reads, so this handles
 * exactly what Drive emits: comma separators and doubled quotes inside quoted
 * cells ("First-Generation, Limited-Income").
 */
export function parseCsvLine(line: string): string[] {
    const cells: string[] = [];
    let current = "";
    let inQuotes = false;

    for (let index = 0; index < line.length; index += 1) {
        const char = line[index]!;
        if (char === '"') {
            if (inQuotes && line[index + 1] === '"') {
                current += '"';
                index += 1;
            } else {
                inQuotes = !inQuotes;
            }
            continue;
        }
        if (char === "," && !inQuotes) {
            cells.push(current.trim());
            current = "";
            continue;
        }
        current += char;
    }
    cells.push(current.trim());
    return cells;
}

/** A half-open slice of the stored document. */
export type CellRange = { start: number; end: number };

/**
 * The same split, but as offsets into the document rather than as strings.
 *
 * Citations index into the stored text by byte range, so showing a sheet as a
 * table cannot mean rebuilding it from parsed strings -- the highlights would
 * have nothing to attach to. This returns, for each cell, the ranges of the
 * original line that make up its value: several ranges rather than one,
 * because the syntax dropped from the middle of `"a ""quoted"" cell"` leaves
 * gaps that the offsets have to step over.
 */
export function csvCellRanges(
    line: string,
    lineStart: number,
    delimiter: "," | "\t",
): CellRange[][] {
    // Tab-separated rows come out of xlsxToText, which never quotes anything,
    // so a quote character there is part of somebody's text.
    const quoting = delimiter === ",";

    const cells: CellRange[][] = [];
    let current: CellRange[] = [];
    let inQuotes = false;

    // Extends the open range when the previous character was kept, so an
    // unremarkable cell ends up as exactly one range.
    const keep = (index: number) => {
        const last = current[current.length - 1];
        if (last && last.end === lineStart + index) {
            last.end += 1;
        } else {
            current.push({ start: lineStart + index, end: lineStart + index + 1 });
        }
    };

    for (let index = 0; index < line.length; index += 1) {
        const char = line[index]!;

        if (quoting && char === '"') {
            if (inQuotes && line[index + 1] === '"') {
                // One of the pair stands for the literal quote; the other is
                // syntax and is stepped over.
                keep(index);
                index += 1;
                continue;
            }
            inQuotes = !inQuotes;
            continue;
        }

        if (char === delimiter && !inQuotes) {
            cells.push(trimRanges(line, lineStart, current));
            current = [];
            continue;
        }

        keep(index);
    }

    cells.push(trimRanges(line, lineStart, current));
    return cells;
}

/** Narrow a cell's ranges past surrounding whitespace, matching `.trim()`. */
function trimRanges(
    line: string,
    lineStart: number,
    ranges: CellRange[],
): CellRange[] {
    const trimmed = ranges.map((range) => ({ ...range }));
    const at = (offset: number) => line[offset - lineStart] ?? "";

    while (trimmed.length > 0) {
        const first = trimmed[0]!;
        while (first.start < first.end && /\s/.test(at(first.start))) first.start += 1;
        if (first.start < first.end) break;
        trimmed.shift();
    }

    while (trimmed.length > 0) {
        const last = trimmed[trimmed.length - 1]!;
        while (last.end > last.start && /\s/.test(at(last.end - 1))) last.end -= 1;
        if (last.end > last.start) break;
        trimmed.pop();
    }

    return trimmed;
}
