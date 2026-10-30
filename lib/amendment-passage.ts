import { isBillVotingRecord, readBillVotingRecords, votingTitleKey } from "@/lib/bill-votes";
import { parseCsvLine } from "@/lib/csv";
import { extractDocumentLinks } from "@/lib/links";
import { toPlainText } from "@/lib/markdown";

export type PassageDocument = {
    id: string;
    driveFileId: string;
    title: string;
    content: string;
    contentHash: string;
    kind: string;
    datedAt?: Date | null;
    sessionNumber?: number | null;
};

export type PassageEvidence = {
    documentId: string;
    driveFileId: string;
    contentHash: string;
    /** Exact source bytes, including the heading that identifies the instrument. */
    quote: string;
    when: Date | null;
    outcome: "passed" | "not_passed" | "unknown";
    source: "register" | "minutes";
    reading?: number;
};

export type AmendmentPassageResult = {
    status: "passed" | "not_passed" | "unknown" | "ambiguous";
    when: Date | null;
    source: "register" | "minutes" | null;
    evidence: PassageEvidence[];
    reason: string;
};

export type PassageBill = {
    id: string;
    driveFileId: string;
    title: string;
    displayTitle?: string;
    sessionNumber?: number | null;
    allowTitleFallback?: boolean;
};

export function titleKey(title: string): string {
    return votingTitleKey(toPlainText(title))
        .replace(/^(?:s b|s r|bill|resolution)\s+\d[\d ]*\s*/, "")
        .trim();
}

function billTitles(bill: PassageBill): Set<string> {
    return new Set([bill.title, bill.displayTitle ?? ""].map(titleKey).filter(key =>
        key.length >= 4 && /[a-z]/.test(key) &&
        !/^(?:s b|s r|bill|resolution|amendment)(?: \d+)*$/.test(key)));
}

function sameSession(bill: PassageBill, doc: PassageDocument): boolean {
    return bill.sessionNumber == null || doc.sessionNumber === bill.sessionNumber;
}

function relevantSession(bill: PassageBill, doc: PassageDocument): boolean {
    return bill.sessionNumber == null || doc.sessionNumber == null ||
        bill.sessionNumber === doc.sessionNumber;
}

function registerEvidence(bill: PassageBill, documents: PassageDocument[]): PassageEvidence[] {
    const rows = documents.filter(doc => relevantSession(bill, doc) && isBillVotingRecord(doc.title))
        .flatMap(doc => readBillVotingRecords(doc.content).map(row => ({ doc, row })));
    const linked = rows.filter(({row}) => row.fileId === bill.driveFileId);
    const titles = billTitles(bill);
    const titleCollision = rows.some(({doc, row}) => sameSession(bill, doc) &&
        row.fileId && row.fileId !== bill.driveFileId && titles.has(titleKey(row.title)));
    const matching = linked.length ? linked : titleCollision || bill.allowTitleFallback === false ? [] : rows.filter(({doc, row}) =>
        !row.fileId && sameSession(bill, doc) && titles.has(titleKey(row.title)));
    if (!matching.length) return [];
    // A later reading with a blank result does not inherit "Passed" from the
    // first reading. Senate minutes can supply the missing final decision.
    const reading = Math.max(...matching.map(({row}) => row.reading));
    return matching.filter(({row}) => row.reading === reading).map(({doc, row}) => ({
        documentId: doc.id,
        driveFileId: doc.driveFileId,
        contentHash: doc.contentHash,
        quote: row.evidence,
        when: row.when,
        outcome: row.status === "passed" && row.reading < 2 &&
            !parseCsvLine(row.evidence).some(cell => /^adopted$/i.test(cell.trim()))
            ? "unknown" : row.status,
        source: "register",
        reading: row.reading,
    }));
}

type MinuteRow = { raw: string; text: string; indent: number; offset: number; end: number; list: boolean; heading: number };

function minuteRows(content: string): MinuteRow[] {
    let offset = 0;
    return content.split("\n").map(raw => {
        const rest = raw.trim();
        const list = /^(?:[-*+]\s+|(?:\d{1,3}|[a-z]|[ivxlcdm]{1,6})\\?[.)]\s+)/i.exec(rest);
        const withoutList = list ? rest.slice(list[0].length) : rest;
        const row = {
            raw, text: toPlainText(withoutList).trim(),
            indent: (raw.match(/^[ \t]*/)?.[0] ?? "").replace(/\t/g,"  ").length,
            offset, end: offset + raw.length, list: Boolean(list),
            heading: /^(#{1,6})\s+/.exec(withoutList)?.[1].length ?? 0,
        };
        offset += raw.length + 1;
        return row;
    });
}

