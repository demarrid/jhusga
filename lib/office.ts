/**
 * Text out of an Office file the Drive export path cannot see.
 *
 * SharePoint sharing links serve .docx (and occasionally .xlsx) rather than
 * a Google Docs markdown export. Citation offsets still need a stable string,
 * so this is a lossy but deterministic flattening: paragraphs become lines,
 * and everything else is dropped.
 */

import { inflateRawSync } from "node:zlib";
import { appendWorkbookSheets, formatDelimited } from "@/lib/csv";

const LOCAL_FILE = 0x04034b50;
const CENTRAL_FILE = 0x02014b50;
const END_OF_CENTRAL = 0x06054b50;

/** Past this an entry is a zip bomb or a workbook too big to flatten usefully. */
const MAX_ENTRY_BYTES = 64 * 1024 * 1024;

type ZipEntry = { method: number; flags: number; compressedSize: number; localOffset: number };

type Zip = { names: string[]; read: (name: string) => Buffer | null };

/**
 * A ZIP's entries, found through its central directory, or null if this
 * reader cannot open it (no directory, ZIP64).
 *
 * The local headers alone are not enough: Drive's xlsx export, and most
 * writers that stream, set bit 3 and leave the sizes there as zero, with the
 * real ones in a data descriptor after the payload. The central directory
 * always has them. Entries are inflated only when asked for, so the images
 * and drawings in a workbook are never decompressed.
 */
function openZip(buffer: Buffer): Zip | null {
    // The end record is 22 bytes plus a comment of at most 64 KiB.
    const floor = Math.max(0, buffer.length - 22 - 0xffff);
    let end = -1;
    for (let at = buffer.length - 22; at >= floor; at -= 1) {
        if (buffer.readUInt32LE(at) === END_OF_CENTRAL) {
            end = at;
            break;
        }
    }
    if (end === -1) return null;

    const count = buffer.readUInt16LE(end + 10);
    let at = buffer.readUInt32LE(end + 16);
    if (count === 0xffff || at === 0xffffffff) return null;

    const entries = new Map<string, ZipEntry>();
    for (let index = 0; index < count; index += 1) {
        if (at + 46 > buffer.length || buffer.readUInt32LE(at) !== CENTRAL_FILE) return null;

        const nameLength = buffer.readUInt16LE(at + 28);
        const name = buffer
            .toString("utf8", at + 46, at + 46 + nameLength)
            .replace(/\\/g, "/");
        const entry = {
            flags: buffer.readUInt16LE(at + 8),
            method: buffer.readUInt16LE(at + 10),
            compressedSize: buffer.readUInt32LE(at + 20),
            localOffset: buffer.readUInt32LE(at + 42),
        };
        if (entry.compressedSize === 0xffffffff || entry.localOffset === 0xffffffff) {
            return null;
        }
        if (!entries.has(name)) entries.set(name, entry);

        at += 46 + nameLength + buffer.readUInt16LE(at + 30) + buffer.readUInt16LE(at + 32);
    }

    return {
        names: [...entries.keys()],
        read: (name) => {
            const entry = entries.get(name);
            return entry ? inflateEntry(buffer, entry) : null;
        },
    };
}

function inflateEntry(buffer: Buffer, entry: ZipEntry): Buffer | null {
    // Bit 0: encrypted.
    if (entry.flags & 0x1) return null;

    const at = entry.localOffset;
    if (at + 30 > buffer.length || buffer.readUInt32LE(at) !== LOCAL_FILE) return null;

    // The local extra field can differ in length from the central one.
    const start = at + 30 + buffer.readUInt16LE(at + 26) + buffer.readUInt16LE(at + 28);
    const end = start + entry.compressedSize;
    if (end > buffer.length) return null;

    const payload = buffer.subarray(start, end);
    if (entry.method === 0) return Buffer.from(payload);
    if (entry.method !== 8) return null;
    try {
        return inflateRawSync(payload, { maxOutputLength: MAX_ENTRY_BYTES });
    } catch {
        return null;
    }
}

/** One named entry from a ZIP. See `openZip`. */
function zipEntry(buffer: Buffer, name: string): Buffer | null {
    return openZip(buffer)?.read(name) ?? null;
}

