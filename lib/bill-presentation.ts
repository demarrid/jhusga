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
const BILL_PURPOSE = /^(?:A Bill\b|(?:An?\s+)?Act\s+to\b)/i;

export function presentBill(blocks: Block[]): { header: BillHeaderLine[]; blocks: Block[] } {
    const opening = blocks.slice(0, 16).flatMap(block => "runs" in block ? [runsText(block.runs)] : []).join("\n");
    if (!/Student Government Association/i.test(opening) || !opening.split("\n").some(line => BILL_PURPOSE.test(line.trim()))) {
        return { header: [], blocks };
    }
    const header: BillHeaderLine[] = [];
    let consumed = 0;
    let purposeSeen = false;
    let numberSeen = false;
    for (const block of blocks) {
        if (!(block.kind === "paragraph" || block.kind === "heading") || SECTION.test(runsText(block.runs))) break;
        const text = runsText(block.runs);
        if (consumed >= 16) break;
        const starts = [0, ...Array.from(text.matchAll(/\n|(?=(?:Introduced by:|Sponsored by:|Presented for \w+ Reading))/gi), match => match.index!).filter(at => at > 0), text.length];
        for (let index = 0; index < starts.length - 1; index++) {
            const start = starts[index], end = starts[index + 1];
            const value = text.slice(start, end).trim();
            if (!value) continue;
            const kind = /^(Introduced|Sponsored) by:/i.test(value) ? "credit"
                : /^Presented for/i.test(value) ? "reading"
                : BILL_PURPOSE.test(value) ? "purpose"
                : /^\{?\s*S[. -]*(?:Bill|B)[.\s]/i.test(value) ? "number"
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
