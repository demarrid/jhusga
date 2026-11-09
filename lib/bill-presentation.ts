import { runsText, type Block, type InlineRun } from "./render";

/** Split display runs without duplicating citation or navigation targets. */
export function sliceRuns(runs: InlineRun[], start: number, end: number): InlineRun[] {
    let offset = 0;
    return runs.flatMap(run => {
        const from = Math.max(0, start - offset);
        const to = Math.min(run.text.length, end - offset);
        const position = offset;
        offset += run.text.length;
        if (run.navigationId) return position >= start && position < end ? [run] : [];
        return to > from ? [{ ...run, text: run.text.slice(from, to), anchor: run.anchor && from === 0 }] : [];
    });
}

export type BillHeaderLine = {
    kind: "institution" | "number" | "purpose" | "title" | "credit" | "reading";
    runs: InlineRun[];
    sectionId?: string;
};

const SECTION = /^\s*SECTION\s+(?:\d+|[IVXLC]+)[.\s:–—-]+[^\n]+/i;
const BILL_PURPOSE = /^(?:A (?:Bill|Resolution)\b|An?\s+(?:SGA\s+)?Funding Bill\b|(?:An?\s+)?Act\s+to\b)/i;

export function presentBill(blocks: Block[]): { header: BillHeaderLine[]; blocks: Block[] } {
    blocks = presentPagedBill(blocks);
    const opening = blocks.slice(0, 16).flatMap(block => "runs" in block ? [runsText(block.runs)] : []).join("\n");
    if (!/Student Government Association/i.test(opening) || !opening.split("\n").some(line => BILL_PURPOSE.test(line.trim()))) {
        return { header: [], blocks };
    }
    // Word exports can put the complete title page and first section in one
    // paragraph. Split at section lines without changing source runs or anchors.
    blocks = blocks.flatMap((block): Block[] => {
        if (block.kind !== "paragraph") return [block];
        const text = runsText(block.runs);
        const starts = [0, ...Array.from(text.matchAll(/(?<=\n)(?=SECTION\s+(?:\d+|[IVXLC]+)[.\s:])/gi), match => match.index!), text.length];
        return starts.slice(0, -1).map((start, index) => ({ ...block,
            runs: sliceRuns(block.runs, start, starts[index + 1]),
            sectionId: index === 0 ? block.sectionId : undefined,
        }));
    });
    const header: BillHeaderLine[] = [];
    let consumed = 0;
    let purposeSeen = false;
    let numberSeen = false;
    for (const block of blocks) {
        if (!(block.kind === "paragraph" || block.kind === "heading") || SECTION.test(runsText(block.runs))) break;
        const text = runsText(block.runs);
        if (consumed >= 16) break;
        const starts = [0, ...Array.from(text.matchAll(/\n|(?=(?:Introduced by:|Sponsored by:|Presented for))/gi), match => match.index!).filter(at => at > 0), text.length];
        for (let index = 0; index < starts.length - 1; index++) {
            const start = starts[index], end = starts[index + 1];
            const value = text.slice(start, end).trim();
            if (!value) continue;
            const kind = /^(Introduced|Sponsored) by:/i.test(value) ? "credit"
                : /^Presented for/i.test(value) ? "reading"
                : BILL_PURPOSE.test(value) ? "purpose"
                : /^\{?\s*S[. -]*(?:Bill|B|Resolution)[.\s]/i.test(value) ? "number"
                : header.at(-1)?.kind === "credit" ? "credit"
                : header.at(-1)?.kind === "reading" ? "reading"
                : purposeSeen ? "title" : numberSeen ? "purpose" : "institution";
            if (kind === "purpose") purposeSeen = true;
            if (kind === "number") numberSeen = true;
            header.push({ kind, runs: sliceRuns(block.runs, start, end), ...(index === 0 ? { sectionId: block.sectionId } : {}) });
        }
        consumed++;
    }
    // Only recognize a complete title block bounded by the bill's first section.
    const firstSection = blocks[consumed];
    if (!header.some(line => line.kind === "purpose") || !firstSection ||
        !(firstSection.kind === "paragraph" || firstSection.kind === "heading") ||
        !SECTION.test(runsText(firstSection.runs))) return { header: [], blocks };
    const normalize = (items: Block[]): Block[] => items.flatMap((block): Block[] => {
        if (block.kind === "paragraph") {
            const text = runsText(block.runs);
            const section = SECTION.exec(text);
            if (section && section[0].length <= 140) {
                const end = section[0].length;
                return [{ kind: "heading", level: 2, runs: sliceRuns(block.runs, 0, end), sectionId: block.sectionId },
                    ...(text.slice(end).trim() ? [{ kind: "paragraph" as const, runs: sliceRuns(block.runs, end, text.length) }] : [])];
            }
        }
        if (block.kind === "quote") return [{ ...block, blocks: normalize(block.blocks) }];
        if (block.kind === "list") return [{ ...block, agenda: false, items: block.items.map(item => {
            const [first, ...rest] = item.blocks;
            if (block.agenda && first?.kind === "heading" && first.marker) {
                return { ...item, runs: first.runs, sectionId: first.sectionId, blocks: normalize(rest) };
            }
            return { ...item, blocks: normalize(item.blocks) };
        }) }];
        return [block];
    });
    return { header, blocks: normalize(blocks.slice(consumed)) };
}

/** Signature rules can start a paragraph or trail the previous signer's role. */
export function signatureCards(cards: { runs: InlineRun[]; sectionId?: string }[]): { runs: InlineRun[] }[] {
    const runs = cards.flatMap((card, index): InlineRun[] => [
        ...(index ? [{ text: "\n", bold: false, italic: false, strike: false, href: null, annotationId: null, anchor: false }] : []),
        ...(card.sectionId ? [{ text: "", navigationId: card.sectionId, bold: false, italic: false, strike: false, href: null, annotationId: null, anchor: false }] : []),
        ...card.runs,
    ]);
    const text = runsText(runs);
    const starts = [0, ...Array.from(text.matchAll(/^\s*_{3,}/gm), match => match.index!).filter(at => at > 0), text.length];
    return starts.slice(0, -1).map((start, index) => ({ runs: sliceRuns(runs, start, starts[index + 1]) }));
}

export function signatureIdentity(runs: InlineRun[]): { rule: InlineRun[]; name: InlineRun[]; separator: InlineRun[]; position: InlineRun[] } {
    const text = runsText(runs);
    const ruleEnd = /^\s*_{3,}\s*\n/.exec(text)?.[0].length ?? 0;
    const identity = text.slice(ruleEnd);
    // A comma separates the name and office in the one-line ceremony template.
    // Newline-formatted names (including suffixes) keep their commas intact.
    const newline = identity.trimEnd().indexOf("\n");
    const separator = newline >= 0 ? newline : identity.indexOf(",");
    const nameEnd = separator >= 0 ? ruleEnd + separator : text.length;
    return { rule: sliceRuns(runs, 0, ruleEnd), name: sliceRuns(runs, ruleEnd, nameEnd),
        separator: sliceRuns(runs, nameEnd, Math.min(nameEnd + 1, text.length)),
        position: sliceRuns(runs, Math.min(nameEnd + 1, text.length), text.length) };
}

/** PDF page furniture identifies hard-wrapped legislative exports, not Docs prose. */
function presentPagedBill(blocks: Block[]): Block[] {
    const furniture = /^JHU STUDENT GOVERNMENT ASSOCIATION.*FUNDING BILL$/i;
    const text = blocks.flatMap(block => "runs" in block ? [runsText(block.runs)] : []).join("\n");
    if (text.split("\n").filter(line => furniture.test(line.trim())).length < 2 ||
        !/^PAGE \d+$/im.test(text) || !/^SECTION 1[. ]/im.test(text)) return blocks;
    // Every slice retains its citation marks. Existing outline targets travel
    // with the same text even when a false PDF paragraph is joined to another.
    const lines: InlineRun[][] = [];
    for (const block of blocks) {
        if (block.kind === "rule") {
            lines.push([{ text: "__________________________________", bold: false, italic: false, strike: false, href: null, annotationId: null, anchor: false }]);
            continue;
        }
        if (!(block.kind === "paragraph" || block.kind === "heading")) return blocks;
        const value = runsText(block.runs);
        let start = 0;
        for (const part of value.split("\n")) {
            const runs = sliceRuns(block.runs, start, start + part.length);
            if (start === 0 && block.sectionId) runs.unshift({ text: "", navigationId: block.sectionId,
                bold: false, italic: false, strike: false, href: null, annotationId: null, anchor: false });
            lines.push(runs);
            start += part.length + 1;
        }
    }
    const result: Block[] = [];
    let pending: InlineRun[] = [];
    let body = false;
    let signatures = false;
    let funding = false;
    let table: Extract<Block, { kind: "table" }> | null = null;
    let navigation: InlineRun[] = [];
    const plain = (value: string): InlineRun[] => [{ text: value, bold: false, italic: false, strike: false, href: null, annotationId: null, anchor: false }];
    const append = (runs: InlineRun[], separator = " ") => {
        if (pending.length) pending.push(...plain(separator));
        pending.push(...runs);
    };
    const flush = () => {
        if (pending.length) result.push({ kind: "paragraph", runs: pending });
        pending = [];
    };
    for (const runs of lines) {
        const value = runsText(runs).trim();
        if (!value || furniture.test(value) || /^PAGE \d+$/i.test(value)) {
            navigation.push(...runs.filter(run => run.navigationId));
            continue;
        }
        const current = [...navigation, ...runs];
        navigation = [];
        if (SECTION.test(value)) {
            flush(); body = true; funding = false; table = null;
            result.push({ kind: "paragraph", runs: current });
            continue;
        }
        if (!body) {
            if (/^Presented for/i.test(value)) { flush(); append(current); }
            else if (/^Presented for/i.test(runsText(pending))) {
                // PDF superscripts are exported on their own line: 15 / TH.
                append(current, /^(?:ST|ND|RD|TH)$/i.test(value) ? "" : " ");
            } else { flush(); append(current); }
            continue;
        }
        if (/^Item Vendor$/i.test(value)) {
            flush(); funding = true;
            table = { kind: "table", header: { cells: [sliceRuns(current, 0, 5), sliceRuns(current, 5, runsText(current).length), [], [], []] }, rows: [] };
            result.push(table);
            continue;
        }
        if (funding && /^(?:\(Link\)|Price|\(\$\/item\)|Quantity Total \(\$\))$/.test(value)) {
            if (table?.header) {
                const cells = table.header.cells;
                if (value === "(Link)") cells[1].push(...plain(" "), ...current);
                else if (value === "Price") cells[2].push(...current);
                else if (value === "($/item)") cells[2].push(...plain(" "), ...current);
                else {
                    cells[3].push(...sliceRuns(current, 0, 9));
                    cells[4].push(...sliceRuns(current, 9, runsText(current).length));
                }
            }
            continue;
        }
        if (/^TOTAL\s+\$/i.test(value)) { flush(); funding = false; table = null; result.push({ kind: "paragraph", runs: current }); continue; }
        if (funding && table) {
            append(current);
            const row = runsText(pending);
            const numbers = /\$(?:[\d,.]+)(?:\/\w+)?(?: \(on average\))?\s+\d+\s+\$[\d,.]+$/.exec(row);
            if (numbers) {
                const priceStart = numbers.index;
                const values = /^(.*?)\s+(\d+)\s+(\$[\d,.]+)$/.exec(numbers[0])!;
                const quantityStart = priceStart + values[1].length + 1;
                const totalStart = quantityStart + values[2].length + 1;
                const vendorStart = row.indexOf("[Link]");
                const cells = [sliceRuns(pending, 0, vendorStart < 0 ? priceStart : vendorStart),
                    vendorStart < 0 ? [] : sliceRuns(pending, vendorStart, priceStart),
                    sliceRuns(pending, priceStart, quantityStart), sliceRuns(pending, quantityStart, totalStart), sliceRuns(pending, totalStart, row.length)];
                table.rows.push({ cells }); pending = [];
            }
            continue;
        }
        if (/^Signatures? of /i.test(value)) { flush(); signatures = true; result.push({ kind: "paragraph", runs: current }); continue; }
        if (signatures) {
            if (/^_{3,}$/.test(value)) flush();
            append(current, "\n");
            continue;
        }
        if (/^\([a-z]\)\s|^(?:Findings|Purpose|Additional Information):|^THE BILL IS HEREBY|^UPON PASSAGE/i.test(value)) flush();
        append(current);
    }
    flush();
    if (navigation.length) result.push({ kind: "paragraph", runs: navigation });
    return result;
}
