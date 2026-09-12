/**
 * The archive's second source: The Johns Hopkins News-Letter.
 *
 * Everything here is meant to be edited, in the same spirit as config/sga.ts.
 * The two knobs that matter are the phrases searched for and the per-run
 * budget: the first decides what the archive considers coverage of the SGA, and
 * the second decides how much of a stranger's site a single nightly run is
 * allowed to read.
 */

export const NEWSLETTER_ORIGIN = "https://www.jhunewsletter.com";

/**
 * The phrases an article has to contain to be kept.
 *
 * Used twice, and the second use is the one that decides: they are handed to
 * the paper's own search engine to get a candidate list, and then checked
 * against the article text this code fetched. The engine matches stemmed words
 * across a whole page including its navigation, so its answer is a starting
 * point and not the authority; see `matchedPhrases` in lib/newsletter.ts.
 *
 * "student council" is here because the body was called that until 2008 --
 * a search for "sga" alone loses the years in which the constitution the SGA
 * still runs on was written.
 */
export const NEWSLETTER_PHRASES = [
    "sga",
    "student government",
    "student council",
] as const;

export type NewsletterPhrase = (typeof NEWSLETTER_PHRASES)[number];

/**
 * Who this is, in a header a sysadmin reading their logs can act on.
 *
 * A few thousand requests from an unexplained client is how an archive gets
 * itself blocked. Overridable so a fork does not claim to be this deployment.
 */
export const NEWSLETTER_USER_AGENT =
    process.env.NEWSLETTER_USER_AGENT ||
    "jhusga-archive/1.0 (unofficial JHU SGA archive; +https://jhusga.org)";

/**
 * How long to wait between requests, in milliseconds.
 *
 * jhunewsletter.com/robots.txt asks for `Crawl-delay: 10`, and this is that
 * number rather than a faster one somebody guessed was polite enough. It is the
 * reason a run is budgeted instead of exhaustive: honouring the delay means a
 * backfill of a few thousand articles takes days of nightly runs, which is the
 * correct trade and not a bug to be tuned away.
 */
export const NEWSLETTER_REQUEST_DELAY_MS = Number(
    process.env.NEWSLETTER_REQUEST_DELAY_MS || 10_000,
);

/** Retries for a request worth retrying, and the base of its backoff. */
export const NEWSLETTER_MAX_RETRIES = 4;
export const NEWSLETTER_RETRY_BASE_MS = 500;

/**
 * Results per search page.
 *
 * 200 is the most the site will actually serve: asking for 1000 returns the
 * same page. Higher is strictly better here, because one page of 200 is one
 * request where ten pages of 20 are ten.
 */
export const NEWSLETTER_RESULTS_PER_PAGE = 200;

/**
 * How many pages of one search to read before giving up on it.
 *
 * Pagination cannot be trusted to say when it has ended -- the last page of a
 * one-page search still renders a "Next" link -- so a page holding no results
 * is the real terminator and this is only a guard against a search that never
 * stops producing them.
 */
export const MAX_SEARCH_PAGES_PER_WINDOW = 12;

/**
 * The earliest year to search.
 *
 * The News-Letter has published since 1896, but its online archive begins in
 * 2001: a search for a word every issue contains returns 345 hits for 2001 and
 * nothing at all for 2000 or any year before it. Searching further back is
 * requests spent on empty pages.
 *
 * Not 2008, which is what a search for "sga" alone suggests -- the acronym
 * returns nothing before 2008 because the body was called Student Council, and
 * reading that as the archive's start silently drops seven years of coverage
 * the other two phrases find.
 */
export const NEWSLETTER_EARLIEST_YEAR = 2001;

/**
 * The most articles one run will fetch.
 *
 * Guards the same thing MAX_FILES_PER_SYNC guards, and one more: at the crawl
 * delay above, an unbudgeted first run would hold a nightly job open for days.
 * A run that hits the budget stops cleanly and the next one carries on, since
 * an article already stored is never fetched again.
 */
export const MAX_ARTICLES_PER_RUN = Number(
    process.env.NEWSLETTER_MAX_ARTICLES || 400,
);

/**
 * How long one run may spend, in milliseconds.
 *
 * The article budget above bounds the work; this bounds the wall clock, and
 * both are needed because the crawl delay makes them different questions. A
 * serverless function is killed at its `maxDuration` with no chance to record
 * what it managed, so the run stops itself a little short of that and reports.
 * Four minutes against the route's five.
 */
export const NEWSLETTER_RUN_BUDGET_MS = Number(
    process.env.NEWSLETTER_RUN_BUDGET_MS || 240_000,
);

/**
 * How many calendar years back a routine run searches.
 *
 * New coverage only ever appears in the current year or, in January, the one
 * before it, so a nightly run reads two years and costs six search requests.
 * Reaching the rest of the archive is what `--backfill` is for.
 */
export const NEWSLETTER_RECENT_YEARS = 2;

/**
 * The most results the paper's search will report for one query, ever.
 *
 * Both "student government" and "student council" report exactly this against
 * the whole archive, which is a ceiling rather than a count -- so a query with
 * no date range cannot be enumerated. Every search is therefore restricted to
 * a single calendar year, which keeps each one far below the cap. The constant
 * is here so the assumption is written down where somebody would look when the
 * cap moves.
 */
export const NEWSLETTER_SEARCH_RESULT_CAP = 1_000;
