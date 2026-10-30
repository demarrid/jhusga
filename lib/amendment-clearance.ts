
/**
 * Passage is necessary but insufficient: a passed bill must account for the
 * complete held text. Only source-backed operative edits are replayed, and
 * the resulting whole document must match; models do not decide clearance.
 */
export type GoverningTarget = { kind: string; title: string };
export type AmendmentBill = {
    id: string;
    title: string;
    kind: string;
    content: string;
    passage: {
        status: "passed" | "unknown" | "not_passed" | "ambiguous";
        evidence: string;
        sourceId: string;
    };
};
export type AmendmentProof = {
    billId: string;
    instruction: string;
    before: string;
    after: string;
    passageSourceId: string;
    passageEvidence: string;
};
export type AmendmentClearance = {
    clear: boolean;
    reason: string;
    method: "exact" | "none";
    evidence: AmendmentProof[];
};
export type AmendmentInput = {
    target: GoverningTarget;
    before: string;
    after: string;
    bills: AmendmentBill[];
};
export type InstructionProposal = { billId: string; instruction: string };
type Edit = { bill: AmendmentBill; instruction: string; before: string; after: string; index: number };

const MAX_SOURCE_CHARS = 180_000;
const MAX_BILLS = 12;
const MIN_ANCHOR_LENGTH = 8;

function held(reason: string): AmendmentClearance {
    return { clear: false, reason, method: "none", evidence: [] };
}

