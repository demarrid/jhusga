/**
 * Where to put black boxes on a source file's pages.
 *
 * scripts/source-redact.py reports the words on each page and where they sit;
 * this decides which of them to cover, from the same detector that redacts the
 * stored text (lib/archive-redaction.ts), so the copy a reader opens hides what
 * the page they came from hides.
 *
 * Two kinds of box:
 *
 * - value boxes, over the words a span covers, wherever the detector finds a
 *   number or address in a line of text or OCR;
 * - field boxes, beside and below a form label like "Social security number"
 *   or "Address (number, street, and apt. or suite no.)". A filled-in W-9 is
 *   handwriting in a box under a printed label, which OCR rarely reads well
 *   enough to recognise as a number, so the field is covered whether or not its
 *   contents were read. Only short lines count as labels, so the paragraphs of
 *   instructions on the back of the form, which mention SSNs throughout, stay.
 *
 * Neither is trusted alone: the pipeline renders every page for a person to
 * review before a copy is published, and config/source-redactions.json adds
 * the boxes that review finds missing.
 */
import { findSensitiveSpans, hasRedactions, isBusinessColumn, type RedactOptions, isBusinessContext, isOfficeAddress, isPhoneHeading, isPrivatePhoneCell, type RedactionKind } from "@/lib/archive-redaction";

export type Box = [number, number, number, number];
export type PageWord = { text: string; box: Box };
export type PageLine = { source: "text" | "ocr"; words: PageWord[]; confidence?: number };
export type SourcePage = { width: number; height: number; lines: PageLine[] };
/**
 * `reason` explains the box in words, quoting the line that triggered it with
 * the covered value replaced by ▇▇▇ and any other digit by #, so a review of
 * the reasons never republishes what the box hides.
 */
export type RedactionBox = {
    page: number; box: Box; kind: RedactionKind | "form field" | "withheld page"; method: "value" | "field" | "manual";
    reason: string;
    /** Printed in white on a withheld page, saying what the page was ("This is a W-9."). */
    notice?: string;
};

/** Manual boxes for one document. Pages are 1-based; boxes are fractions of the page. */
export type ManualRedactions = {
    pages?: number[];
    /** What withheld `pages` say on the page; defaults to "This page is withheld." */
    pageNotice?: string;
    boxes?: { page: number; box: Box; note?: string }[];
    note?: string;
};

const PAD = 2;

const DRIVE_ID = /(?:drive|docs)\.google\.com\/(?:file|document|spreadsheets|presentation)\/d\/([\w-]{20,})/g;

/**
 * The Drive files a document was made from: the ones its "## Sources" footer
 * links (an archive record may join several photographs), else its own file.
 * These are the links a redacted or withheld source must replace.
 */