function xmlText(xml: string, tag: string): string[] {
    const pieces: string[] = [];
    // `(?:\s[^>]*)?` rather than `[^>]*`, so `<t/>` is not read as an opening tag.
    const pattern = new RegExp(`<${tag}(?:\\s[^>]*)?>([^<]*)</${tag}>`, "g");
    for (const match of xml.matchAll(pattern)) {
        pieces.push(decodeXml(match[1]!));
    }
    return pieces;
}

const ENTITIES: Record<string, string> = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    apos: "'",
};

/** One pass, so `&amp;lt;` comes out as the text `&lt;` and not as `<`. */
function decodeXml(value: string): string {
    return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, name: string) => {
        if (name[0] !== "#") return ENTITIES[name] ?? whole;
        const code =
            name[1] === "x" || name[1] === "X"
                ? Number.parseInt(name.slice(2), 16)
                : Number.parseInt(name.slice(1), 10);
        return code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    });
}

/**
 * WordprocessingML to plain text. Paragraphs (`w:p`) become newlines so a
 * bill's caption still reads as the caption.
 */
export function docxToText(buffer: Buffer): string | null {
    const xml = zipEntry(buffer, "word/document.xml");
    if (!xml) return null;

    const document = xml.toString("utf8");
    const paragraphs = document.split(/<\/w:p>/);
    const lines: string[] = [];

    for (const paragraph of paragraphs) {
        const runs = xmlText(paragraph, "w:t");
        const line = runs.join("").replace(/\s+/g, " ").trim();
        if (line) lines.push(line);
    }

    const text = lines.join("\n").trim();
    return text || null;
}

export type XlsxSheet = { name: string; rows: string[][] };

/**
 * Every worksheet, in tab order, empty ones included.
 *
 * Tab order is the workbook's, not the filename's: deleting a sheet leaves
 * `sheet1.xml` and `sheet3.xml`, and the second file is not the second tab.
 * Empty tabs are kept so that index 0 is always the first tab, which is the
 * one Drive's CSV export already holds. Hidden tabs are kept too: hiding is
 * a view setting, and the rows are still what the sheet says. Chart and
 * dialog sheets have no cells and are not listed.
 *
 * A workbook this reader cannot open yields no sheets rather than the first
 * one it happens to find.
 */
export function xlsxSheets(buffer: Buffer): XlsxSheet[] {
    const zip = openZip(buffer);
    if (!zip) return [];

    const book: Book = {
        strings: sharedStrings(zip.read("xl/sharedStrings.xml")),
        dateStyles: dateStyles(zip.read("xl/styles.xml")),
        epoch: /\bdate1904="(?:1|true)"/.test(
            zip.read("xl/workbook.xml")?.toString("utf8") ?? "",
        )
            ? EPOCH_1904
            : EPOCH_1900,
    };

    const sheets: XlsxSheet[] = [];
    for (const { name, path } of worksheetPaths(zip)) {
        const xml = zip.read(path);
        sheets.push({ name, rows: xml ? sheetRows(xml.toString("utf8"), book) : [] });
    }
    return sheets;
}

/** What a cell needs from the rest of the workbook to be read. */
type Book = {
    strings: string[];
    /** Indexes into `cellXfs` whose number format shows a date or time. */
    dateStyles: Set<number>;
    /** Serial number of 1970-01-01 in this workbook's date system. */
    epoch: number;
};

const EPOCH_1900 = 25569;
const EPOCH_1904 = 24107;

/** Excel's built-in date and time formats, which styles.xml does not spell out. */
const BUILT_IN_DATE_FORMATS: Record<number, string> = {
    14: "m/d/yyyy",
    15: "d-mmm-yy",
    16: "d-mmm",
    17: "mmm-yy",
    18: "h:mm AM/PM",
    19: "h:mm:ss AM/PM",
    20: "h:mm",
    21: "h:mm:ss",
    22: "m/d/yyyy h:mm",
    45: "mm:ss",
    46: "[h]:mm:ss",
    47: "mmss.0",
};