/** Only export presentation is folded; numbering, punctuation and case remain. */
export function normalizeAmendmentText(text: string): string {
    return text
        .replace(/<br\s*\/?>/gi, " ")
        .replace(/[\u201c\u201d]/g, '"')
        .replace(/[\u2018\u2019]/g, "'")
        .replace(/\\([\\`*{}\[\]()#+.!_>~|=-])/g, "$1")
        .replace(/^\s*#{1,6}\s+/gm, "")
        .replace(/\*\*|__/g, "")
        .replace(/(?<!\w)[*_]([^*_\n]+)[*_](?!\w)/g, "$1")
        .replace(/\s+/g, " ")
        .trim();
}

function instrument(kind: string): "bylaws" | "constitution" | null {
    if (kind === "guiding.bylaws") return "bylaws";
    if (kind === "guiding.constitution") return "constitution";
    return null;
}

function singleBillInstrument(kind: string): "bylaws" | "constitution" | null {
    if (kind === "bill.bylaws_amendment") return "bylaws";
    if (kind === "bill.constitution_amendment") return "constitution";
    return null;
}

/** A heading, not a passing reference to another instrument in a paragraph. */
function scopeHeading(line: string): "bylaws" | "constitution" | null {
    const plain = line.replace(/[|#*_]/g, " ").replace(/\s+/g, " ").trim();
    if (/\bbylaws\b/i.test(plain) && /\bconstitution(?:al)?\b/i.test(plain)) return null;
    if (/^(?:(?:section|part)\s+[\dIVXLC.:-]+\s*[:.—-]?\s*)?(?:(?:proposed\s+)?amendments?\s+to\s+(?:the\s+)?)?(?:(?:JHU\s+)?SGA\s+|senate\s+)?bylaws(?:\s+amendments?(?:\s+proposed\s+in\s+this\s+bill)?)?[:.]?$/i.test(plain)) return "bylaws";
    if (/^(?:(?:section|part)\s+[\dIVXLC.:-]+\s*[:.—-]?\s*)?(?:(?:proposed\s+)?amendments?\s+to\s+(?:the\s+)?)?(?:(?:JHU\s+)?SGA\s+)?constitution(?:al)?(?:\s+amendments?(?:\s+proposed\s+in\s+this\s+bill)?)?[:.]?$/i.test(plain)) return "constitution";
    return null;
}

function scopeAt(bill: AmendmentBill, offset: number): "bylaws" | "constitution" | null {
    let scope = singleBillInstrument(bill.kind);
    for (const line of bill.content.slice(0, offset).split("\n")) {
        const next = scopeHeading(line);
        if (next) scope = next;
    }
    return scope;
}
function operativeAt(bill: AmendmentBill, offset: number): boolean {
    let operative = true;
    for (const line of bill.content.slice(0, offset).split("\n")) {
        const text = normalizeAmendmentText(line.replace(/[|#]/g, " "));
        if (/^(?:section [\dIVXLC.]+[ .:]*)?(?:rationale|examples?|illustrations?|findings(?: and purposes)?|purposes?|rejected amendments?|withdrawn amendments?)\b/i.test(text)) operative = false;
        if (/^(?:section [\dIVXLC.]+[ .:]*)?amendments?\b/i.test(text) || scopeHeading(line)) operative = true;
    }
    return operative;
}


function cells(line: string): string[] | null {
    const trimmed = line.trim();
    if (!trimmed.startsWith("|") || !trimmed.endsWith("|")) return null;
    if (/\\\|/.test(trimmed)) return null;
    return trimmed.slice(1, -1).split("|").map(cell => cell.trim());
}
function headerKind(cell: string): "old" | "new" | null {
    const plain = normalizeAmendmentText(cell);
    if (/^(?:current|existing|original)(?:\s+(?:language|text|wording|provision))?$/i.test(plain)) return "old";
    if (/^(?:proposed|amended|new|replacement)(?:\s+(?:language|text|wording|provision))?$/i.test(plain)) return "new";
    return null;
}
function anchorSafe(value: string): boolean {
    return value.length >= MIN_ANCHOR_LENGTH && /\p{L}/u.test(value) && !/~~|<del\b|<s\b/i.test(value);
}

function pushEdit(edits: Edit[], bill: AmendmentBill, instruction: string, before: string, after: string, index: number) {
    const oldText = normalizeAmendmentText(before);
    const newText = normalizeAmendmentText(after);
    if (!anchorSafe(oldText) || oldText === newText || /~~|<del\b|<s\b/i.test(newText)) return;
    edits.push({ bill, instruction, before: oldText, after: newText, index });
}

/** Only tables explicitly labeling both sides establish which text is enacted. */
function tableEdits(bill: AmendmentBill): Edit[] {
    const edits: Edit[] = [];
    let oldColumn = -1;
    let newColumn = -1;
    let header = "";
    let headerOffset = 0;
    let offset = 0;
    for (const line of bill.content.split("\n")) {
        const row = cells(line);
        if (!row) {
            oldColumn = newColumn = -1;
            header = "";
            offset += line.length + 1;
            continue;
        }
        const old = row.findIndex(cell => headerKind(cell) === "old");
        const next = row.findIndex(cell => headerKind(cell) === "new");
        if (old >= 0 && next >= 0 && old !== next) {
            oldColumn = old;
            newColumn = next;
            header = line;
            headerOffset = offset;
        } else if (header && row.length > Math.max(oldColumn, newColumn)
            && !row.every(cell => /^:?-+:?$/.test(cell))) {
            const before = row[oldColumn]!;
            const after = row[newColumn]!;
            // Blank/deleted cells could also be unfinished proposals. Deletion
            // needs an explicit operative instruction.
            if (before && after && !/^(?:none|n\/a|deleted|removed|no change)[.!]?$/i.test(normalizeAmendmentText(after))) {
                const oldParts = before.split(/(?:<br\s*\/?>|\s)*(?:\\?=){3,}(?:<br\s*\/?>|\s)*/i);
                const newParts = after.split(/(?:<br\s*\/?>|\s)*(?:\\?=){3,}(?:<br\s*\/?>|\s)*/i);
                if (oldParts.length === newParts.length) {
                    for (let index = 0; index < oldParts.length; index++) {
                        const oldPart = oldParts[index]!;
                        const newPart = newParts[index]!;
                        // In Current, struck words are still the old rule; in
                        // Proposed, they are explicit deletions. Unbalanced
                        // markup or ellipses cannot establish a full provision.
                        if ([oldPart,newPart].some(part => (part.match(/~~/g)?.length ?? 0) % 2 ||
                            /…|\.\.\.|<del\b|<s\b/i.test(part))) continue;
                        pushEdit(edits, bill, bill.content.slice(headerOffset, offset + line.length),
                            oldPart.replace(/~~/g, ""), newPart.replace(/~~[\s\S]*?~~/g, ""), offset);
                    }
                }
            }
        }
        offset += line.length + 1;
    }
    return edits;
}

const QUOTED = '["“]([^"“”]+)["”]';
// Never match halfway through "does not replace ...".
const LEAD = '(?:^\\s*(?:[-*]\\s+|\\d+[.)]\\s+)?(?:The\\s+(?:words|text|language)\\s+)?)';
function proseEdits(bill: AmendmentBill, excerpt = bill.content, baseOffset = 0): Edit[] {
    const edits: Edit[] = [];
    const replace = new RegExp(LEAD + '(?:replace|replacing)\\s+(?:(?:the\\s+)?(?:words|text|phrase|language|clause)\\s+)?' +
        QUOTED + '\\s+with\\s+' + QUOTED + '\\s*[.;]?\\s*$', "gim");
    const replacePassive = new RegExp(LEAD + QUOTED +
        '\\s+(?:shall\\s+be|is|are)\\s+(?:hereby\\s+)?(?:replaced\\s+(?:by|with)|amended\\s+to\\s+read)\\s+' +
        QUOTED + '\\s*[.;]?\\s*$', "gim");
    for (const regex of [replace, replacePassive]) {
        for (const match of excerpt.matchAll(regex)) {
            pushEdit(edits, bill, match[0], match[1]!, match[2]!, baseOffset + match.index!);
        }
    }
    const remove = new RegExp(LEAD + '(?:delete|remove|strike)\\s+(?:(?:the\\s+)?(?:words|text|phrase|language|clause)\\s+)?' +
        QUOTED + '\\s*[.;]?\\s*$', "gim");
    for (const match of excerpt.matchAll(remove)) {
        pushEdit(edits, bill, match[0], match[1]!, "", baseOffset + match.index!);
    }
    const insert = new RegExp(LEAD + '(?:insert|add)\\s+' + QUOTED +
        '\\s+(immediately\\s+)?(after|before)\\s+' + QUOTED + '\\s*[.;]?\\s*$', "gim");
    for (const match of excerpt.matchAll(insert)) {
        const addition = normalizeAmendmentText(match[1]!);
        const anchor = normalizeAmendmentText(match[4]!);
        const after = match[3]!.toLowerCase() === "after" ? anchor + " " + addition : addition + " " + anchor;
        pushEdit(edits, bill, match[0], anchor, after, baseOffset + match.index!);
    }
    return edits;
}

function passed(bill: AmendmentBill): boolean {
    return bill.passage.status === "passed" && !!bill.passage.sourceId.trim() && !!bill.passage.evidence.trim();
}
function uniqueOffset(text: string, quote: string): number {
    const at = text.indexOf(quote);
    return at >= 0 && text.indexOf(quote, at + 1) === -1 ? at : -1;
}
function exactExcerptOffset(content: string, excerpt: string): number {
    if (!excerpt.trim() || excerpt.length > 30_000) return -1;
    return uniqueOffset(content, excerpt);
}

/** Proposals locate source excerpts; independently parsed source text is proof. */
export function verifyAmendmentMatch(
    input: AmendmentInput,
    proposals: InstructionProposal[] = [],
): AmendmentClearance {
    const target = instrument(input.target.kind);
    if (!target) return held("Only Constitution and Bylaws revisions can use amendment clearance.");
    if (!input.before.trim() || !input.after.trim()) return held("A complete previous and proposed text is required.");
    if (input.before.length + input.after.length > MAX_SOURCE_CHARS) return held("The revision exceeds the automatic comparison budget.");
    const before = normalizeAmendmentText(input.before);
    const after = normalizeAmendmentText(input.after);
    if (before === after) return held("No substantive amendment was found; formatting-only changes remain available for review.");
    const bills = input.bills.filter(passed);
    if (!bills.length) return held("No amendment bill has unambiguous, cited Senate passage evidence.");
    if (bills.length > MAX_BILLS) return held("Too many candidate bills; narrow the amendment evidence before clearance.");
    if (bills.some(bill => bill.content.length > MAX_SOURCE_CHARS)) return held("An amendment bill exceeds the automatic comparison budget.");
    for (const bill of bills) {
        const timingLines = bill.content.split("\n").filter(line => !line.trim().startsWith("|") &&
            /(?:this (?:act|bill)|these amendments?).*(?:take effect|effective|into effect|contingent|subject to|conditional)/i.test(line));
        if (timingLines.some(line => !/(?:immediately|upon (?:its )?(?:passage|adoption|enactment))/i.test(line) ||
            /(?:unless|except|contingent|subject to|conditional)/i.test(line))) {
            return held("The bill has a delayed or conditional effective provision requiring review.");
        }
    }
    const edits: Edit[] = [];
    for (const bill of bills) {
        edits.push(...tableEdits(bill), ...proseEdits(bill));
        for (const proposed of proposals.filter(proposal => proposal.billId === bill.id)) {
            const offset = exactExcerptOffset(bill.content, proposed.instruction);
            if (offset < 0) continue;
            if (offset > 0 && bill.content[offset - 1] !== "\n") continue;
            const end = offset + proposed.instruction.length;
            if (end < bill.content.length && bill.content[end] !== "\n") continue;
            edits.push(...proseEdits(bill, proposed.instruction, offset));
        }
    }
    const applicable = edits.filter(edit => scopeAt(edit.bill, edit.index) === target &&
        operativeAt(edit.bill, edit.index) && before.includes(edit.before));
    if (!applicable.length) return held("No explicit, target-specific amendment instruction matches the previous text.");
    const locations = new Map<string, Edit & { start: number; end: number }>();
    for (const edit of applicable) {
        const start = uniqueOffset(before, edit.before);
        if (start < 0) return held("An amendment anchor occurs more than once; its intended provision is ambiguous.");
        const end = start + edit.before.length;
        const key = start + ":" + end;
        const existing = locations.get(key);
        if (existing && existing.after !== edit.after) return held("Passed bills contain conflicting replacements for the same provision.");
        if (!existing) locations.set(key, { ...edit, start, end });
    }
    const ordered = [...locations.values()].sort((a, b) => a.start - b.start);
    if (ordered.some((edit, index) => index > 0 && ordered[index - 1]!.end > edit.start)) {
        return held("Amendment instructions overlap; their order or scope requires review.");
    }
    let result = "";
    let cursor = 0;
    for (const edit of ordered) {
        result += before.slice(cursor, edit.start) + edit.after;
        cursor = edit.end;
    }
    result += before.slice(cursor);
    if (normalizeAmendmentText(result) !== after) {
        return held("The passed amendment instructions do not account for every change in the proposed text.");
    }
    return {
        clear: true,
        reason: "Every substantive change is reproduced by explicit amendment instructions with cited Senate passage evidence.",
        method: "exact",
        evidence: ordered.map(edit => ({
            billId: edit.bill.id,
            instruction: edit.instruction,
            before: edit.before,
            after: edit.after,
            passageSourceId: edit.bill.passage.sourceId,
            passageEvidence: edit.bill.passage.evidence,
        })),
    };
}

/** Clearance is deterministic; a model cannot excuse an unexplained change. */
export async function checkAmendmentClearance(input: AmendmentInput & {
    allowModel?: boolean;
    deadline?: number;
}): Promise<AmendmentClearance> {
    if (input.deadline !== undefined && Date.now() >= input.deadline) return held("The review deadline was reached.");
    return verifyAmendmentMatch(input);
}
