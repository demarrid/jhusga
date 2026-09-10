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
