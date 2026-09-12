/**
 * Read-only access to The Johns Hopkins News-Letter's archive.
 *
 * Everything else in this pipeline ingests documents the SGA wrote. This
 * module ingests documents *about* the SGA, written by the student newspaper
 * that has covered it since it was called Student Council. The distinction is
 * the whole reason the module exists separately: a News-Letter article is a
 * secondary source, nobody in the SGA owns it, nobody can edit it, and the
 * archive must never let one be read as a record of what the SGA decided.
 *
 * There is no API. The paper runs SNworks' Gryphon CMS, whose only machine
 * -readable surface is one RSS feed of recent content -- useless for reaching
 * 2001. So the search page is read, which is stable in the ways that matter:
 * results are `<article class="clearfix">` blocks each holding one link, and
 * every article page carries a schema.org NewsArticle block.
 *
 * Two properties of that search shape the code more than anything else:
 *
 *   - It caps a query at 1000 hits and reports the cap as if it were a count,
 *     so a query covering the whole archive cannot be enumerated. Every search
 *     here is therefore fenced to one calendar year.
 *   - Its last page still renders a "Next" link, so pagination cannot say when
 *     it has finished. A page with no result blocks is the terminator.
 *
 * Nothing here touches the database; see lib/coverage.ts for that. Keeping the
 * split means the parsing rules can be checked against fixture HTML with no
 * network and no environment, which is what scripts/newsletter.check.ts does.
 */

import {
    NEWSLETTER_MAX_RETRIES,
    NEWSLETTER_ORIGIN,
    NEWSLETTER_PHRASES,
    NEWSLETTER_REQUEST_DELAY_MS,
    NEWSLETTER_RESULTS_PER_PAGE,
    NEWSLETTER_RETRY_BASE_MS,
    NEWSLETTER_USER_AGENT,
    type NewsletterPhrase,
} from "@/config/newsletter";

/** The `driveFileId` prefix, as `sharepoint:` is for a Microsoft share. */
export const NEWSLETTER_FILE_PREFIX = "newsletter:";

/** The mime type stored for an article, which arrives as a web page. */
export const NEWSLETTER_MIME = "text/html";

/** How the archive records that a document came from the paper, not Drive. */
export const NEWSLETTER_DISCOVERED_VIA = "newsletter";

/**
 * An article URL: `/article/<year>/<month>/<slug>`.
 *
 * The slug carries a numeric suffix on articles digitised out of print
 * ("...-16915") and none on articles published online, so it is opaque and
 * kept whole.
 */
const ARTICLE_PATH = /^\/article\/((?:19|20)\d{2})\/(\d{2})\/([^/?#]+)$/;

/** One result in the search listing. Each block holds exactly one link. */
const RESULT_BLOCK = /<article class="clearfix">([\s\S]*?)<\/article>/g;

/** The result's headline and the URL it links to. */
const RESULT_LINK = /<h4>\s*<a href="([^"]+)"[^>]*>([\s\S]*?)<\/a>\s*<\/h4>/;