export function sourceFileIds(content: string, driveFileId: string): string[] {
    const at = content.search(/\n+## Sources\n/);
    const listed = at < 0 ? [] : Array.from(content.slice(at).matchAll(DRIVE_ID), match => match[1]);
    const ids = [...new Set(listed)];
    return ids.length ? ids : /^[\w-]{20,}$/.test(driveFileId) ? [driveFileId] : [];
}

/** Whether a link points at one of these Drive files. */
export function linksToSource(href: string, ids: string[]): boolean {
    return ids.some(id => href.includes(`/d/${id}`) || href.includes(`id=${id}`));
}

/**
 * What "view source" may open.
 *
 * - original: the Drive file, as before;
 * - redacted: the approved blacked-out copy served by
 *   /api/documents/[documentId]/source;
 * - withheld: no link, because the stored text needed personal data removed
 *   and nobody has approved a redacted copy yet. The Drive original still
 *   holds what the text hides, so linking it would undo the filter.
 *
 * `protectedIds` are the Drive files whose links the page must not show.
 */
export type SourceAccess = { mode: "original" | "redacted" | "withheld"; href: string | null; protectedIds: string[] };

export function sourceAccess(document: {
    id: string; driveFileId: string; source: string; content: string; discoveredVia: string;
    redactedSourceStatus: string | null;
}): SourceAccess {
    const ids = [...new Set([document.driveFileId, ...sourceFileIds(document.content, document.driveFileId)])];
    if (document.redactedSourceStatus === "approved") {
        return { mode: "redacted", href: `/api/documents/${document.id}/source`, protectedIds: ids };
    }
    if (document.discoveredVia !== "newsletter" && document.discoveredVia !== "gazette" && hasRedactions(document.content)) {
        return { mode: "withheld", href: null, protectedIds: ids };
    }
    return { mode: "original", href: document.source, protectedIds: [] };
}

/**
 * The same structure with every `href` that opens a protected source pointed
 * at the redacted copy, or removed. Walks rendered blocks generically, so a
 * new kind of run or cell carrying a link is covered too.
 */
export function protectSourceLinks<T>(value: T, access: SourceAccess): T {
    if (!access.protectedIds.length) return value;
    const walk = (node: unknown): unknown => {
        if (Array.isArray(node)) return node.map(walk);
        if (!node || typeof node !== "object" || node instanceof Date) return node;
        return Object.fromEntries(Object.entries(node).map(([key, child]) =>
            key === "href" && typeof child === "string" && linksToSource(child, access.protectedIds)
                ? [key, access.href]
                : [key, walk(child)]));
    };
    return walk(value) as T;
}

/**
 * Printed labels whose field holds a personal value. Written for OCR, which
 * drops spaces ("Home addressis reguired"), so word gaps are optional.
 * `above` is how many line heights the field reaches up: people write an SSN
 * wherever there is room, often above and to the right of its label.
 */
const FIELD_LABELS: { pattern: RegExp; kind: RedactionKind; above: number }[] = [
    // OCR may glue stray letters in front ("nsSN:"); then "SN" must still be
    // capitals (case-sensitive), so "Johnssn" and "Students Assn." are not labels.
    { pattern: /(?<=[a-z])[sS]SN\b/, kind: "financial identifier", above: 4 },
    { pattern: /social\s*security\s*(?:number|no\b)|\bSSN\b|taxpayer\s*identification\s*(?:number|no\b)|employer\s*identification\s*(?:number|no\b)|\bTIN\b|\bEIN\b/i, kind: "financial identifier", above: 4 },
    { pattern: /bank\s*account\s*(?:number|no\b)|routing\s*(?:number|no\b)/i, kind: "financial identifier", above: 1.5 },
    { pattern: /(?:home|hume|mailing|permanent|street)\s*ad+r?[ce]ss|\bad+r?[ce]ss\s*\(\s*(?:number|h\w{2}e)|ad+r?[ce]ss\s*is\s*r\w{2,4}ired|city,?\s*state,?\s*and\s*zip/i, kind: "home address", above: 1 },
    { pattern: /date\s*of\s*birth|driver['’]?s?\s*licen[cs]e/i, kind: "personal identifier", above: 1.5 },
    { pattern: /\b(?:cell|mobile|home)\s*(?:phone|number|tel)/i, kind: "phone number", above: 1 },
    // "Email Password:" with the password on the line below it.
    // Only a label that ends its line: "Password: x" on one line is the text rule's.
    { pattern: /\bpass\s*words?\s*:\s*$/i, kind: "credential", above: 0.5 },
];
/** Longer than this, beyond the label itself, and the line is prose about the field. */
const LABEL_SLACK = 30;
/** A label that opens its line ("2. Address (Home address is required...)") may run this long. */
const OPENING_LABEL_LENGTH = 120;

/**
 * Shapes OCR gives handwriting that the text detector cannot trust: an SSN
 * read as "218-76-cc49", a street read as "5678 PoMTIAC STRELT". Only applied
 * to OCR lines, and only to cover, never to decide what the stored text says.
 */
// Handwritten dashes come back as "~" or "_" too ("123-o4~5678").
const OCR_SSN = /(?<![\w-])[\dOoIlSsBZ]{3}[-–—.~_ ]{1,2}[\dOoIlSsBZ]{2}[-–—.~_ ]{1,2}\w{4}(?![\w-])/g;
// A gap before the suffix ("Breakfast" ends in "st" but is not a street), no
// dollar sign before the number (a price), and only on a short line or one
// that says "address": a sentence naming a building's address is prose.
const OCR_STREET = /(?<![\w$-])\d{2,6}[ .]*(?:[NSEW][ .]+)?[A-Za-z]{3,}(?:[ .]+(?:str\w{0,3}t|st\b\.?|ave\w*|road|rd\b|lane|ln\b|drive|dr\b|court|ct\b|blvd|place|pl\b|way\b)|street\b)/gi;
const OCR_STREET_LINE = 60;

/** OCR runs words together ("MattinCenterSuite210"); split them back for word-based rules. */
export function spacedOcr(text: string): string {
    return text.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/([A-Za-z])(\d)/g, "$1 $2").replace(/(\d)([A-Za-z]{2,})/g, "$1 $2")
        .replace(/([.,:;|)])(?=[A-Za-z(])/g, "$1 ");
}
const officeLike = (text: string) => isOfficeAddress(text) || isOfficeAddress(spacedOcr(text));

/** A line with the given ranges blanked and remaining digits masked. */
export function maskedLine(text: string, ranges: { start: number; end: number }[]): string {
    let out = "", at = 0;
    for (const range of [...ranges].sort((a, b) => a.start - b.start)) {
        if (range.start < at) continue;
        out += text.slice(at, range.start).replace(/\d/g, "#") + "▇▇▇";
        at = range.end;
    }
    const masked = (out + text.slice(at).replace(/\d/g, "#")).trim();
    return masked.length > 140 ? masked.slice(0, 137) + "…" : masked;
}

export function lineText(words: PageWord[]): { text: string; ranges: [number, number][] } {
    let text = "";
    const ranges: [number, number][] = [];
    for (const word of words) {
        if (text) text += " ";
        ranges.push([text.length, text.length + word.text.length]);
        text += word.text;
    }
    return { text, ranges };
}

const union = (boxes: Box[]): Box => [
    Math.min(...boxes.map(b => b[0])), Math.min(...boxes.map(b => b[1])),
    Math.max(...boxes.map(b => b[2])), Math.max(...boxes.map(b => b[3])),
];
const pad = ([x0, y0, x1, y1]: Box, page: SourcePage, by = PAD): Box =>
    [Math.max(0, x0 - by), Math.max(0, y0 - by), Math.min(page.width, x1 + by), Math.min(page.height, y1 + by)];

const lineBox = (line: PageLine): Box => union(line.words.map(w => w.box));

/**
 * Up to three lines either side of this one that share its column, within a
 * few line heights: a letterhead, an invoice's "Bill to" block, a form row.
 * OCR words are split back apart so word-based context rules can see them.
 */
export function neighbours(line: PageLine, page: SourcePage): { before: string; after: string } {
    const [x0, y0, x1, y1] = lineBox(line);
    const reach = Math.max(12, (y1 - y0) * 4);
    const near = page.lines
        .filter(other => other !== line && other.words.length)
        .map(other => ({ other, box: lineBox(other) }))
        .filter(({ box }) => box[0] < x1 && box[2] > x0 && Math.abs((box[1] + box[3]) / 2 - (y0 + y1) / 2) <= reach)
        .sort((a, b) => a.box[1] - b.box[1]);
    const text = (other: PageLine) => other.source === "ocr" ? spacedOcr(lineText(other.words).text) : lineText(other.words).text;
    return {
        before: near.filter(({ box }) => box[1] < y0).slice(-3).map(({ other }) => text(other)).join("\n"),
        after: near.filter(({ box }) => box[1] >= y0).slice(0, 3).map(({ other }) => text(other)).join("\n"),
    };
}

/**
 * The text filter's findings on one line, read with the lines stacked above
 * and below it in the same column, as the filter reads running text: "Tel:"
 * under a rental company's name and showroom is the company's number, not a
 * person's.
 */
function spansInContext(line: PageLine, page: SourcePage, options: RedactOptions = {}) {
    const { text } = lineText(line.words);
    const { before, after } = neighbours(line, page);
    const prefix = before ? before + "\n" : "";
    return findSensitiveSpans(prefix + text + (after ? "\n" + after : ""), options)
        .filter(span => span.start >= prefix.length && span.end <= prefix.length + text.length)
        .map(span => ({ ...span, start: span.start - prefix.length, end: span.end - prefix.length }));
}

/** Boxes over the words of one line that a detected span touches. A partly covered word is covered whole. */
export function valueBoxes(line: PageLine, page: SourcePage, pageNumber: number, options: RedactOptions = {}): RedactionBox[] {
    const { text, ranges } = lineText(line.words);
    const { before, after } = neighbours(line, page);
    const spans = spansInContext(line, page, options);
    if (line.source === "ocr") {
        for (const match of text.matchAll(OCR_SSN)) {
            if ((match[0].match(/\d/g) ?? []).length >= 5) spans.push({ start: match.index, end: match.index + match[0].length, kind: "personal identifier",
                rule: "OCR read something in Social Security shape (###-##-####), allowing for misread digits" });
        }
        const addressLine = text.length <= OCR_STREET_LINE || /ad+r?[ce]ss/i.test(text);
        const publicPlace = !options.personal && (officeLike(text) || isBusinessContext(spacedOcr(`${before}\n${text}\n${after}`)) || officeLike(before) || officeLike(after));
        for (const match of addressLine && !publicPlace ? text.matchAll(OCR_STREET) : []) {
            spans.push({ start: match.index, end: match.index + match[0].length, kind: "home address",
                rule: "OCR read a house number and street on a short line, with no campus, office or business name on it or the lines around it" });
        }
    }
    const read = line.source === "ocr" ? (line.words.length === 1 && line.words[0].box[3] - line.words[0].box[1] > line.words[0].box[2] - line.words[0].box[0] ? "Sideways OCR" : "OCR") : "The text layer";
    return spans.flatMap(span => {
        const touched = line.words.filter((_, i) => ranges[i][1] > span.start && ranges[i][0] < span.end);
        return touched.length ? [{ page: pageNumber, box: pad(union(touched.map(w => w.box)), page), kind: span.kind, method: "value" as const,
            reason: `${read} read “${maskedLine(text, spans)}”. Covered: ${span.rule}.` }] : [];
    });
}

/**
 * The field a label line names: the rest of its row to the right edge of the
 * page (reaching up as far as the label's `above`), and nearly two lines below
 * it across the page, where a form puts the answer to "Address (number,
 * street...)". Over-covering a form box costs a reader nothing they need.
 */
/** The x position of a character of a line's text, interpolated inside its word. */
function xAt(line: PageLine, index: number): number {
    const { ranges } = lineText(line.words);
    const i = ranges.findIndex(([, stop]) => index <= stop);
    if (i < 0) return line.words.at(-1)!.box[2];
    const [start, stop] = ranges[i], [left, , right] = line.words[i].box;
    return left + (right - left) * Math.max(0, Math.min(1, (index - start) / Math.max(1, stop - start)));
}

export function fieldBoxes(line: PageLine, page: SourcePage, pageNumber: number): RedactionBox[] {
    const { text } = lineText(line.words);
    const label = FIELD_LABELS.find(rule => rule.pattern.test(text));
    if (!label) return [];
    const match = label.pattern.exec(text)!;
    const opening = match.index <= 12 && text.length <= OPENING_LABEL_LENGTH;
    // "Struck Jazz - Elizabeth Fixsen   SSN: 55...": a tax number's label in the
    // middle of a filled-in line, followed by a colon or digits, is still a
    // field. Its box starts where the label ends, not where the line does.
    const end = match.index + match[0].length;
    const inline = label.kind === "financial identifier" && /^\s*[:#.]?\s*[\dOoIlSsBZ]|^\s*[:#]/.test(text.slice(end));
    if (!opening && !inline && text.length > match[0].length + LABEL_SLACK) return [];
    const [x0, y0, lineEnd, y1] = union(line.words.map(w => w.box));
    const x1 = inline ? xAt(line, end) : lineEnd;
    const height = Math.max(6, y1 - y0);
    const right = page.width - 4;
    // Mask any value sharing the label's line ("Password: x") so the reason never quotes it.
    const quoted = `the printed label “${maskedLine(text, findSensitiveSpans(text))}”`;
    // The lower box starts inside the label's own line: handwriting is taller
    // than print and sits on the label's baseline as often as under it.
    return [
        { page: pageNumber, kind: label.kind, method: "field", box: pad([x1, y0 - height * label.above, right, y1 + height], page),
            reason: `Form field beside ${quoted}: the rest of its row to the page edge${label.above > 1 ? `, reaching ${label.above} lines up because people write this value wherever there is room` : ""}. Covered whether or not the handwriting was readable.` },
        { page: pageNumber, kind: label.kind, method: "field", box: pad([x0, y0 + height * 0.5, right, y1 + height * 1.8], page),
            reason: `Form field below ${quoted}: the line where its answer is written. Covered whether or not the handwriting was readable.` },
    ];
}

/**
 * Forms that are nothing but one person's tax or banking details. Boxing their
 * fields one by one leaves a city and ZIP here, half an SSN there, so the whole
 * page is withheld and marked as such; the stored transcription keeps whatever
 * on it was not personal.
 */
const PERSONAL_FORM = /request\s*for\s*taxpayer\s*identification|\bform\s*w-?\s?9\b|\bw-?4\b.*withholding|employee['’]?s\s*withholding|direct\s*deposit\s*(?:authorization|enrollment)/i;

/** The sentence a withheld page carries, named for the form it was. */
export function formNotice(heading: string): string {
    if (/taxpayer|w-?\s?9/i.test(heading)) return "This is a W-9.";
    if (/w-?4|withholding/i.test(heading)) return "This is a W-4.";
    if (/direct\s*deposit/i.test(heading)) return "This is a direct deposit form.";
    return "This page is withheld.";
}

export function isPersonalFormPage(page: SourcePage): boolean {
    return personalFormHeading(page) !== null;
}

function personalFormHeading(page: SourcePage): string | null {
    for (const line of page.lines) {
        const match = PERSONAL_FORM.exec(lineText(line.words).text);
        if (match) return match[0];
    }
    return null;
}

/** Every automatic box on every page, plus the manual ones. */
/**
 * A spreadsheet laid out as a page: numbers in the column under a "Phone"
 * heading, which a spreadsheet keeps as ten bare digits ("4105550123") that
 * the running-text rule leaves alone. The nearest heading above a number, in
 * the same column, decides; a directory of businesses keeps its numbers.
 */
/**
 * The stored text of a spreadsheet whose table has a phone column: a cell
 * that is nothing but a blacked-out phone number.
 */
export const isPhoneSheet = (content: string) => /\|\s*\[REDACTED: phone number\]\s*(?=\|)/.test(content);

export type PlanOptions = {
    /** The document's text lists phone numbers in a table column (isPhoneSheet). */
    phoneSheet?: boolean;
    /** A résumé or CV (isPersonalDocument): every address and phone is the person's own. */
    personal?: boolean;
};

function phoneColumnWords(page: SourcePage, options: PlanOptions = {}): { word: PageWord; header: string }[] {
    // A PDF's text layer often runs a whole header row into one line: split it
    // into cells wherever the gap between words is wider than a space.
    const cells = page.lines.flatMap(line => {
        const out: PageWord[][] = [];
        for (const word of line.words) {
            const last = out.at(-1)?.at(-1);
            const height = word.box[3] - word.box[1];
            if (last && word.box[0] - last.box[2] <= Math.max(3, height * 0.6)) out.at(-1)!.push(word);
            else out.push([word]);
        }
        return out;
    });
    const cellText = (words: PageWord[]) => lineText(words).text;
    const headings = cells.flatMap(words => {
        const text = cellText(words);
        if (!isPhoneHeading(text)) return [];
        const box = union(words.map(w => w.box));
        const row = cells.filter(other => { const b = union(other.map(w => w.box)); return Math.abs(b[1] - box[1]) < (box[3] - box[1]); });
        return row.some(other => isBusinessColumn(cellText(other))) ? [] : [{ box, text }];
    });
    const directory = cells.some(words => isBusinessColumn(cellText(words)));
    // Bare digits only: a formatted number on a page is judged by its context.
    const bare = page.lines.flatMap(line => line.words.filter(word => /^\+?\d{10,11}(?:\.0)?$/.test(word.text) && isPrivatePhoneCell(word.text)));
    // A spreadsheet often clips its heading ("What is your best contact p"):
    // three or more phone-shaped numbers (area code and exchange 2-9) stacked
    // in one column are a phone column too.
    const nanp = (word: PageWord) => /^1?[2-9]\d{2}[2-9]\d{6}$/.test(word.text.replace(/\.0$/, "").replace(/^\+/, ""));
    // Upright words only, each on its own row: sideways OCR reads one margin
    // line several times over, which is not a column.
    const upright = bare.filter(word => nanp(word) && word.box[2] - word.box[0] > word.box[3] - word.box[1]);
    const stacked = new Set(upright.filter(word => {
        const column = upright.filter(other => Math.abs(other.box[0] - word.box[0]) <= 8).sort((a, b) => a.box[1] - b.box[1]);
        const rows = column.filter((other, i) => i === 0 || other.box[1] >= column[i - 1].box[3] - 1);
        return rows.length >= 3;
    }));
    return bare.flatMap(word => {
        const [x0, y0, x1] = word.box;
        const above = headings.filter(h => h.box[3] <= y0 + 1 && (Math.abs(h.box[0] - x0) <= 8 || (h.box[0] < x1 && x0 < h.box[2])))
            .sort((a, b) => b.box[3] - a.box[3]);
        if (above.length) return [{ word, header: above[0].text }];
        // A header row run together into one line ("...email? What is your best
        // contact phone number?What are..."): read the few words that start
        // where this column starts, in the nearest line above.
        if (!directory) {
            const header = page.lines
                .filter(line => union(line.words.map(w => w.box))[3] <= y0 + 1)
                .map(line => ({ line, start: line.words.findIndex(w => Math.abs(w.box[0] - x0) <= 6) }))
                // Skip the rows of values above this one; the heading has no digits.
                .filter(({ line, start }) => start >= 0 && !/\d/.test(line.words[start].text))
                .sort((a, b) => b.line.words[b.start].box[3] - a.line.words[a.start].box[3])[0];
            const text = header ? lineText(header.line.words.slice(header.start, header.start + 7)).text : "";
            if (header && isPhoneHeading(text.slice(0, 60)) && !/\d/.test(text)) return [{ word, header: text }];
        }
        if (stacked.has(word) && !directory) return [{ word, header: "a column of phone-shaped numbers" }];
        // Excel right-aligns numbers and clips headings ("What is your best
        // contact p"), so neither may line up. When the stored text already
        // shows a phone column, every phone-shaped bare number in the sheet is one.
        return options.phoneSheet && !directory && upright.includes(word) ? [{ word, header: "a phone column (the stored text blacks out a whole phone cell)" }] : [];
    });
}

function phoneColumnBoxes(page: SourcePage, pageNumber: number, options: PlanOptions): RedactionBox[] {
    return phoneColumnWords(page, options).map(({ word, header }) => ({ page: pageNumber, box: pad(word.box, page), kind: "phone number" as const, method: "value" as const,
        reason: `A number in the table column headed “${header.replace(/\d/g, "#")}”. Covered: a spreadsheet's phone column, which stores numbers as bare digits.` }));
}

export function planRedactions(pages: SourcePage[], manual?: ManualRedactions, options: PlanOptions = {}): RedactionBox[] {
    const boxes: RedactionBox[] = [];
    const withheld = new Set((manual?.pages ?? []).map(number => number - 1));
    pages.forEach((page, index) => {
        if (withheld.has(index)) return;
        const heading = personalFormHeading(page);
        if (heading) {
            withheld.add(index);
            boxes.push({ page: index, box: [0, 0, page.width, page.height], kind: "withheld page", method: "field", notice: formNotice(heading),
                reason: `Whole page withheld: it reads “${heading.replace(/\s+/g, " ")}”, a form that is one person's tax or banking details (name, address, taxpayer number, signature). Boxing its fields one by one left pieces showing.` });
            return;
        }
        for (const line of page.lines) boxes.push(...valueBoxes(line, page, index, { personal: options.personal }), ...fieldBoxes(line, page, index));
        boxes.push(...phoneColumnBoxes(page, index, options));
    });
    for (const number of manual?.pages ?? []) {
        const page = pages[number - 1];
        if (page) boxes.push({ page: number - 1, box: [0, 0, page.width, page.height], kind: "withheld page", method: "manual",
            notice: manual?.pageNotice ?? "This page is withheld.",
            reason: `Whole page withheld by hand (config/source-redactions.json)${manual?.note ? `: ${manual.note}` : "."}` });
    }
    for (const item of manual?.boxes ?? []) {
        const page = pages[item.page - 1];
        if (!page) continue;
        const [x0, y0, x1, y1] = item.box;
        boxes.push({ page: item.page - 1, box: [x0 * page.width, y0 * page.height, x1 * page.width, y1 * page.height], kind: "form field", method: "manual",
            reason: `Placed by hand after review (config/source-redactions.json): ${item.note ?? manual?.note ?? "no note given"}` });
    }
    return boxes;
}

/**
 * What a re-read of the finished copy still finds: must be empty before it is
 * stored. Read with the same neighbouring lines the boxes were placed with, so
 * a business number the plan rightly left alone is not reported as missed.
 */
export function remainingFindings(pages: SourcePage[], sources: SourcePage[] = [], options: PlanOptions = {}): { page: number; kind: RedactionKind }[] {
    // A phone number the plan read on the original page and judged public (an
    // office signature, a fax, a vendor's line) is not a miss just because the
    // second OCR lost the words around it or misread a digit of it. Excused only
    // at the same place on the same page, same length, at most two digits off.
    // Tax and ID numbers are never excused.
    const digits = (text: string) => text.replace(/[Il|]/g, "1").replace(/[Oo]/g, "0").replace(/\D/g, "");
    const near = (a: Box, b: Box) => a[0] < b[2] && b[0] < a[2] && Math.abs((a[1] + a[3]) / 2 - (b[1] + b[3]) / 2) <= Math.max(a[3] - a[1], b[3] - b[1]) * 1.5;
    const judgedPublic = sources.map(page => page.lines.flatMap(line => {
        const text = lineText(line.words).text;
        const found = spansInContext(line, page, { personal: options.personal });
        const box = union(line.words.map(w => w.box));
        return [...text.matchAll(/\d[\dIlOo|().\s-]{6,}\d/g)].map(m => digits(m[0]))
            .filter(number => number.length >= 7 && !found.some(span => digits(text.slice(span.start, span.end)).includes(number)))
            .map(number => ({ number, box }));
    }));
    const sameNumber = (a: string, b: string) => a.length === b.length && [...a].filter((d, i) => d !== b[i]).length <= 2;
    return pages.flatMap((page, index) => page.lines.flatMap(line => {
        const text = lineText(line.words).text;
        const box = union(line.words.map(w => w.box));
        return spansInContext(line, page, { personal: options.personal })
            .filter(span => {
                const number = digits(text.slice(span.start, span.end));
                return span.kind !== "phone number" || number.length < 7
                    || !(judgedPublic[index] ?? []).some(known => near(known.box, box) && (known.number.includes(number) || sameNumber(known.number.slice(-number.length), number)));
            })
            .map(span => ({ page: index + 1, kind: span.kind }));
    }).concat(phoneColumnWords(page, options).map(() => ({ page: index + 1, kind: "phone number" as const }))));
}