function dateStyles(xml: Buffer | null): Set<number> {
    const dates = new Set<number>();
    if (!xml) return dates;
    const styles = xml.toString("utf8");

    const codes = new Map<number, string>();
    for (const tag of styles.match(/<numFmt\b[^>]*>/g) ?? []) {
        const id = Number(attr(tag, "numFmtId"));
        const code = attr(tag, "formatCode");
        if (code !== null) codes.set(id, code);
    }

    const cellXfs = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(styles)?.[1] ?? "";
    (cellXfs.match(/<xf\b[^>]*>/g) ?? []).forEach((tag, index) => {
        const id = Number(attr(tag, "numFmtId") ?? 0);
        const code = codes.get(id) ?? BUILT_IN_DATE_FORMATS[id];
        if (code && isDateFormat(code)) dates.add(index);
    });
    return dates;
}

/** A format code with a date or time part outside its literals and colours. */
function isDateFormat(code: string): boolean {
    const bare = code
        .replace(/"[^"]*"/g, "")
        .replace(/\[[^\]]*\]/g, "")
        .replace(/\\./g, "")
        .replace(/General/gi, "");
    return /[dmyhs]/i.test(bare);
}

/**
 * A date serial the way Drive's CSV shows an unformatted date: `6/30/2026`,
 * and the time after it when the cell has one.
 */
function formatSerial(serial: number, epoch: number): string {
    const at = new Date(Math.round((serial - epoch) * 86_400_000));
    const date = `${at.getUTCMonth() + 1}/${at.getUTCDate()}/${at.getUTCFullYear()}`;
    const clock = `${at.getUTCHours()}:${[at.getUTCMinutes(), at.getUTCSeconds()]
        .map((part) => String(part).padStart(2, "0"))
        .join(":")}`;
    if (serial < 1) return clock;
    return clock === "0:00:00" ? date : `${date} ${clock}`;
}

/**
 * SpreadsheetML to text: every worksheet, one row per line.
 *
 * Cells are tab-separated. Later tabs follow a form-feed line that names
 * them, so a search can find a row that does not live on the first sheet
 * and still tell which tab it came from.
 */
export function xlsxToText(buffer: Buffer): string | null {
    const sheets = xlsxSheets(buffer).map((sheet) => ({
        name: sheet.name,
        text: formatDelimited(sheet.rows, "\t"),
    }));
    if (sheets.length === 0) return null;
    const [first, ...rest] = sheets;
    const text = appendWorkbookSheets(first!.text, rest);
    return text || null;
}

function sharedStrings(xml: Buffer | null): string[] {
    if (!xml) return [];
    // Phonetic runs carry their own `<t>` and are not the string.
    const source = xml
        .toString("utf8")
        .replace(/<rPh\b[^>]*>[\s\S]*?<\/rPh>/g, "");
    const strings: string[] = [];
    // `<si/>` is an empty string, and still takes up its index.
    for (const item of source.matchAll(/<si\b[^>]*?(?:\/>|>([\s\S]*?)<\/si>)/g)) {
        strings.push(cellText(item[1] ?? ""));
    }
    return strings;
}

/**
 * The text of a string item, its runs joined.
 *
 * Excel escapes characters XML cannot carry as `_xHHHH_`; a carriage return
 * typed in a cell is stored as `_x000D_`.
 */
function cellText(xml: string): string {
    return xmlText(xml, "t")
        .join("")
        .replace(/_x([0-9a-f]{4})_/gi, (_, hex: string) =>
            String.fromCharCode(Number.parseInt(hex, 16)),
        );
}

function worksheetPaths(zip: Zip): { name: string; path: string }[] {
    const workbook = zip.read("xl/workbook.xml")?.toString("utf8");
    const rels = zip.read("xl/_rels/workbook.xml.rels")?.toString("utf8");
    if (workbook && rels) {
        const targets = new Map<string, string>();
        for (const tag of rels.match(/<Relationship\b[^>]*>/g) ?? []) {
            const id = attr(tag, "Id");
            const target = attr(tag, "Target");
            const type = attr(tag, "Type") ?? "";
            if (!id || !target) continue;
            if (type && !/\/worksheet$/.test(type)) continue;
            targets.set(id, worksheetPath(target));
        }

        const sheets: { name: string; path: string }[] = [];
        for (const tag of workbook.match(/<sheet\b[^>]*>/g) ?? []) {
            const id = attr(tag, "r:id");
            const path = id ? targets.get(id) : undefined;
            if (!path) continue;
            sheets.push({ name: attr(tag, "name")?.trim() || "Sheet", path });
        }
        if (sheets.length > 0) return sheets;
    }

    return zip.names
        .filter((name) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(name))
        .sort((a, b) => sheetNumber(a) - sheetNumber(b))
        .map((path, index) => ({ name: `Sheet${index + 1}`, path }));
}