/** "(12/03/15 7:06pm)" -- when the listing says the article went up. */
const RESULT_TIMESTAMP = /\((\d{2})\/(\d{2})\/(\d{2})\s/;

/** The schema.org block every article page carries. */
const JSON_LD =
    /<script[^>]+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/i;

const HEADLINE = /<h1[^>]*class="headline"[^>]*>([\s\S]*?)<\/h1>/i;
const SUBHEAD = /<h2[^>]*class="subhead"[^>]*>([\s\S]*?)<\/h2>/i;

/**
 * The block the headline sits in, which is also where the date is.
 *
 * Two eras of template, and the older one is why this is a block rather than a
 * selector. Since about 2016 the byline and date are one `<p class="authors">`;
 * before that the date is bare text after the subhead with no element around
 * it at all, and the byline is not in this block -- it is the first paragraph
 * of the body. Taking the whole block and reading a date out of its text
 * handles both without knowing which era a page is from.
 */
const MASTHEAD = /<h1[^>]*class="headline"[^>]*>[\s\S]*?<\/article>/i;

const AUTHORS = /<p[^>]*class="authors"[^>]*>([\s\S]*?)<\/p>/i;

/**
 * A byline the older template left sitting in the body: "By KAREN SHENG For
 * The News-Letter", "By ABBY BIESMAN and CATHERINE PALMER".
 *
 * Bounded hard, because "By the time the Senate voted, the room had emptied"
 * is a first sentence and not a byline. A byline carries no full stop and runs
 * to a few words; a sentence does both the other way round. Getting this wrong
 * either way is visible -- the reporter's name would be missing from the byline
 * the archive writes, or the article's first sentence would be.
 */
const LEADING_BYLINE = /^By\s+([^.?!]{2,80})$/;

/** How the older template signs a contributor who is not on staff. */
const BYLINE_TRAILER = /\s+for\s+the\s+news-letter\s*$/i;

/** Where the article body starts. Its end is found by counting divs. */
const CONTENT_OPEN = /<div[^>]*class="[^"]*\barticle-content\b[^"]*"[^>]*>/i;

const PARAGRAPH = /<p\b[^>]*>([\s\S]*?)<\/p>/g;

/** "| November 20, 2025" at the end of the byline. */
const BYLINE_DATE =
    /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),\s*((?:19|20)\d{2})\b/;

const MONTHS = [
    "january", "february", "march", "april", "may", "june",
    "july", "august", "september", "october", "november", "december",
];

/**
 * The named entities the CMS actually emits, plus the ones a headline carries.
 *
 * Numeric references are handled generically below; this covers the rest. The
 * search page escapes aggressively -- every space in a `title` attribute
 * arrives as `&#x20;` -- so decoding is not optional politeness.
 */
const NAMED_ENTITIES: Record<string, string> = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    apos: "'",
    nbsp: " ",
    ndash: "\u2013",
    mdash: "\u2014",
    lsquo: "\u2018",
    rsquo: "\u2019",
    ldquo: "\u201c",
    rdquo: "\u201d",
    hellip: "\u2026",
};