function leadingLink(raw: string): boolean {
    let rest = raw.trim();
    // Exports sometimes number an already-lettered agenda item: "3. c. [Act]".
    for (let level = 0; level < 3; level++) {
        const next = rest.replace(/^(?:[-*+]\s+|(?:\d{1,3}|[a-z]|[ivxlcdm]{1,6})\\?[.)]\s+)/i,"");
        if (next === rest) break;
        rest = next;
    }
    return rest.replace(/^(?:#{1,6}\s*)?(?:\*\*|__|\*|_)?\s*/,"").startsWith("[");
}

function speakerless(text: string): string {
    return text.replace(/^[\p{L}][\p{L} .’'-]{1,45}:\s*/u, "").trim();
}

function result(text: string): "passed" | "not_passed" | "unknown" {
    if (/\b(?:not|never|did not|does not)\s+pass(?:ed|es)?\b/i.test(text) ||
        /\b(?:failed|fails|lost|rejected|not adopted)\b/i.test(text)) return "not_passed";
    return /\b(?:passed|passes|adopted)\b/i.test(text) ? "passed" : "unknown";
}

function voteOutcomes(rows: MinuteRow[], start: number, end: number): PassageEvidence["outcome"][] {
    const outcomes: PassageEvidence["outcome"][] = [];
    for (let i = start + 1; i < end; i++) {
        const line = speakerless(rows[i].text);
        if (line.length > 180 || /[?]/.test(line) ||
            /\b(?:if|unless|would|could|should|will|may|might|pending|not yet|committee|recommendation|refer(?:red|ral)?|reading|table[ds]?|amendment|section|clause)\b/i.test(line)) continue;
        if (/^(?:the\s+)?(?:bill|resolution|act)\s+(?:(?:was|is|has been)\s+)?(?:pass(?:ed|es)|adopted|failed|fails|lost|rejected|(?:did\s+)?not\s+pass(?:ed)?|never\s+passed|not\s+adopted)\b/i.test(line)) {
            outcomes.push(result(line));
            continue;
        }
        const motion = /^(?:motion|moved|moves)\s+to\s+(?:pass|adopt)\b(.*)$/i.exec(line);
        if (!motion) continue;
        const tail = motion[1].trim().replace(/^(?:(?:the|this)\s+)?(?:bill|resolution|act)\b/i, "").trim();
        // "Motion to pass over..." and other objects are not final adoption.
        if (tail && !/^(?:[,;:!.(—–-]|passed\b|passes\b|adopted\b|failed\b|fails\b|lost\b|rejected\b|not\b)/i.test(tail)) continue;
        const inline = result(tail);
        if (inline !== "unknown") outcomes.push(inline);
        for (let child = i + 1; child < end && rows[child].indent > rows[i].indent; child++) {
            const childLine = rows[child].text;
            if (/^(?:passed|passes|adopted|failed|fails|lost|rejected|not passed|not adopted)(?:[!?.]|\s+(?:\d|unanimously|with\s+\d).*)?$/i.test(childLine)) {
                outcomes.push(result(childLine));
            }
        }
    }
    return outcomes;
}

function minutesEvidence(bill: PassageBill, documents: PassageDocument[]): PassageEvidence[] {
    const titles = billTitles(bill);
    const evidence: PassageEvidence[] = [];
    for (const doc of documents) {
        if (doc.kind !== "minutes.senate" || !relevantSession(bill, doc)) continue;
        const rows = minuteRows(doc.content);
        for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            if (!row.list && !row.heading) continue;
            const links = extractDocumentLinks(row.raw);
            const link = leadingLink(row.raw) ? links[0] : undefined;
            const identified = link ? link.fileId === bill.driveFileId :
                bill.allowTitleFallback !== false && links.length === 0 && sameSession(bill, doc) && titles.has(titleKey(row.text));
            if (!identified) continue;
            let end = i + 1;
            while (end < rows.length) {
                const next = rows[end];
                if (next.text && ((row.heading && next.heading && next.heading <= row.heading) ||
                    (!row.heading && next.indent <= row.indent) ||
                    (row.heading && next.list && next.indent <= row.indent && leadingLink(next.raw)))) break;
                end++;
            }
            const outcomes = new Set(voteOutcomes(rows,i,end));
            for (const outcome of outcomes) {
                if (outcome === "unknown") continue;
                evidence.push({
                    documentId:doc.id, driveFileId:doc.driveFileId, contentHash:doc.contentHash,
                    quote:doc.content.slice(row.offset, rows[end - 1]?.end ?? row.end),
                    when:doc.datedAt ?? null, outcome, source:"minutes",
                });
            }
        }
    }
    return evidence;
}

/**
 * Passage only. This does not establish which bill text the Senate adopted or
 * whether that text explains a held governing-document revision.
 *
 * Every positive result is dated and no later than asOf. Conflicting final
 * records stay inconclusive, including conflicts between registers and minutes.
 */
export function amendmentPassage(input: {
    bill: PassageBill;
    records: PassageDocument[];
    minutes: PassageDocument[];
    asOf?: Date;
}): AmendmentPassageResult {
    const register = registerEvidence(input.bill,input.records);
    const minutes = minutesEvidence(input.bill,input.minutes);
    const evidence = [...register,...minutes];
    const cutoff = (input.asOf ?? new Date()).getTime();
    const observed = evidence.filter(row => row.outcome !== "unknown" &&
        (!row.when || row.when.getTime() <= cutoff));
    const outcomes = new Set(observed.map(row => row.outcome));
    if (outcomes.size > 1) return {
        status:"ambiguous",when:null,source:null,evidence,
        reason:"The archived Senate results conflict; passage cannot be cleared automatically.",
    };
    const dated = observed.filter(row => row.when && Number.isFinite(row.when.getTime()));
    const preferred = dated.filter(row => row.source === "register");
    const usable = preferred.length ? preferred : dated.filter(row => row.source === "minutes");
    if (!usable.length) return {
        status:"unknown",when:null,source:null,evidence,
        reason:evidence.length
            ? "No dated final Senate result at or before the cutoff establishes passage."
            : "No matching final Senate vote was found in the archived records or minutes.",
    };
    // Earliest corroborated date avoids claiming the act only occurred when a
    // later duplicate copy happened to repeat it.
    const chosen = [...usable].sort((a,b) => a.when!.getTime() - b.when!.getTime())[0];
    return {
        status:chosen.outcome as "passed" | "not_passed",
        when:chosen.when,source:chosen.source,evidence,
        reason:chosen.outcome === "passed"
            ? `Dated Senate adoption is recorded in the ${chosen.source === "register" ? "Bill Voting Records" : "Senate minutes"}.`
            : "The archived final Senate result does not record adoption.",
    };
}
