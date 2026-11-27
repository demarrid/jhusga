/**
 * The archive's third source: The Johns Hopkins Gazette, read from the
 * Internet Archive's Wayback Machine.
 *
 * The Gazette was the university's own weekly (later monthly) newspaper from
 * 1971 to 2015, online from 1994. It covered the student government as the
 * administration saw it -- elections, referendums, Student Council budgets --
 * which is a view of the 1990s and 2000s the archive otherwise lacks.
 *
 * It is read from archived captures rather than from JHU, and that is a
 * constraint, not a preference: every JHU host that serves it (pages.jh.edu,
 * gazette.jhu.edu, hub.jhu.edu) sits behind a Cloudflare rule that answers an
 * honestly identified crawler with 403, robots.txt included. The archive does
 * not pretend to be a browser to get past that. The Wayback Machine holds the
 * same pages, puts no load on JHU, and is a public research archive meant to be
 * read like this. A reader is still sent to the live JHU page.
 *
 * Like config/newsletter.ts, everything here is meant to be edited.
 */

export const WAYBACK_ORIGIN = "https://web.archive.org";

/**
 * The three sites the Gazette lived on, as the Wayback Machine indexes them.
 *
 * Prefixes are written without `www.` and without a scheme because the CDX
 * index canonicalises both away: `jhu.edu/~gazette/` covers `www.jhu.edu`,
 * `jhu.edu:80` and the `%7E` spelling of the tilde in one query.
 *
 *   static     1994 to May 2009. Hand-built weekly issues under
 *              /~gazette/<year>/<issue>/ (and, 1995-1998, under quarterly
 *              folders such as /~gazette/octdec96/oct0796/). Moved to
 *              pages.jh.edu/gazette/ when jhu.edu retired user directories.
 *   wordpress  2007 to July 2012 at gazette.jhu.edu/<y>/<m>/<d>/<slug>/.
 *   hub        September 2012 to 2015, the monthly Gazette inside the Hub at
 *              hub.jhu.edu/gazette/<year>/<month>/<slug>.
 */
export const GAZETTE_STATIC_PREFIXES = [
    "jhu.edu/~gazette/",
    "jhu.edu/gazette/",
    "pages.jh.edu/gazette/",
] as const;

export const GAZETTE_WORDPRESS_PREFIX = "gazette.jhu.edu/";
export const GAZETTE_HUB_PREFIX = "hub.jhu.edu/gazette/";

/** Where each era's articles live now, for the link a reader follows. */
export const GAZETTE_STATIC_LIVE_ORIGIN = "https://pages.jh.edu/gazette/";
export const GAZETTE_WORDPRESS_LIVE_ORIGIN = "https://gazette.jhu.edu/";
export const GAZETTE_HUB_LIVE_ORIGIN = "https://hub.jhu.edu/gazette/";

/**
 * The first post date the WordPress era owns.
 *
 * gazette.jhu.edu launched in June 2009 and its database was seeded with
 * articles from earlier issues (one is dated 1995). Those are the static
 * issues' articles under a second URL, and taking both would store every one
 * of them twice. The static site's last issue is May 26, 2009.
 */
export const GAZETTE_WORDPRESS_FROM = "2009-06-01";

/** The first and last years any era has an issue in. */
export const GAZETTE_EARLIEST_YEAR = 1994;
export const GAZETTE_LATEST_YEAR = 2015;

/**
 * Static-era pages that are never coverage of anything: the job listings and
 * the classified ads. Each is a long page in every weekly issue, so skipping
 * them saves roughly a tenth of the backfill's requests. Matched against the
 * file name ("09jobs.html", "class.html").
 *
 * Calendars, notices, "In Brief" and "Cheers" are kept on purpose: a Student
 * Council election notice or a student-government award is exactly the kind of
 * item that lives in them.
 */
export const GAZETTE_SKIPPED_FILES = /^(?:\d{0,2})(?:jobs?|employ|employment|class|classified|classifieds|ads?)\.html?$/i;

/** The same two departments in the WordPress era, matched against the post's slug. */
export const GAZETTE_SKIPPED_SLUGS = /^(?:classifieds|job-opportunities|jobs)(?:-|$)/i;

/** Who this is, sent to the Wayback Machine with every request. */
export const GAZETTE_USER_AGENT =
    process.env.GAZETTE_USER_AGENT ||
    process.env.NEWSLETTER_USER_AGENT ||
    "jhusga-archive/1.0 (unofficial JHU SGA archive; +https://jhusga.org)";

/**
 * How long to wait between requests to the Wayback Machine, in milliseconds.
 *
 * The Internet Archive throttles heavy readers and answers a client that
 * ignores the throttle by refusing it for a while. Four seconds is about
 * fifteen requests a minute, which it tolerates for long runs. A full backfill
 * is around twelve thousand articles, so it is a job of many hours spread over
 * as many runs as it takes; nothing it stores is fetched again.
 */
export const GAZETTE_REQUEST_DELAY_MS = Number(process.env.GAZETTE_REQUEST_DELAY_MS || 4_000);

export const GAZETTE_MAX_RETRIES = 4;
export const GAZETTE_RETRY_BASE_MS = 5_000;

/** The most article captures one run will fetch. */
export const GAZETTE_MAX_ARTICLES_PER_RUN = Number(process.env.GAZETTE_MAX_ARTICLES || 400);

/** The most rows one CDX listing query may return. A year is far below it. */
export const GAZETTE_CDX_LIMIT = 20_000;
