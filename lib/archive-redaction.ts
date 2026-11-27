/**
 * Personal-data redaction for stored document text and for source copies.
 *
 * One detector serves both: `redactPersonalData` rewrites the text the site
 * stores and renders, and `findSensitiveSpans` hands the same character ranges
 * to scripts/source-redact.ts, which turns them into black boxes on the PDF.
 *
 * What is removed: Social Security and taxpayer numbers (a W-9's EIN too:
 * there it is the payee's TIN, often a sole proprietor's), bank account and
 * routing numbers, passwords, dates of birth, driver's licence numbers,
 * personal phone numbers, and home or mailing addresses. What is kept: a
 * policy that *mentions* Social Security numbers, blank form labels, and the
 * published numbers and addresses of University offices, which are public and
 * are how a reader reaches the office the document is about.
 *
 * Every rule needs an actual value (a digit) after its label, so running the
 * filter over its own output changes nothing.
 */

export type RedactionKind =
    | "personal identifier"
    | "financial identifier"
    | "credential"
    | "phone number"
    | "home address"
    | "date of birth";

/** `rule` says, in words, why the range was removed; it never quotes the value. */
export type SensitiveSpan = { start: number; end: number; kind: RedactionKind; rule: string };

const placeholder = (kind: RedactionKind) => `[REDACTED: ${kind}]`;
const PLACEHOLDER = /\[REDACTED: [a-z ]+\]/;

/** Bare SSN shape: 123-45-6789, with any dash or a space as the separator. */
const BARE_SSN = /\b\d{3}[-‐-— ]\d{2}[-‐-— ]\d{4}\b/g;

/** "Label:" then a value to the end of the field. */
type LabelRule = {
    label: RegExp;
    kind: RedactionKind;
    /** A password is secret whatever it is made of; everything else is a number. */
    anyValue?: boolean;
    /** Remove only this part of the value, rather than the rest of the field. */
    value?: RegExp;
    keep?: (value: string, line: string) => boolean;
};

/** A University or office address, or no street address at all (an email, a URL). */
export const isOfficeAddress = (value: string) =>
    /@|https?:|www\./i.test(value) || (INSTITUTIONAL_ADDRESS.test(value) && !RESIDENCE_MARKER.test(value));
const keepOfficeAddress = isOfficeAddress;

const COLON = String.raw`\s*(?:\*\*|\*|_)?\s*(?:\([^)\n]*\))?\s*(?:\*\*|\*|_)?\s*[:=]\s*(?:\*\*|\*|_)?\s*`;

/**
 * Addresses of University buildings, and the campus offices that print them on
 * every form. "3400 N. Charles Street, Mattin Center Suite 210" is the Office
 * of Student Activities, not a student's home.
 */
const INSTITUTIONAL_ADDRESS =
    /\b(?:mattin|levering|gilman|homewood|hopkins|university|universities|suite|hall|cent(?:er|re)|office|library|building|campus|charles village|san martin|wolfe st)\b|\bn(?:orth|\.)?\s*charles\s*st(?:reet|\.)?\b/i;
/** Something that marks a private residence even on a campus street. */
const RESIDENCE_MARKER = /\b(?:apt|apartment|unit)\b\.?|#\s*\d/i;

const LABEL_RULES: LabelRule[] = [
    { label: new RegExp(String.raw`\b(?:email |e-mail |instagram |twitter |account )?password` + String.raw`\s*[:=]\s*(?:\*\*)?`, "gi"), kind: "credential", anyValue: true },
    {
        label: new RegExp(String.raw`(?:\bSSN|\bSS#|\bsocial security (?:number|no\.?|#)|\btaxpayer identification (?:number|no\.?)|\bTIN|\bEIN|\bemployer identification (?:number|no\.?)|\bbank account (?:number|no\.?|#)|\brouting (?:number|no\.?|#)|\bABA (?:number|no\.?|#))` + COLON, "gi"),
        kind: "financial identifier",
    },
    { label: new RegExp(String.raw`\b(?:date of birth|birth ?date|DOB)` + COLON, "gi"), kind: "date of birth" },
    { label: new RegExp(String.raw`\bdriver['’]?s? licen[cs]e(?: (?:number|no\.?|#))?` + COLON, "gi"), kind: "personal identifier" },
    {
        // The labels a form uses for where someone lives. W-9 line 5 is
        // "Address (number, street, and apt. or suite no.)", line 6 the city.
        label: new RegExp(String.raw`(?:\b(?:home|mailing|permanent|local|residential|residence|billing|current|parents?['’]?|street) address|\baddress \(number, street[^)\n]*\)|\bcity,? state,? and zip(?: code)?|\bhome address is required[^:\n]*)` + COLON, "gi"),
        kind: "home address",
        keep: keepOfficeAddress,
    },
    {
        // A bare "Address:" is a person's address on a form and an office's
        // address on a letterhead; only the first is removed.
        label: new RegExp(String.raw`(?<![\w-]|mail |web |ip |url |mac |return |forwarding )\baddress` + COLON, "gi"),
        kind: "home address",
        keep: keepOfficeAddress,
    },
    {
        label: new RegExp(String.raw`\b(?:cell(?:ular)?|mobile|home|personal|parent['’]?s?|emergency(?: contact)?)(?: phone)?(?: (?:number|no\.?|#))?` + String.raw`\s*(?:\*\*)?\s*:\s*(?:\*\*)?\s*`, "gi"),
        kind: "phone number",
        // The number itself, including the ten bare digits PHONE leaves alone.
        value: /(?:\+?1[-.\s])?\(?\d{3}\)?[-.\s‐-—]?\d{3}[-.\s‐-—]?\d{4}\b/,
    },
];

