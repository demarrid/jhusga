import { parseCsvLine, SHEET_BREAK } from "@/lib/csv";
import { extractDocumentLinks } from "@/lib/links";

export const PREFERRED_VOTING_RECORD_FILE = "1bKzJ-EMboOZDpiIh756JyBuLvqBjOJyLEjif8HZ3Rj8";
export function isBillVotingRecord(title: string): boolean {
    return /\bbill voting records?\b/i.test(title);
}
export function isBillVoteQuestion(question: string): boolean {
    return /\b(?:pass(?:ed|age)?|adopt(?:ed|ion)|tabled|rejected)\b/i.test(question)
        || /\b(?:bill|legislation|resolution|amendment)\b/i.test(question) && /\b(?:vote|votes|voting|status)\b/i.test(question);
}
export type BillVoteRecord = {
    title: string;
    fileId?: string;
    status: "passed" | "not_passed" | "unknown";
    when: Date | null;
    reading: number;
    evidence: string;
};
function voteDate(value: string): Date | null {
    const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value.trim());
    if (!match) return null;
    const [, month, day, year] = match.map(Number);
    const date = new Date(Date.UTC(year!, month! - 1, day!, 12));
    return date.getUTCFullYear() === year && date.getUTCMonth() === month! - 1 && date.getUTCDate() === day ? date : null;
}
/** Committee recommendations and blank result cells never establish adoption. */
export function readBillVotingRecords(content: string): BillVoteRecord[] {
    const records: BillVoteRecord[] = [];
    for (const sheet of content.split(SHEET_BREAK)) {
        const lines = sheet.trim().split(/\r?\n/);
        const name = lines[0]?.trim() ?? "";
        const reading = /^second reading$/i.test(name) ? 2 : /^first reading$/i.test(name) ? 1 : 0;
        if (!reading) continue;
        let columns: { title: number; status: number; date: number } | undefined;
        for (const line of lines.slice(1)) {
            const cells = parseCsvLine(line);
            if (cells.includes("Bill #") && cells.includes("Link")) {
                columns = {title: cells.indexOf("Link"), status: cells.findIndex(c => /^(?:Bill )?Status$/i.test(c)), date: cells.findIndex(c => /^Date/i.test(c))};
                continue;
            }
            if (!columns || columns.status < 0 || !cells[columns.title]) continue;
            const statusText = cells[columns.status]?.trim() ?? "";
            const status = /^(?:passed|adopted)$/i.test(statusText) ? "passed"
                : /^(?:failed|rejected|lost|tabled(?: indefinitely)?)$/i.test(statusText) ? "not_passed" : "unknown";
            records.push({title: cells[columns.title]!, fileId: extractDocumentLinks(cells[columns.title]!)[0]?.fileId,
                status, when: voteDate(cells[columns.date] ?? ""), reading, evidence: line});
        }
    }
    return records;
}
export function votingTitleKey(title: string): string {
    return title.trim().replace(/^S[-.\s]*B\.[\d.-]+\s*\|\s*/i, "")
        .replace(/\.(?:docx?|pdf)$/i, "").normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}
/** Prefer exact Drive identity, then exact title. Bill numbers in this sheet
 * disagree between tabs, so a number alone is not sufficient to match a file. */
export function billVoteDecision(document: {driveFileId: string; title: string; displayTitle?: string}, records: BillVoteRecord[]): {
    status: "passed" | "not_passed" | "unknown" | "ambiguous"; when: Date | null;
} {
    const linked = records.filter(r => r.fileId === document.driveFileId);
    const keys = [document.title, document.displayTitle ?? ""].filter(Boolean).map(votingTitleKey);
    let matches = (linked.length ? linked : records.filter(r => keys.includes(votingTitleKey(r.title))))
        .filter(r => r.status !== "unknown");
    if (!matches.length) return {status:"unknown", when:null};
    const reading = Math.max(...matches.map(r => r.reading));
    matches = matches.filter(r => r.reading === reading);
    // Undated contradictory rows cannot be silently ordered by row position.
    if (new Set(matches.map(r => r.status)).size > 1 && matches.some(r => !r.when)) return {status:"ambiguous",when:null};
    const latest = Math.max(...matches.map(r => r.when?.getTime() ?? 0));
    matches = matches.filter(r => (r.when?.getTime() ?? 0) === latest);
    if (new Set(matches.map(r => r.status)).size > 1) return {status:"ambiguous",when:null};
    return {status: matches[0]!.status, when: matches[0]!.when};
}
