/**
 * Turning a reader's question into search terms.
 *
 * Postgres strips English stopwords itself, but not the interrogative frame a
 * question is wrapped in ("how many ... can there be"), and not the vocabulary
 * every document in this archive shares. Left in, "sga" matches the whole
 * corpus and outweighs "caucus".
 *
 * "Happened" is in the same category, and matters more than it looks. A
 * question about a period has its dates taken out before it gets here (see
 * lib/when.ts), so "what happened last week" arrives as the single word
 * "happened" -- which appears in passing in half the minutes in the archive
 * and describes none of them.
 */

const NOISE_WORDS = new Set([
    "how", "many", "much", "what", "whats", "when", "where", "who", "whom",
    "whose", "why", "which", "can", "could", "should", "would", "may", "might",
    "must", "shall", "will", "does", "did", "was", "were", "are", "is", "be",
    "been", "being", "am", "do", "done", "have", "has", "had", "there", "here",
    "the", "a", "an", "of", "to", "in", "on", "at", "for", "from", "by", "with",
    "about", "into", "over", "under", "and", "or", "but", "if", "than", "then",
    "that", "this", "these", "those", "it", "its", "as", "any", "all", "some",
    "get", "tell", "me", "you", "i", "we", "they", "please", "know", "like",
    "happen", "happens", "happened", "happening", "going", "anything",
    "everything", "something", "nothing", "else", "news", "recap", "update",
    "sga", "jhu", "hopkins", "johns", "university", "student", "students",
    "government", "association", "document", "documents",
]);

/** More terms than this and the tail is noise anyway. */
const MAX_TERMS = 24;

/** The searchable terms in a question. Stemming is left to Postgres. */
export function questionTerms(question: string): string[] {
    const seen = new Set<string>();

    for (const raw of question.toLowerCase().split(/[^a-z0-9]+/)) {
        const term = raw.trim();
        if (term.length < 2) continue;
        if (NOISE_WORDS.has(term)) continue;
        seen.add(term);
        if (seen.size >= MAX_TERMS) break;
    }

    return [...seen];
}

/**
 * Terms are OR'd rather than AND'd.
 *
 * Requiring every term finds nothing: a question phrased "when was the first
 * caucus position introduced" shares no single passage with all of "first",
 * "caucus", "position" and "introduced". Ranking is what separates the passage
 * matching three terms from the one matching a common term once, so an OR
 * query ranked by `ts_rank_cd` behaves like the AND a reader expects, without
 * failing outright when one word is absent.
 */
export function tsQueryFor(terms: string[]): string {
    return terms.join(" | ");
}