const ENTITY = /&(?:#(\d+)|#[xX]([0-9a-fA-F]+)|([a-zA-Z][a-zA-Z0-9]*));/g;

export function decodeEntities(text: string): string {
    return text.replace(ENTITY, (whole, decimal, hex, name) => {
        if (decimal) return String.fromCodePoint(Number(decimal));
        if (hex) return String.fromCodePoint(Number.parseInt(hex, 16));
        return NAMED_ENTITIES[name.toLowerCase()] ?? whole;
    });
}

/**
 * Markup off, entities decoded, whitespace collapsed to one line.
 *
 * An inline tag is removed rather than replaced with a space, and a `<br>` is
 * the exception. Spacing out `</a>` turns "including <a>ADA compliance</a>."
 * into a sentence with a gap before its full stop, and this text is what
 * citations quote verbatim: a stray space is a quote that will not anchor.
 * The source already spaces the words either side of a tag; only a line break
 * stands in for a space that is not written down.
 */
function textOf(html: string): string {
    return decodeEntities(
        html.replace(/<br\s*\/?>/gi, " ").replace(/<[^>]*>/g, ""),
    )
        .replace(/\s+/g, " ")
        .trim();
}

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

/**
 * The archive key for an article, or null when the URL is not one.
 *
 * The path is the identity, not the full URL: the same article is linked with
 * and without `www`, over http and https, and with tracking parameters on the
 * end. Reducing it to `newsletter:2025/11/<slug>` is what makes the three
 * searches and the pages within each converge on one row rather than four.
 */
export function newsletterFileId(url: string): string | null {
    let parsed: URL;
    try {
        parsed = new URL(url, NEWSLETTER_ORIGIN);
    } catch {
        return null;
    }

    if (!/(?:^|\.)jhunewsletter\.com$/i.test(parsed.hostname)) return null;

    const match = ARTICLE_PATH.exec(parsed.pathname.replace(/\/+$/, ""));
    if (!match) return null;

    return `${NEWSLETTER_FILE_PREFIX}${match[1]}/${match[2]}/${match[3]}`;
}

export function isNewsletterFileId(fileId: string): boolean {
    return fileId.startsWith(NEWSLETTER_FILE_PREFIX);
}

/** The canonical URL to fetch and to link a reader at. */
export function newsletterArticleUrl(fileId: string): string {
    return `${NEWSLETTER_ORIGIN}/article/${fileId.slice(NEWSLETTER_FILE_PREFIX.length)}`;
}

// ---------------------------------------------------------------------------
// Phrase matching
// ---------------------------------------------------------------------------

/**
 * What each phrase is allowed to look like in running prose.
 *
 * Word-bounded on both sides, because the alternative is a false positive that
 * cannot be argued with: `sga` unbounded matches the surname "Sgarlata", and
 * the archive would be asserting that an article about a lacrosse player is
 * coverage of the student government.
 *
 * The trailing `(?:'s|s|'s)` is deliberate rather than accidental. "the SGA's
 * budget" and "both SGAs" are about the SGA; a bare `\bsga\b` rejects the
 * second because "s" is a word character, and a bare `\bsga` accepts
 * "Sgarlata". Naming the endings that are allowed accepts one and refuses the
 * other. Internal whitespace is `\s+` so a phrase broken across a line in the
 * source still matches.
 */
const PHRASE_PATTERNS: Record<NewsletterPhrase, RegExp> = {
    "sga": /\bsga(?:['\u2019]?s)?\b/i,
    "student government": /\bstudent\s+governments?(?:['\u2019]s)?\b/i,
    "student council": /\bstudent\s+councils?(?:['\u2019]s)?\b/i,
};

/**
 * Which of the archive's phrases the text actually contains.
 *
 * Called on the article this code fetched, never on the search listing: the
 * paper's engine stems words, searches the whole page including the navigation
 * that says "Student Government" on every article it has ever published, and
 * happily returns a piece that mentions none of these phrases. So a candidate
 * is a candidate until its own text says otherwise, and the phrases that put it
 * in the archive are recorded so a reader can see why it is here.
 *
 * Returned in the order they are configured, so the value is stable enough to
 * store and compare.
 */
export function matchedPhrases(text: string): NewsletterPhrase[] {
    return NEWSLETTER_PHRASES.filter((phrase) => PHRASE_PATTERNS[phrase].test(text));
}

// ---------------------------------------------------------------------------
// Searching
// ---------------------------------------------------------------------------

/**
 * The advanced-search URL for one phrase in one calendar year.
 *
 * The date fence is what keeps the query under the engine's 1000-hit cap; see
 * NEWSLETTER_SEARCH_RESULT_CAP. `o=date` orders newest first, which matters
 * only in that it makes a truncated page's contents predictable.
 */
export function searchUrl(input: {
    phrase: string;
    year: number;
    page: number;
}): string {
    const params = new URLSearchParams({
        a: "1",
        s: input.phrase,
        ti: "",
        ts_month: "1",
        ts_day: "1",
        ts_year: String(input.year),
        te_month: "12",
        te_day: "31",
        te_year: String(input.year),
        au: "",
        ty: "0",
        o: "date",
        page: String(input.page),
        per_page: String(NEWSLETTER_RESULTS_PER_PAGE),
    });

    return `${NEWSLETTER_ORIGIN}/search?${params.toString()}`;
}

export type SearchResult = {
    /** The archive key, so callers can deduplicate before fetching anything. */
    fileId: string;
    url: string;
    headline: string;
    /** The date the listing prints, as `YYYY-MM-DD`, or null. */
    listedOn: string | null;
};

/** "15" -> 2015. The listing prints two digits and the archive starts in 2001. */
function listingYear(twoDigit: string): number {
    return 2000 + Number(twoDigit);
}

/**
 * The articles a search page lists, in the order it lists them.
 *
 * Results that are not articles -- the search covers images and multimedia too
 * -- have a different path and fall out at `newsletterFileId`, so no separate
 * rule is needed to exclude them.
 *
 * The listing's own metadata is deliberately barely read. Its third line is
 * sometimes a byline, sometimes a date, sometimes the first sentence of the
 * piece, and which one is unpredictable; the article page states all three
 * properly. Only the timestamp is taken, as a cross-check on the date the
 * article claims for itself.
 */
export function parseSearchResults(html: string): SearchResult[] {
    const results: SearchResult[] = [];
    const seen = new Set<string>();

    for (const block of html.matchAll(RESULT_BLOCK)) {
        const body = block[1]!;

        const link = RESULT_LINK.exec(body);
        if (!link) continue;

        const fileId = newsletterFileId(decodeEntities(link[1]!));
        if (!fileId || seen.has(fileId)) continue;
        seen.add(fileId);

        const stamp = RESULT_TIMESTAMP.exec(body);
        const listedOn = stamp
            ? `${listingYear(stamp[3]!)}-${stamp[1]}-${stamp[2]}`
            : null;

        results.push({
            fileId,
            url: newsletterArticleUrl(fileId),
            headline: textOf(link[2]!),
            listedOn,
        });
    }

    return results;
}

/**
 * How many hits the engine claims for a search, or null if it did not say.
 *
 * Worth reading only to notice the cap: a window reporting exactly
 * NEWSLETTER_SEARCH_RESULT_CAP is a window whose results are being truncated,
 * and the fence around it needs to be narrower than a year.
 */
export function parseResultCount(html: string): number | null {
    const match = /<strong>([\d,]+) items?<\/strong>/i.exec(html);
    return match ? Number(match[1]!.replace(/,/g, "")) : null;
}

// ---------------------------------------------------------------------------
// Articles
// ---------------------------------------------------------------------------

export type NewsletterArticle = {
    fileId: string;
    url: string;
    headline: string;
    /** The deck under the headline. Usually empty. */
    subhead: string;
    /** "HENRY SERRINGER", as the paper prints it. Empty when unsigned. */
    byline: string;
    /** "News & Features", "Archives" -- the paper's own section. */
    section: string;
    /** The day the paper published it, or null if the page does not say. */
    publishedOn: string | null;
    /** The body, one entry per paragraph, markup off. */
    paragraphs: string[];
};

type ArticleLd = {
    headline?: string;
    dateCreated?: string;
    articleSection?: string;
};

/**
 * The inner HTML of the element `open` matched, found by counting `<div>`s.
 *
 * The body holds figures, captions and pull quotes, all of them divs, so the
 * first `</div>` after the opening tag is usually not its own. A regular
 * expression cannot count, so this does.
 */
function divContents(html: string, open: RegExpExecArray): string | null {
    const start = open.index + open[0].length;
    let depth = 1;

    for (const tag of html.slice(start).matchAll(/<(\/?)div\b/g)) {
        depth += tag[1] ? -1 : 1;
        if (depth === 0) return html.slice(start, start + tag.index);
    }

    return null;
}

/** "November 20, 2025" -> "2025-11-20". */
function isoFromBylineDate(text: string): string | null {
    const match = BYLINE_DATE.exec(text);
    if (!match) return null;

    const month = MONTHS.indexOf(match[1]!.toLowerCase()) + 1;
    const day = Number(match[2]);
    if (month < 1 || day < 1 || day > 31) return null;

    return `${match[3]}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * The calendar date in Baltimore of an instant, as `YYYY-MM-DD`.
 *
 * schema.org gives an instant, and the archive files documents by the day a
 * reader would say they happened on. An article stamped 00:06 UTC went up the
 * previous evening on the campus it is about, and dating it to the next day
 * would file the last meeting of a semester after the semester ended.
 */
function easternDate(instant: string): string | null {
    const parsed = new Date(instant);
    if (Number.isNaN(parsed.getTime())) return null;

    // Assembled from the parts rather than asked for as a formatted string. A
    // locale that would print the ISO order ("en-CA") is not available on a Node
    // built without full ICU and silently falls back to US order, which would
    // store "11/19/2015" in a column parsed by splitting on hyphens -- an
    // article with no date and no session, from a call that looked like it
    // worked. The zone lookup below is tzdata and is always present.
    const parts = new Intl.DateTimeFormat("en-US", {
        timeZone: "America/New_York",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    }).formatToParts(parsed);

    const value = (type: string) =>
        parts.find((part) => part.type === type)?.value ?? "";

    const [year, month, day] = [value("year"), value("month"), value("day")];
    if (year.length !== 4 || month.length !== 2 || day.length !== 2) return null;

    return `${year}-${month}-${day}`;
}

/** The schema.org NewsArticle block, or an empty object when unreadable. */
function articleLd(html: string): ArticleLd {
    const block = JSON_LD.exec(html);
    if (!block) return {};

    try {
        return JSON.parse(block[1]!) as ArticleLd;
    } catch {
        // Malformed metadata is not a failure: the headline, the byline and
        // the date are all printed on the page as well.
        return {};
    }
}

/**
 * Everything the archive keeps about one article, or null when the page is not
 * a readable article.
 *
 * The byline's date is preferred over schema.org's timestamp because it is the
 * publication date the paper itself prints, with no timezone in it to get
 * wrong. The timestamp is the fallback, and a page stating neither is stored
 * undated rather than dated from its URL -- the URL gives a month, and a
 * document filed to the wrong day inside the right month is worse than one the
 * archive admits it cannot date.
 */
export function parseArticle(html: string, url: string): NewsletterArticle | null {
    const fileId = newsletterFileId(url);
    if (!fileId) return null;

    const ld = articleLd(html);

    const headline =
        textOf(HEADLINE.exec(html)?.[1] ?? "") ||
        decodeEntities(ld.headline ?? "").trim();
    if (!headline) return null;

    const open = CONTENT_OPEN.exec(html);
    const body = open ? divContents(html, open) : null;
    if (body === null) return null;

    const paragraphs = [...body.matchAll(PARAGRAPH)]
        .map((paragraph) => textOf(paragraph[1]!))
        .filter(Boolean);
    // A page whose body did not parse is not stored as an empty document: a
    // row holding a headline and nothing else is one no citation can point at.
    if (paragraphs.length === 0) return null;

    // Below the headline and the deck, because a headline can name a date of
    // its own ("SGA to vote on the budget November 20") and that is the day the
    // meeting is, not the day the paper printed.
    const dateline = textOf(
        (MASTHEAD.exec(html)?.[0] ?? "")
            .replace(/<h1[\s\S]*?<\/h1>/i, " ")
            .replace(/<h2[\s\S]*?<\/h2>/i, " "),
    );
    const authors = textOf(AUTHORS.exec(html)?.[1] ?? "");

    // "By HENRY SERRINGER | November 20, 2025" -- the name is what is left once
    // the label and the date are taken off.
    let byline = authors
        .replace(/^by\s+/i, "")
        .replace(/\s*\|.*$/, "")
        .trim();

    // The older template's byline is the body's first paragraph. Moved out of
    // the body rather than left in it, so that the archive's byline names the
    // reporter and the stored text does not open by naming them twice.
    if (!byline) {
        const leading = LEADING_BYLINE.exec(paragraphs[0] ?? "");
        if (leading) {
            byline = leading[1]!.replace(BYLINE_TRAILER, "").trim();
            paragraphs.shift();
        }
    }

    // Stripping the byline can be what empties the body, on a page that is a
    // headline and a credit and nothing else.
    if (paragraphs.length === 0) return null;

    return {
        fileId,
        url: newsletterArticleUrl(fileId),
        headline,
        subhead: textOf(SUBHEAD.exec(html)?.[1] ?? ""),
        byline,
        section: decodeEntities(ld.articleSection ?? "").trim(),
        // The day printed under the headline, wherever in that block it sits,
        // beats the timestamp: it is the paper's own claim and has no timezone
        // in it to get wrong.
        publishedOn:
            isoFromBylineDate(dateline) ??
            (ld.dateCreated ? easternDate(ld.dateCreated) : null),
        paragraphs,
    };
}

/**
 * The article as the archive stores it.
 *
 * A citation is a byte range into this string, so it has to be the text the
 * page renders and it has to be stable across runs: the same article fetched
 * twice must hash the same or every re-run would store a new revision.
 *
 * Laid out as the paper lays it out -- headline, deck, byline, body -- because
 * that is what the document *is*. The byline names the publication as well as
 * the reporter, so the text says who wrote it even when it is read on its own,
 * quoted into a summary, or returned by a search that shows no chrome.
 */
export function articleMarkdown(article: NewsletterArticle): string {
    const attribution = [
        article.byline && `By ${article.byline}`,
        "The Johns Hopkins News-Letter",
        article.publishedOn && formatPublished(article.publishedOn),
    ].filter(Boolean);

    return [
        `# ${article.headline}`,
        article.subhead,
        `*${attribution.join(" · ")}*`,
        ...article.paragraphs,
    ]
        .filter(Boolean)
        .join("\n\n");
}

/** "2025-11-20" -> "November 20, 2025", for the stored byline. */
function formatPublished(iso: string): string {
    const [year, month, day] = iso.split("-");
    const name = MONTHS[Number(month) - 1];
    if (!name) return iso;

    return `${name[0]!.toUpperCase()}${name.slice(1)} ${Number(day)}, ${year}`;
}

/** The body alone, for the listing blurb. The byline is not a description. */
export function articleBody(article: NewsletterArticle): string {
    return article.paragraphs.join("\n\n");
}

// ---------------------------------------------------------------------------
// Fetching
// ---------------------------------------------------------------------------

let lastRequestAt = 0;

/**
 * Hold every request apart by the delay robots.txt asks for.
 *
 * Kept here rather than in the callers so that no path can skip it: the search
 * loop, the article fetch and a retry after a 503 all queue behind the same
 * clock, and adding a caller cannot accidentally make the crawl faster.
 */
async function waitForTurn(): Promise<void> {
    const wait = lastRequestAt + NEWSLETTER_REQUEST_DELAY_MS - Date.now();
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    lastRequestAt = Date.now();
}

/**
 * One request, retrying only what is worth retrying.
 *
 * The same rule as driveFetch: 429 and 5xx are the site asking to be left
 * alone for a moment, and everything else is an answer. A 404 in particular is
 * an article that has been taken down, which is ordinary and must not fail a
 * run -- so the status is returned rather than thrown on, and the caller
 * decides.
 */
async function newsletterFetch(url: string, attempt = 0): Promise<Response> {
    await waitForTurn();

    const response = await fetch(url, {
        headers: { "User-Agent": NEWSLETTER_USER_AGENT },
        cache: "no-store",
    });

    const retriable = response.status === 429 || response.status >= 500;
    if (retriable && attempt < NEWSLETTER_MAX_RETRIES) {
        const backoffMs = NEWSLETTER_RETRY_BASE_MS * 2 ** attempt;
        await new Promise((resolve) => setTimeout(resolve, backoffMs));
        return newsletterFetch(url, attempt + 1);
    }

    return response;
}

/** The HTML of a page, or null when the site will not serve it. */
export async function fetchPage(url: string): Promise<string | null> {
    const response = await newsletterFetch(url);
    if (!response.ok) return null;
    return response.text();
}

/**
 * Every article the paper's search finds for one phrase in one year.
 *
 * Paging stops on the first page that lists nothing, which is the only signal
 * the markup gives: a one-page search still renders a "Next" link pointing at
 * a page two that comes back empty. The page cap above is a guard, not the
 * expected exit.
 */
export async function searchYear(
    phrase: string,
    year: number,
    options: {
        maxPages: number;
        /** `reported` is the engine's own hit count, which may be its cap. */
        onPage?: (page: number, found: number, reported: number | null) => void;
    },
): Promise<SearchResult[]> {
    const found = new Map<string, SearchResult>();

    for (let page = 1; page <= options.maxPages; page += 1) {
        const html = await fetchPage(searchUrl({ phrase, year, page }));
        if (html === null) break;

        const results = parseSearchResults(html);
        options.onPage?.(page, results.length, parseResultCount(html));
        if (results.length === 0) break;

        for (const result of results) found.set(result.fileId, result);
    }

    return [...found.values()];
}

/** One article, parsed, or null when the page is gone or unreadable. */
export async function fetchArticle(url: string): Promise<NewsletterArticle | null> {
    const html = await fetchPage(url);
    if (html === null) return null;
    return parseArticle(html, url);
}