function sheetNumber(path: string): number {
    return Number(/sheet(\d+)\.xml$/i.exec(path)?.[1] ?? 0);
}

/** A relationship target, resolved against `xl/workbook.xml`. */
function worksheetPath(target: string): string {
    const cleaned = target.split("?")[0]!.replace(/\\/g, "/");
    if (cleaned.startsWith("/")) return cleaned.slice(1);
    if (cleaned.startsWith("xl/")) return cleaned;

    const parts = ["xl"];
    for (const part of cleaned.split("/")) {
        if (part === "..") parts.pop();
        else if (part && part !== ".") parts.push(part);
    }
    return parts.join("/");
}

function attr(tag: string, name: string): string | null {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = new RegExp(`(?:^|\\s)${escaped}="([^"]*)"`).exec(tag);
    return match ? decodeXml(match[1]!) : null;
}

/**
 * One worksheet's rows.
 *
 * Empty cells are omitted from the XML, so a value in column C is not the
 * third `<c>` when B is blank. The cell reference (`r="C4"`) is what puts
 * it back in column C; without that, a gutter in the attendance sheet
 * would close up and every seat to the right of it would be read wrong.
 */
function sheetRows(xml: string, book: Book): string[][] {
    const rows: string[][] = [];

    // Both patterns accept the self-closing form first, so an empty `<row/>`
    // or `<c/>` cannot run on and take the next one's contents as its own.
    for (const row of xml.matchAll(/<row\b[^>]*?(?:\/>|>([\s\S]*?)<\/row>)/g)) {
        if (!row[1]) continue;
        const cells: string[] = [];
        for (const cell of row[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
            const attrs = cell[1] ?? "";
            const body = cell[2] ?? "";
            const ref = /\br="([^"]+)"/.exec(attrs)?.[1];
            const column = ref ? columnIndex(ref) : cells.length;
            if (column === null || column < 0) continue;
            while (cells.length < column) cells.push("");
            cells[column] = cellValue(attrs, body, book);
        }
        while (cells.length > 0 && cells[cells.length - 1] === "") cells.pop();
        if (cells.some((cell) => cell.trim())) rows.push(cells);
    }

    return rows;
}

function columnIndex(ref: string): number | null {
    const letters = /^([A-Z]+)/i.exec(ref)?.[1];
    if (!letters) return null;
    let index = 0;
    for (const char of letters.toUpperCase()) {
        index = index * 26 + (char.charCodeAt(0) - 64);
    }
    return index - 1;
}

/**
 * A cell's value, close to what Drive's CSV would print for it.
 *
 * Only dates are formatted, because a serial like 45398 means nothing to a
 * reader or a search. Other numbers are printed plainly, without the `.0`
 * Google writes on whole numbers, rather than through their format code.
 */
function cellValue(attrs: string, body: string, book: Book): string {
    const type = /\bt="([^"]*)"/.exec(attrs)?.[1] ?? "";
    if (type === "s") {
        const index = Number(elementText(body, "v"));
        return book.strings[index] ?? "";
    }
    if (type === "inlineStr") {
        const inline = /<is\b[^>]*>([\s\S]*?)<\/is>/.exec(body)?.[1] ?? "";
        return cellText(inline);
    }

    const value = elementText(body, "v");
    if (type === "b") return value === "1" ? "TRUE" : value === "0" ? "FALSE" : value;
    if (type !== "" && type !== "n") return value;

    const number = value.trim() ? Number(value) : Number.NaN;
    if (!Number.isFinite(number)) return value;
    const style = Number(/\bs="(\d+)"/.exec(attrs)?.[1] ?? 0);
    if (book.dateStyles.has(style) && number >= 0) return formatSerial(number, book.epoch);
    return String(number);
}

function elementText(xml: string, tag: string): string {
    const match = new RegExp(`<${tag}(?:\\s[^>]*)?>([^<]*)</${tag}>`).exec(xml);
    return match ? decodeXml(match[1]!) : "";
}