/** SSN or TIN digits that follow their label without a colon. */
const LOOSE_IDENTIFIER = /\b(?:SSN|SS#|social security(?: number| no\.?| #)?|TIN|EIN|taxpayer identification number|employer identification number)\b[^\d\n]{0,60}?(\d[\d \-‐-—]{7,13}\d)/gi;

/**
 * US numbers with separators: (410) 555-1234, 410-555-1234, 410.555.1234,
 * +1 410 555 1234. Ten bare digits are left alone; in these documents they are
 * more often an account or budget code than a phone.
 */
const PHONE = /(?<![\d\w-])(?:\+?1[-.\s])?(?:\(([2-9]\d{2})\)\s?|([2-9]\d{2})[-.\s‐-—])([2-9]\d{2})[-.\s‐-—](\d{4})(?![\d-])/g;

/** Exchanges the University publishes for its offices, and toll-free lines. */
const INSTITUTIONAL_EXCHANGES = new Set(["410-516", "443-997", "410-955", "410-614", "410-502", "410-735", "443-287", "667-208", "410-338", "410-235"]);
const TOLL_FREE = new Set(["800", "833", "844", "855", "866", "877", "888"]);
const BUSINESS_CONTEXT = /\b(?:inc\.?|llc|ltd|company|co\.|restaurant|hotel|cater(?:ing|er)|stadium|arena|ballpark|yards|theat(?:re|er)|museum|church|synagogue|consulting|tickets|box office|reservations|rentals?|showroom|invoice|remit to)\b|www\.|https?:\/\/|\binfo@|\bfax\b|fax\s*[:#.]/i;
/** Text naming a business, venue or website, so an address or number in it is the business's. */
export const isBusinessContext = (text: string) => BUSINESS_CONTEXT.test(text);
// "Personal" only next to a number: "Personal Automobiles" is a heading, not a phone.
const PERSONAL_PHONE_CONTEXT = /\b(?:cell|mobile|home phone|personal (?:phone|cell|number|line|contact)|my (?:number|phone)|text me|call me)\b/i;
const OFFICE_PHONE_CONTEXT = /\b(?:fax|facsimile|office|department|dept|university|hopkins|cent(?:er|re)|suite|ext\.?|extension|hotline|helpline|main line|services|police|security|switchboard|reservations|box office|tickets|restaurant|hotel|cater(?:ing|er)|inc\.?|llc|company|co\.|zoom|dial|meeting id|for (?:more )?information|for details|directions|rentals?|showroom|invoice|remit to)\b|www\.|https?:\/\/|\binfo@|fax\s*[:#.]/i;

/** A street address carrying an apartment or unit, anywhere in the text. */
const RESIDENTIAL_STREET = new RegExp(
    String.raw`\b\d{1,6}[ \t]+(?:[NSEW]\.?[ \t]+)?(?:[A-Z][\w'.-]*[ \t]+){1,4}(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Drive|Dr|Lane|Ln|Court|Ct|Way|Place|Pl|Terrace|Ter|Circle|Cir|Parkway|Pkwy)\.?,?[ \t]*(?:Apt\.?|Apartment|Unit|#)[ \t]*#?[\w-]+(?:,?[ \t]+[A-Z][A-Za-z .]+,[ \t]*[A-Z]{2}\.?[ \t]*\d{5}(?:-\d{4})?)?`,
    "gi",
);

function lineBounds(text: string, index: number): [number, number] {
    const start = text.lastIndexOf("\n", index - 1) + 1;
    const end = text.indexOf("\n", index);
    return [start, end < 0 ? text.length : end];
}

/**
 * Where a labelled value ends: the end of the line, or the next table cell, or
 * the next label on a form line that holds two ("City: ... Phone: ...").
 */
function valueRange(text: string, from: number, lineEnd: number): [number, number] {
    // "| Billing Address: | 3400 N. Charles St. |": the value is the next cell.
    from += /^\|\s*/.exec(text.slice(from, lineEnd))?.[0].length ?? 0;
    const rest = text.slice(from, lineEnd);
    const stop = rest.search(/\s\|\s|\|\s*$|\s{3,}(?=\*{0,2}[A-Z][\w ]{1,30}\*{0,2}:)/);
    let end = from + (stop < 0 ? rest.length : stop);
    while (end > from && /[\s*_]/.test(text[end - 1])) end--;
    return [from, end];
}

/** The line, and the two non-empty lines either side: a venue's block in a listing. */
function nearbyLines(text: string, index: number): string {
    const [start, end] = lineBounds(text, index);
    const before = text.slice(Math.max(0, start - 600), start).split("\n").filter(line => line.trim()).slice(-2);
    const after = text.slice(end + 1, end + 600).split("\n").filter(line => line.trim()).slice(0, 2);
    return [...before, text.slice(start, end), ...after].join("\n");
}

function institutionalPhone(area: string, exchange: string, line: string, nearby: string): boolean {
    if (PERSONAL_PHONE_CONTEXT.test(line)) return false;
    return INSTITUTIONAL_EXCHANGES.has(`${area}-${exchange}`) || TOLL_FREE.has(area) || OFFICE_PHONE_CONTEXT.test(nearby);
}

/**
 * Every range of `text` that should not be published, sorted and without
 * overlap. Ranges never include the label, so a form still says what was there.
 */
export function findSensitiveSpans(text: string): SensitiveSpan[] {
    const spans: SensitiveSpan[] = [];
    const add = (start: number, end: number, kind: RedactionKind, rule: string, anyValue = false) => {
        if (end <= start) return;
        // A value that is already a placeholder, or only blanks, is not one.
        const value = text.slice(start, end).replace(/\[REDACTED: [a-z ]+\]/g, "");
        if (anyValue ? !value.trim() : !/\d/.test(value)) return;
        spans.push({ start, end, kind, rule });
    };
    // A label is printed form text; only digits in it (a line number) are masked.
    const labelled = (label: string) => `the value after the label “${label.replace(/[*_:=]+/g, " ").replace(/\d/g, "#").replace(/\s+/g, " ").trim()}”`;

    for (const rule of LABEL_RULES) {
        for (const match of text.matchAll(rule.label)) {
            const [, lineEnd] = lineBounds(text, match.index);
            const [from, end] = valueRange(text, match.index + match[0].length, lineEnd);
            const value = text.slice(from, end);
            if (rule.keep?.(value, text.slice(...lineBounds(text, match.index)))) continue;
            if (rule.value) {
                const part = rule.value.exec(value);
                if (part) add(from + part.index, from + part.index + part[0].length, rule.kind, `the number after the label “${match[0].replace(/[*_:]+/g, " ").trim()}”`);
                continue;
            }
            add(from, end, rule.kind, labelled(match[0]), rule.anyValue);
        }
    }

    for (const match of text.matchAll(LOOSE_IDENTIFIER)) {
        const start = match.index + match[0].length - match[1].length;
        add(start, start + match[1].length, "financial identifier", "a nine-digit number following an SSN, TIN or EIN label");
    }
    for (const match of text.matchAll(BARE_SSN)) add(match.index, match.index + match[0].length, "personal identifier", "a number in Social Security shape (###-##-####)");
    for (const match of text.matchAll(RESIDENTIAL_STREET)) {
        // "30 W. Pennsylvania Ave. #1" under a shop's name is the shop.
        if (BUSINESS_CONTEXT.test(nearbyLines(text, match.index))) continue;
        add(match.index, match.index + match[0].length, "home address", "a street address with an apartment or unit number, not under a business name");
    }
    for (const match of text.matchAll(PHONE)) {
        const area = match[1] ?? match[2];
        const line = text.slice(...lineBounds(text, match.index));
        if (institutionalPhone(area, match[3], line, nearbyLines(text, match.index))) continue;
        add(match.index, match.index + match[0].length, "phone number", PERSONAL_PHONE_CONTEXT.test(line)
            ? "a phone number on a line that calls it a cell, mobile or personal number"
            : "a phone number with no University exchange, office, business, fax or toll-free context around it");
    }

    // Widest first at each start, then drop anything inside an earlier range.
    spans.sort((a, b) => a.start - b.start || b.end - a.end);
    const merged: SensitiveSpan[] = [];
    for (const span of spans) {
        const last = merged.at(-1);
        if (last && span.start < last.end) {
            last.end = Math.max(last.end, span.end);
            continue;
        }
        merged.push({ ...span });
    }
    return merged;
}

/** The text with every sensitive range replaced by a labelled placeholder. */
export function redactPersonalData(text: string): string {
    const spans = findSensitiveSpans(text);
    if (spans.length === 0) return text;
    let out = "";
    let at = 0;
    for (const span of spans) {
        out += text.slice(at, span.start) + placeholder(span.kind);
        at = span.end;
    }
    return out + text.slice(at);
}

/** The original name, kept for the archive purge scripts that import it. */
export const redactArchiveSecrets = redactPersonalData;

/** Whether stored text carries a placeholder, i.e. its source held personal data. */
export function hasRedactions(text: string): boolean {
    return PLACEHOLDER.test(text);
}

/**
 * Where an offset into `text` lands after redaction. Offsets inside a removed
 * value land at the end of its placeholder. Used to keep image positions
 * pointing at the same paragraph when a Google Doc's export is redacted.
 */
export function redactedOffset(text: string, offset: number): number {
    let shift = 0;
    for (const span of findSensitiveSpans(text)) {
        if (span.start >= offset) break;
        const length = placeholder(span.kind).length;
        if (span.end > offset) return span.start + shift + length;
        shift += length - (span.end - span.start);
    }
    return offset + shift;
}
