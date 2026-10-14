import { matchAccount, type AccountCandidate } from "@/lib/accounts";
import { toPlainText } from "@/lib/markdown";

export type StoredEditor = {
    documentId: string;
    editorName: string;
    editorEmail: string;
    fetchedAt: Date;
    content: string | null;
    revisionId?: string;
};
export type EditorAccount = { name: string; email: string };
export type RankedEditor = EditorAccount & { changedWords: number };

// A credit requires a substantive revision and at least 5% of observed writing.
export const MIN_AUTHOR_WORDS = 30;
export const MIN_AUTHOR_SHARE = 0.05;

/** New/replaced words, ignoring case, formatting, and word/paragraph order.
 * Deletions alone do not establish who wrote the minutes. This deliberately
 * undercounts rewrites that reuse the same vocabulary rather than credit moves.
 */
export function contributionWords(before: string, after: string): number {
    const words = (text: string) => toPlainText(text).normalize("NFKC").toLowerCase()
        .match(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu) ?? [];
    const remaining = new Map<string, number>();
    for (const word of words(before)) remaining.set(word, (remaining.get(word) ?? 0) + 1);
    let added = 0;
    for (const word of words(after)) {
        const count = remaining.get(word) ?? 0;
        if (count) remaining.set(word, count - 1);
        else added += 1;
    }
    return added;
}

/** Retained snapshots estimate writing, not keystrokes or exact authorship.
 * The first snapshot is a baseline, never all credited to its last editor.
 * Missing exports break the chain; never assign an unseen interval to a user.
 */
export function rankedEditors(revisions: StoredEditor[]): Map<string, RankedEditor[]> {
    const documents = new Map<string, StoredEditor[]>();
    for (const revision of revisions) {
        const list = documents.get(revision.documentId) ?? [];
        list.push(revision);
        documents.set(revision.documentId, list);
    }
    const result = new Map<string, RankedEditor[]>();
    for (const [documentId, snapshots] of documents) {
        snapshots.sort((a, b) => a.fetchedAt.getTime() - b.fetchedAt.getTime()
            || (a.revisionId ?? "").localeCompare(b.revisionId ?? ""));
        const people = new Map<string, RankedEditor>();
        let before: string | null = null;
        let total = 0;
        for (const snapshot of snapshots) {
            if (before !== null && snapshot.content !== null) {
                const changedWords = contributionWords(before, snapshot.content);
                total += changedWords;
                const email = snapshot.editorEmail.trim().toLowerCase();
                const name = snapshot.editorName.trim();
                if (changedWords >= MIN_AUTHOR_WORDS && (email || name)) {
                    const key = email || `name:${name.toLowerCase()}`;
                    const person = people.get(key) ?? { name, email, changedWords: 0 };
                    person.changedWords += changedWords;
                    if (name) person.name = name;
                    people.set(key, person);
                }
            }
            before = snapshot.content;
        }
        result.set(documentId, [...people.values()]
            .filter(person => person.changedWords >= MIN_AUTHOR_WORDS && person.changedWords >= total * MIN_AUTHOR_SHARE)
            .sort((a, b) => b.changedWords - a.changedWords || a.name.localeCompare(b.name) || a.email.localeCompare(b.email)));
    }
    return result;
}

/** Resolve handles to known people; omit unresolved account handles. */
export function editorDisplayName(editor: EditorAccount, people: AccountCandidate[]): string {
    const email = editor.email.trim();
    const name = editor.name.trim();
    const handle = email || (name && !/\s/.test(name) ? `${name}@drive.local` : "");
    const match = matchAccount({ email: handle || null, displayName: name }, people);
    if (match) return match.person.name;
    const words = name.split(/\s+/).filter(Boolean);
    if (words.length >= 2 && words.every((word) => /^[A-Z][a-z]+/.test(word))) return name;
    return "";
}
