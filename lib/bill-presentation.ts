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
const RESOLUTION_CLAUSE = /^\s*(?:Whereas\b|(?:Now[,]?\s+Therefore[,]?\s+)?Be\s+It\s+(?:Further\s+)?(?:Resolved|Enacted)\b)/i;
const BODY_START = new RegExp(SECTION.source + "|" + RESOLUTION_CLAUSE.source, "i");
const BILL_NUMBER = /\{?\s*S[. -]*(?:Bill|B|Resolution|Res)[.\s-]/i;
const matchingText = (text: string) => text.replace(/[\u200b-\u200d\ufeff]/g, "");
const BILL_PURPOSE = /^(?:A (?:Bill|Resolution)\b|An?\s+(?:SGA\s+)?(?:Funding )?Bill\b|An?\s+Act\b|Act\s+to\b)/i;
// "Introduced by:", "Introduced & Composed By:", "Co-Sponsored By:", "Authored by:".
// Older templates also break "Co-" and "Sponsored By:" onto separate lines.
const CREDIT_LABEL = /^(?:(?:Introduced|Composed|Authored|Written)(?:\s*(?:&|and)\s*(?:Composed|Authored|Written|Introduced))?|(?:Co-?\s*)?Sponsored)\s+by\s*:/i;
const CREDIT_SPLIT = /(?=(?:Introduced(?:\s*(?:&|and)\s*\w+)?|(?<!Co-?\s*)Sponsored|Co-?\s*Sponsored)\s+by\s*:)/;

/** An image the title block carried: the letterhead seal, as a rule. */
export type BillHeaderImage = NonNullable<InlineRun["image"]>;

/**
 * The title block of a bill or resolution, lifted out of its body.
 *
 * `images` are the pictures inside that block, which the header lines (text
 * only) would otherwise drop: the letterhead seal, in practice.
 */
export function presentBill(blocks: Block[]): { header: BillHeaderLine[]; images: BillHeaderImage[]; blocks: Block[] } {
    blocks = presentPagedBill(blocks);
    const opening = blocks.slice(0, 16).flatMap(block => "runs" in block ? [runsText(block.runs)] : []).join("\n");
    if (!/Student\s+Government\s+Association/i.test(matchingText(opening)) ||
        !(BILL_NUMBER.test(matchingText(opening)) || opening.split("\n").some(line => BILL_PURPOSE.test(matchingText(line).trim())))) {
        return { header: [], images: [], blocks };
    }
    // Word exports can put the complete title page and first provision in one
    // paragraph. Split at section and resolution-clause lines without changing source runs or anchors.
    blocks = blocks.flatMap((block): Block[] => {
        if (block.kind !== "paragraph") return [block];
        const text = runsText(block.runs);
        const starts = [0, ...Array.from(text.matchAll(/(?<=\n)(?=SECTION\s+(?:\d+|[IVXLC]+)[.\s:]|Whereas\b|(?:Now[,]?\s+Therefore[,]?\s+)?Be\s+It\s+(?:Further\s+)?(?:Resolved|Enacted)\b)/gi), match => match.index!), text.length];
        // Nothing to split: keep the block whole, images included (slicing keeps text only).
        if (starts.length === 2) return [block];
        return starts.slice(0, -1).map((start, index) => ({ ...block,
            runs: sliceRuns(block.runs, start, starts[index + 1]),
            sectionId: index === 0 ? block.sectionId : undefined,
        }));
    });
    const header: BillHeaderLine[] = [];
    const images: BillHeaderImage[] = [];
    const decorations: Block[] = [];
    let consumed = 0;
    let purposeSeen = false;
    let numberSeen = false;
    let carry: { runs: InlineRun[]; sectionId?: string } | null = null;
    for (const block of blocks) {
        // Empty export furniture is not a boundary, and must retain any IDs.
        if (block.kind === "rule" || ((block.kind === "table" || block.kind === "layout") &&
            !block.rows.some(row => row.cells.some(cell => runsText(cell).trim())))) {
            decorations.push(block);
            consumed++;
            continue;
        }
        if (!(block.kind === "paragraph" || block.kind === "heading") || BODY_START.test(matchingText(runsText(block.runs)))) break;
        // Header lines are sliced from text, and an image has none.
        for (const run of block.runs) if (run.image) images.push(run.image);
        const text = runsText(block.runs);
        // Older resolutions export each sponsor as a separate paragraph.
        if (consumed >= 64) break;
        const starts = [0, ...Array.from(text.matchAll(new RegExp(String.raw`\n|` + CREDIT_SPLIT.source + String.raw`|(?=(?:Presented for|Referred to the senate\b|\{[\s\u200b-\u200d]*S[. -]*(?:Bill|B|Resolution|Res)\b|An? (?:Act|Bill|Resolution)\b))`, "gi")), match => match.index!).filter(at => at > 0), text.length];
        for (let index = 0; index < starts.length - 1; index++) {
            const start = starts[index], end = starts[index + 1];
            const value = matchingText(text.slice(start, end)).trim();
            if (!value) continue;
            // "Co-" typed on its own line (or paragraph) before "Sponsored By:"
            // is one label; hold it and print it at the front of that line.
            const nextBlock = blocks[consumed + 1];
            const following = index + 2 < starts.length ? text.slice(end, starts[index + 2])
                : nextBlock && "runs" in nextBlock ? runsText(nextBlock.runs) : "";
            if (/^Co-?$/i.test(value) && /^\s*Sponsored\s+by\s*:/i.test(matchingText(following))) {
                const leading = text.slice(start, end).length - text.slice(start, end).trimStart().length;
                carry = { runs: sliceRuns(block.runs, start + leading, start + leading + value.length),
                    sectionId: index === 0 ? block.sectionId : undefined };
                continue;
            }
            const kind = CREDIT_LABEL.test(value) ? "credit"
                : /^(?:Presented for|Referred to the senate\b)/i.test(value) ? "reading"
                : BILL_PURPOSE.test(value) ? "purpose"
                : new RegExp("^" + BILL_NUMBER.source, "i").test(value) ? "number"
                : header.at(-1)?.kind === "credit" ? "credit"
                : header.at(-1)?.kind === "reading" ? "reading"
                : purposeSeen ? "title" : numberSeen ? "purpose" : "institution";
            if (kind === "purpose") purposeSeen = true;
            if (kind === "number") numberSeen = true;
            const runs = sliceRuns(block.runs, start, end);
            const sectionId = carry?.sectionId ?? (index === 0 ? block.sectionId : undefined);
            if (carry) {
                // Drop the break between "Co-" and "Sponsored" so it reads as one word.
                const first = runs.findIndex(run => run.text.trim() || run.navigationId || run.anchor);
                if (first > 0) runs.splice(0, first);
                if (runs[0] && !runs[0].navigationId) runs[0] = { ...runs[0], text: runs[0].text.trimStart() };
                runs.unshift(...carry.runs);
                carry = null;
            }
            header.push({ kind, runs, ...(sectionId ? { sectionId } : {}) });
        }
        consumed++;
    }
    // Only recognize a complete title block bounded by a section or resolution clause.
    const firstSection = blocks[consumed];
    if (!header.some(line => line.kind === "purpose" || line.kind === "number") || !firstSection ||
        !(firstSection.kind === "paragraph" || firstSection.kind === "heading") ||
        !BODY_START.test(matchingText(runsText(firstSection.runs)))) return { header: [], images: [], blocks };
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
    return { header, images, blocks: [...decorations, ...normalize(blocks.slice(consumed))] };
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

/**
 * Signers whose template separates them with horizontal rules, not "____"
 * lines: rule, name, office (one or more short paragraphs), rule, name, ...
 * Reads from `start` (the first block after the signatures heading) and
 * returns one card per ruled group and the index after the last one taken.
 */
export function ruledSignatureCards(blocks: Block[], start: number): { cards: { runs: InlineRun[] }[]; end: number } {
    const cards: { runs: InlineRun[] }[] = [];
    let index = start;
    while (blocks[index]?.kind === "rule") {
        const group: Extract<Block, { kind: "paragraph" }>[] = [];
        let next = index + 1;
        for (let block = blocks[next]; block?.kind === "paragraph" && !block.clause; block = blocks[++next]) {
            const text = runsText(block.runs).trim();
            if (!text || text.length > 160 || /^(?:SECTION\b|Signatures?\b|Sources\b)/i.test(text) || group.length >= 4) break;
            group.push(block);
        }
        if (!group.length) break;
        cards.push({ runs: group.flatMap((block, position): InlineRun[] => [
            ...(position ? [{ text: "\n", bold: false, italic: false, strike: false, href: null, annotationId: null, anchor: false }] : []),
            ...(block.sectionId ? [{ text: "", navigationId: block.sectionId, bold: false, italic: false, strike: false, href: null, annotationId: null, anchor: false }] : []),
            ...trimRunsEnd(block.runs),
        ]) });
        index = next;
    }
    // The rule closing the last signer belongs to the block, not the page.
    if (cards.length && blocks[index]?.kind === "rule") index++;
    return { cards, end: index };
}

/**
 * The officials "a copy of this resolution be transmitted to:" names, one per
 * paragraph. `start` is the block after that line; returns the recipient
 * paragraphs (none unless at least two) and the index after the last one.
 */
export function transmittalRecipients(blocks: Block[], start: number): { items: Extract<Block, { kind: "paragraph" }>[]; end: number } {
    const items: Extract<Block, { kind: "paragraph" }>[] = [];
    let index = start;
    for (let block = blocks[index]; block?.kind === "paragraph" && !block.clause; block = blocks[++index]) {
        const text = runsText(block.runs).trim();
        if (!text || text.length > 160 || /[.;:]$/.test(text) ||
            /^(?:The\s+(?:Resolution|Bill|Act)\b|Be\s+It\b|Upon\b|Signatures?\b|SECTION\b|Whereas\b)/i.test(text)) break;
        items.push(block);
    }
    return items.length >= 2 ? { items, end: index } : { items: [], end: start };
}

export const TRANSMITTAL = /\b(?:transmitted|sent|forwarded|delivered|addressed)\s+to:\s*$/i;

function trimRunsEnd(runs: InlineRun[]): InlineRun[] {
    const result = [...runs];
    for (let last = result.length - 1; last >= 0; last--) {
        const run = result[last]!;
        if (run.navigationId || run.image) break;
        const text = run.text.replace(/\s+$/, "");
        if (text || run.anchor) { result[last] = { ...run, text }; break; }
        result.pop();
    }
    return result;
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
