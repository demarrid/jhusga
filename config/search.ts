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
 * "current" is the default because most questions are about the rules in
 * force, and answering those out of a repealed bylaw would be wrong. "all"
 * is what a question about when something changed needs.
 */
export type SearchScope = "current" | "all";
