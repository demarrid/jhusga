/**
 * Search settings shared by the server and the browser.
 *
 * Separate from lib/search.ts because the question box needs these and must
 * not pull Prisma into the client bundle to get them.
 */

/** Questions longer than this are not questions. */
export const MAX_QUESTION_CHARS = 300;

/**
 * Which sessions a question is asked of.
 *
 * The question box no longer asks the reader to pick: it searches the whole
 * archive and then keeps the documents that are in force, unless the question
 * itself is about the past. The CLI still uses these when somebody wants to
 * force one or the other.
 */
export type SearchScope = "current" | "all";

/**
 * Whether a question is about the rules now, or about how they used to be.
 *
 * "How do I get a bill passed" should only read the constitution and bylaws
 * now in force. "When is the last time the constitution was updated" has to
 * look at older editions, and at the amendments between them.
 */
export type QuestionFocus = "current" | "historical";

/**
 * Whether a question is about the rules now, or about how they used to be.
 *
 * Default is current: most people asking the archive want the constitution
 * in force, not the 112th's. A question that names a change, a comparison,
 * a crisis, or "the last time" has to look further back.
 */
export function questionFocus(question: string): QuestionFocus {
    if (
        /\b(?:when (?:was|were|did|is the last)|last time|used to|previous|prior|history of|originally|first time|constitutional crisis|crisis|compar(?:e|ing|ed)|how has|what changed|between the)\b/i.test(
            question,
        )
    ) {
        return "historical";
    }
    return "current";
}
