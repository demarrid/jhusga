/**
 * Text out of an Office file the Drive export path cannot see.
 *
 * SharePoint sharing links serve .docx (and occasionally .xlsx) rather than
 * a Google Docs markdown export. Citation offsets still need a stable string,
 * so this is a lossy but deterministic flattening: paragraphs become lines,
 * and everything else is dropped.
 */

import { inflateRawSync } from "node:zlib";

const LOCAL_FILE = 0x04034b50;

/**
 * One named entry from a ZIP, or null if the archive uses a layout this
 * reader does not handle (data descriptors, ZIP64). Those files are skipped
 * at ingest rather than guessed at.
 */
function zipEntry(buffer: Buffer, name: string): Buffer | null {
    let offset = 0;

    while (offset + 30 <= buffer.length) {
        if (buffer.readUInt32LE(offset) !== LOCAL_FILE) break;

        const flags = buffer.readUInt16LE(offset + 6);
        const method = buffer.readUInt16LE(offset + 8);
        const compressedSize = buffer.readUInt32LE(offset + 18);
        const nameLength = buffer.readUInt16LE(offset + 26);
        const extraLength = buffer.readUInt16LE(offset + 28);
        const fileName = buffer
            .subarray(offset + 30, offset + 30 + nameLength)
            .toString("utf8");
        const dataStart = offset + 30 + nameLength + extraLength;

        // Bit 3: sizes live in a trailing data descriptor. Without them the
        // compressed payload has no advertised length.
        if (flags & 0x8) return null;

        const dataEnd = dataStart + compressedSize;
        if (dataEnd > buffer.length) return null;

        if (fileName === name) {
            const payload = buffer.subarray(dataStart, dataEnd);
            if (method === 0) return Buffer.from(payload);
            if (method === 8) return inflateRawSync(payload);
            return null;
        }

        offset = dataEnd;
    }

    return null;
}

function xmlText(xml: string, tag: string): string[] {
    const pieces: string[] = [];
    const pattern = new RegExp(`<${tag}[^>]*>([^<]*)</${tag}>`, "g");
    for (const match of xml.matchAll(pattern)) {
        pieces.push(decodeXml(match[1]!));
    }
    return pieces;
}

function decodeXml(value: string): string {
    return value
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&#x([0-9a-f]+);/gi, (_, hex) =>
            String.fromCharCode(Number.parseInt(hex, 16)),
        )
        .replace(/&#(\d+);/g, (_, dec) =>
            String.fromCharCode(Number.parseInt(dec, 10)),
        );
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

/**
 * SpreadsheetML to CSV-ish text: the shared strings of the first sheet, one
 * row per line. Enough to search and cite, not a workbook.
 */
export function xlsxToText(buffer: Buffer): string | null {
    const stringsXml = zipEntry(buffer, "xl/sharedStrings.xml");
    const sheet = zipEntry(buffer, "xl/worksheets/sheet1.xml");
    if (!sheet) return null;

    const strings = stringsXml
        ? xmlText(stringsXml.toString("utf8"), "t")
        : [];

    const rows: string[] = [];
    for (const rowXml of sheet.toString("utf8").split(/<\/row>/)) {
        const cells: string[] = [];
        for (const match of rowXml.matchAll(
            /<c\b([^>]*)>(?:<v>([^<]*)<\/v>)?/g,
        )) {
            const attrs = match[1] ?? "";
            const value = match[2] ?? "";
            if (/\bt="s"/.test(attrs)) {
                const index = Number(value);
                cells.push(strings[index] ?? "");
            } else {
                cells.push(value);
            }
        }
        if (cells.some((cell) => cell.trim())) rows.push(cells.join("\t"));
    }

    const text = rows.join("\n").trim();
    return text || null;
}
