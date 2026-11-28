/**
 * Read-only access to The Johns Hopkins Gazette, through the Wayback Machine.
 *
 * The same idea as lib/newsletter.ts -- a newspaper's coverage of the student
 * government, held as a secondary source and never as an SGA record -- with
 * two differences that shape everything below.
 *
 * First, there is no search. The Gazette's own search is a Google box, JHU's
 * robots.txt forbids crawling /search/, and its hosts refuse automated
 * clients outright (see config/gazette.ts). So candidates come from the
 * Wayback Machine's CDX index, which lists every captured URL under a prefix,
 * and the phrase test runs on every article's text. That is many more fetches
 * than the News-Letter needs, and it is why the backfill is budgeted.
 *
 * Second, the paper lived on three sites in three templates, so there are
 * three parsers. The 1990s and 2000s pages are hand-written HTML tables that
 * change shape every few years; that parser reads the page as blocks of text
 * and discards the site's furniture, rather than trusting any one layout.
 *
 * Nothing here touches the database; lib/gazette-coverage.ts does that. The
 * parsers are checked against cut-down real captures in
 * scripts/gazette.check.ts, with no network.
 */

import {
    GAZETTE_CDX_LIMIT,
    GAZETTE_HUB_LIVE_ORIGIN,
    GAZETTE_HUB_PREFIX,
    GAZETTE_MAX_RETRIES,
    GAZETTE_REQUEST_DELAY_MS,
    GAZETTE_RETRY_BASE_MS,
    GAZETTE_SKIPPED_FILES,
    GAZETTE_SKIPPED_SLUGS,
    GAZETTE_STATIC_LIVE_ORIGIN,
    GAZETTE_STATIC_PREFIXES,
    GAZETTE_USER_AGENT,
    GAZETTE_WORDPRESS_FROM,
    GAZETTE_WORDPRESS_LIVE_ORIGIN,
    GAZETTE_WORDPRESS_PREFIX,
    WAYBACK_ORIGIN,
} from "@/config/gazette";
import { decodeEntities } from "@/lib/newsletter";

/** The `driveFileId` prefix, as `newsletter:` is for the News-Letter. */
export const GAZETTE_FILE_PREFIX = "gazette:";

/** How the archive records that a document came from the Gazette. */
export const GAZETTE_DISCOVERED_VIA = "gazette";

export const GAZETTE_MIME = "text/html";

export type GazetteEra = "static" | "wordpress" | "hub";

/** One archived capture of something that may be an article. */
export type GazetteCapture = {
    /** "gazette:static/2006/09jan06/09mlk.html", the archive's key. */
    fileId: string;
    era: GazetteEra;
    /** The URL as the Wayback Machine captured it. */
    original: string;
    /** The capture's 14-digit Wayback timestamp. */
    timestamp: string;
    /** Where the article lives on JHU's servers today, for a reader to follow. */
    liveUrl: string;
    /** The issue or post date the URL itself states, as YYYY-MM-DD. */
    listedOn: string | null;
};

export type GazetteArticle = {
    fileId: string;
    era: GazetteEra;
    url: string;
    captureUrl: string;
    headline: string;
    subhead: string;
    byline: string;
    publishedOn: string | null;
    paragraphs: string[];
};

const MONTHS = [
    "january", "february", "march", "april", "may", "june",
    "july", "august", "september", "october", "november", "december",
];

const SHORT_MONTHS = MONTHS.map((month) => month.slice(0, 3));

const QUARTERS = ["janmar", "aprjun", "julsep", "octdec"] as const;

function iso(year: number, month: number, day: number): string | null {
    if (!year || month < 1 || month > 12 || day < 1 || day > 31) return null;
    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function fullYear(twoDigit: string): number {
    const value = Number(twoDigit);
    return value >= 90 ? 1900 + value : 2000 + value;
}

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

/**
 * The date a static-era issue folder names, or null.
 *
 * Two spellings, which changed in 2002: "jan0801" (month, day, year) and
 * "09jan06" (day, month, year). "sep1994" reads like a month but is the
 * first spelling -- the issue of September 19, 1994.
 */
export function staticIssueDate(folder: string): string | null {
    const lower = folder.toLowerCase();

    const dayFirst = /^(\d{2})([a-z]{3})(\d{2})$/.exec(lower);
    if (dayFirst) {
        const month = SHORT_MONTHS.indexOf(dayFirst[2]!) + 1;
        return iso(fullYear(dayFirst[3]!), month, Number(dayFirst[1]));
    }

    const monthFirst = /^([a-z]{3})(\d{2})(\d{2})$/.exec(lower);
    if (monthFirst) {
        const month = SHORT_MONTHS.indexOf(monthFirst[1]!) + 1;
        return iso(fullYear(monthFirst[3]!), month, Number(monthFirst[2]));
    }

    return null;
}

/** "jhu.edu", "pages.jh.edu", from a captured URL's host. */
function bareHost(hostname: string): string {
    return hostname.toLowerCase().replace(/^www\./, "");
}

/** "/%7Egazette/1994/" -> "/~gazette/1994/", without decoding anything else. */
function tildePath(pathname: string): string {
    return pathname.replace(/%7e/gi, "~");
}

/**
 * Whether a captured URL is a Gazette article, and its key if it is.
 *
 * The path is the identity, never the host: one static article was captured
 * under www.jhu.edu/~gazette, jhu.edu/gazette and pages.jh.edu/gazette, and all
 * three must land on one row. Issue pages, feeds, print views, images and the
 * job listings fall out here, so nothing downstream needs its own rule for them.
 */
export function gazetteCapture(original: string, timestamp: string): GazetteCapture | null {
    let parsed: URL;
    try {
        parsed = new URL(original);
    } catch {
        return null;
    }

    // "?print", "?printerfriendly=true", "?replytocom=" -- another rendering of
    // a page held under its plain URL, never a page of its own.
    if (parsed.search) return null;

    const host = bareHost(parsed.hostname);
    const path = tildePath(parsed.pathname);

    if (host === "jhu.edu" || host === "pages.jh.edu") {
        const match = /^\/~?gazette\/([^/]+)\/([^/]+)\/([^/]+\.html?)$/i.exec(path);
        if (!match) return null;
        const [, folder, issue, file] = match as unknown as [string, string, string, string];

        const yearFolder = /^\d{4}$/.test(folder);
        const quarterFolder = new RegExp(`^(?:${QUARTERS.join("|")})\\d{2}$`, "i").test(folder);
        if (!yearFolder && !quarterFolder) return null;

        const listedOn = staticIssueDate(issue);
        if (!listedOn) return null;
        if (/^index\.html?$/i.test(file) || GAZETTE_SKIPPED_FILES.test(file)) return null;

        const relative = `${folder}/${issue}/${file}`;
        return {
            fileId: `${GAZETTE_FILE_PREFIX}static/${relative.toLowerCase()}`,
            era: "static",
            original,
            timestamp,
            liveUrl: `${GAZETTE_STATIC_LIVE_ORIGIN}${relative}`,
            listedOn,
        };
    }

    if (host === "gazette.jhu.edu") {
        const match = /^\/(\d{4})\/(\d{2})\/(\d{2})\/([^/]+)\/?$/.exec(path);
        if (!match) return null;
        const [, year, month, day, slug] = match as unknown as [string, string, string, string, string];

        const listedOn = iso(Number(year), Number(month), Number(day));
        // Posts dated before the WordPress site launched are the static
        // issues imported into it. The static era already holds those.
        if (!listedOn || listedOn < GAZETTE_WORDPRESS_FROM) return null;
        if (GAZETTE_SKIPPED_SLUGS.test(slug)) return null;

        const relative = `${year}/${month}/${day}/${slug.toLowerCase()}`;
        return {
            fileId: `${GAZETTE_FILE_PREFIX}wp/${relative}`,
            era: "wordpress",
            original,
            timestamp,
            liveUrl: `${GAZETTE_WORDPRESS_LIVE_ORIGIN}${relative}/`,
            listedOn,
        };
    }

    if (host === "hub.jhu.edu") {
        const match = /^\/gazette\/(\d{4})\/([a-z-]+)\/([^/]+)\/?$/i.exec(path);
        if (!match) return null;
        const [, year, month, slug] = match as unknown as [string, string, string, string];

        const relative = `${year}/${month.toLowerCase()}/${slug.toLowerCase()}`;
        return {
            fileId: `${GAZETTE_FILE_PREFIX}hub/${relative}`,
            era: "hub",
            original,
            timestamp,
            liveUrl: `${GAZETTE_HUB_LIVE_ORIGIN}${relative}/`,
            // The issue is a month, sometimes two ("november-december"); the
            // page's own timestamp dates the article.
            listedOn: null,
        };
    }

    return null;
}

export function isGazetteFileId(fileId: string): boolean {
    return fileId.startsWith(GAZETTE_FILE_PREFIX);
}

/** The raw bytes of one capture, without the Wayback Machine's toolbar. */
export function captureUrl(capture: Pick<GazetteCapture, "timestamp" | "original">): string {
    return `${WAYBACK_ORIGIN}/web/${capture.timestamp}id_/${capture.original}`;
}

// ---------------------------------------------------------------------------
// Listing
// ---------------------------------------------------------------------------

/**
 * The CDX prefixes that hold one year of the Gazette.
 *
 * 1995 to 1998 were filed by quarter ("octdec96"), so those years are four
 * folders on each static host rather than one. A year folder is asked for
 * every static year anyway: it is one cheap request, and 1994 and 1999 on are
 * filed that way.
 */
export function yearPrefixes(year: number): string[] {
    const prefixes: string[] = [];

    if (year <= 2009) {
        for (const host of GAZETTE_STATIC_PREFIXES) {
            prefixes.push(`${host}${year}/`);
            if (year >= 1995 && year <= 1998) {
                const yy = String(year).slice(2);
                for (const quarter of QUARTERS) prefixes.push(`${host}${quarter}${yy}/`);
            }
        }
    }
    if (year >= 2009 && year <= 2012) prefixes.push(`${GAZETTE_WORDPRESS_PREFIX}${year}/`);
    if (year >= 2012) prefixes.push(`${GAZETTE_HUB_PREFIX}${year}/`);

    return prefixes;
}

/** The CDX query for every successful HTML capture under a prefix. */
export function cdxUrl(prefix: string): string {
    const params = new URLSearchParams({
        url: prefix,
        matchType: "prefix",
        // Earliest capture per URL: closest to publication, and before any
        // later redesign wrapped the page in a new template.
        collapse: "urlkey",
        fl: "timestamp,original",
        output: "json",
        limit: String(GAZETTE_CDX_LIMIT),
    });
    params.append("filter", "statuscode:200");
    params.append("filter", "mimetype:text/html");
    return `${WAYBACK_ORIGIN}/cdx/search/cdx?${params.toString()}`;
}

/**
 * The articles a CDX answer lists, one capture per article.
 *
 * The same article appears under several hosts and spellings; the earliest
 * capture wins, for the reason given in `cdxUrl`.
 */
export function parseCdx(json: string): GazetteCapture[] {
    let rows: unknown;
    try {
        rows = JSON.parse(json);
    } catch {
        return [];
    }
    if (!Array.isArray(rows)) return [];

    const found = new Map<string, GazetteCapture>();
    for (const row of rows.slice(1)) {
        if (!Array.isArray(row) || typeof row[0] !== "string" || typeof row[1] !== "string") continue;
        const capture = gazetteCapture(row[1], row[0]);
        if (!capture) continue;
        const known = found.get(capture.fileId);
        if (!known || capture.timestamp < known.timestamp) found.set(capture.fileId, capture);
    }
    return [...found.values()];
}

/** Merge listings from several prefixes, keeping the earliest capture of each. */
export function mergeCaptures(lists: GazetteCapture[][]): GazetteCapture[] {
    const found = new Map<string, GazetteCapture>();
    for (const capture of lists.flat()) {
        const known = found.get(capture.fileId);
        if (!known || capture.timestamp < known.timestamp) found.set(capture.fileId, capture);
    }
    return [...found.values()].sort((left, right) =>
        (left.listedOn ?? left.fileId).localeCompare(right.listedOn ?? right.fileId) ||
        left.fileId.localeCompare(right.fileId));
}

// ---------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------

/** Markup off, entities decoded, whitespace collapsed to one line. */
function textOf(html: string): string {
    return decodeEntities(html.replace(/<br\s*\/?>/gi, " ").replace(/<[^>]*>/g, ""))
        .replace(/\s+/g, " ")
        .trim();
}

const LINE = "\u0001";
const BLOCK = "\u0002";

/**
 * An HTML fragment as the paragraphs a reader sees.
 *
 * The source wraps prose at sixty columns, so its own newlines are spaces.
 * Paragraphs are what the markup breaks: a block element, or two `<br>`s in a
 * row, which is how the 1990s pages separate items in a list of notices.
 */
export function blocksOf(html: string): string[] {
    const marked = html
        .replace(/<!--[\s\S]*?-->/g, " ")
        .replace(/<(script|style|iframe|noscript|form|select|textarea|object)\b[\s\S]*?<\/\1\s*>/gi, " ")
        .replace(/\s+/g, " ")
        .replace(/<br\s*\/?>/gi, LINE)
        .replace(
            /<\/?(?:p|div|td|th|tr|table|tbody|h[1-6]|hr|blockquote|li|ul|ol|center|pre|dd|dt|dl|section|article|header|footer|figure|figcaption)\b[^>]*>/gi,
            BLOCK,
        );

    return marked
        .split(BLOCK)
        .flatMap((block) => block.split(new RegExp(`(?:\\s*${LINE}\\s*){2,}`)))
        .map((block) => textOf(block.replaceAll(LINE, " ")))
        .filter((block) => /[\p{L}\p{N}]/u.test(block));
}

/**
 * A `<pre>` page as paragraphs: the 1994 issues were plain text in a frame.
 *
 * A rule of hyphens separates sections, an indented line opens a paragraph,
 * and every other line continues the one above.
 */
export function preBlocks(text: string): string[] {
    const paragraphs: string[] = [];
    let current: string[] = [];
    const flush = () => {
        const joined = current.join(" ").replace(/\s+/g, " ").trim();
        if (joined) paragraphs.push(joined);
        current = [];
    };

    for (const raw of decodeEntities(text.replace(/<[^>]*>/g, "")).split(/\r?\n/)) {
        if (/^\s*[-=_*]{4,}\s*$/.test(raw) || raw.trim() === "") {
            flush();
            continue;
        }
        if (/^\s{2,}\S/.test(raw) || /^\t/.test(raw)) flush();
        current.push(raw.trim());
    }
    flush();

    return paragraphs;
}

/**
 * The site's furniture, which is never part of an article.
 *
 * Most of it is outside the region a parser reads, but the region is found by
 * comments and conventions that every template did not keep, so this is the
 * second fence.
 */
const CHROME = [
    /^go (?:back )?to (?:the )?(?:previous page|gazette homepage|gazette front page)/i,
    // "GO TO MARCH 19, 2001 TABLE OF CONTENTS.", "GO TO THE GAZETTE HOME PAGE.",
    // and both run together when the template puts them in one cell.
    /^(?:go to\b.{0,60}?\b(?:table of contents|front page|home ?page)\.?\s*)+$/i,
    // The issue's dateline and volume, which the 1999-2002 template sets in
    // bold above the headline: "Jan. 25, 1999", "VOL. 28, NO. 19"; in early
    // 1998 without the comma, "Mar. 23 1998".
    /^[a-z]{3,9}\.? \d{1,2},? \d{4}(?: vol\.? \d+,? no\.? \d+)?$/i,
    /^vol\.? \d+,? no\.? \d+$/i,
    /^the gazette \| the johns hopkins university \|/i,
    /^(?:about the gazette|search|back issues|contact us|gazette@jhu\.edu)$/i,
    /^the newspaper of the johns hopkins university$/i,
    /^[a-z]+ \d{1,2}, \d{4} \| vol\.? \d+ no\.? \d+$/i,
    /^(?:the )?johns hopkins gazette$/i,
    /^more from the gazette:?$/i,
    /^filed under\b/i,
    /^tags:/i,
];

function isChrome(block: string): boolean {
    return CHROME.some((pattern) => pattern.test(block));
}

/**
 * The inner HTML of the element `open` matched, found by counting `<div>`s.
 * The same rule as in lib/newsletter.ts, for the same reason.
 */
function divContents(html: string, openIndex: number, openLength: number): { inner: string; end: number } | null {
    const start = openIndex + openLength;
    let depth = 1;

    for (const tag of html.slice(start).matchAll(/<(\/?)div\b/gi)) {
        depth += tag[1] ? -1 : 1;
        if (depth === 0) {
            const close = start + tag.index;
            const end = html.indexOf(">", close) + 1;
            return { inner: html.slice(start, close), end: end || html.length };
        }
    }
    return null;
}

/** The fragment with every `<div>` whose class matches `pattern` removed, nesting and all. */
function withoutDivs(html: string, pattern: RegExp): string {
    let result = html;
    for (;;) {
        const open = new RegExp(`<div\\b[^>]*class="[^"]*(?:${pattern.source})[^"]*"[^>]*>`, "i").exec(result);
        if (!open) return result;
        const contents = divContents(result, open.index, open[0].length);
        if (!contents) return result.slice(0, open.index);
        result = result.slice(0, open.index) + " " + result.slice(contents.end);
    }
}

/** A leading "By So-and-so" line: short, and not a sentence. */
const BYLINE = /^By\s+([^.?!]{2,100}?)\.?$/;

function takeByline(paragraphs: string[]): string {
    for (let index = 0; index < Math.min(3, paragraphs.length); index += 1) {
        const match = BYLINE.exec(paragraphs[index]!);
        if (match) {
            paragraphs.splice(index, 1);
            return match[1]!.trim();
        }
    }
    return "";
}

/** "November 1, 2010" anywhere in a string -> "2010-11-01". */
function isoFromText(text: string): string | null {
    const match = /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),?\s*((?:19|20)\d{2})\b/i.exec(text);
    if (!match) return null;
    return iso(Number(match[3]), MONTHS.indexOf(match[1]!.toLowerCase()) + 1, Number(match[2]));
}

/**
 * Bytes as text. Pages from the 1990s are Latin-1 with no declaration, and
 * decoding them as UTF-8 would turn "Collège" into a replacement character, so
 * UTF-8 is tried strictly and anything that is not valid UTF-8 is read as
 * windows-1252, which is what an unlabelled Western page of that age is.
 */
export function decodePage(bytes: Uint8Array): string {
    try {
        return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
        return new TextDecoder("latin1").decode(bytes);
    }
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

type Parsed = Omit<GazetteArticle, "fileId" | "era" | "url" | "captureUrl">;

/** The earliest heading-like element in a fragment: what a static page uses as its headline. */
function staticHeadline(region: string): { text: string; index: number } | null {
    const candidates = [
        /<h[1-4]\b[^>]*>([\s\S]*?)<\/h[1-4]>/gi,
        /<font\b[^>]*\bsize="?(?:\+[1-9]|[4-7])"?[^>]*>([\s\S]*?)<\/font>/gi,
        /<(?:b|strong)\b[^>]*>([\s\S]*?)<\/(?:b|strong)>/gi,
    ];

    let best: { text: string; index: number } | null = null;
    for (const pattern of candidates) {
        for (const match of region.matchAll(pattern)) {
            const text = textOf(match[1]!);
            if (text.length < 3 || text.length > 200 || isChrome(text) || !/\p{L}/u.test(text)) continue;
            if (!best || match.index < best.index) best = { text, index: match.index };
            break;
        }
    }
    return best;
}

function parseStatic(html: string, capture: GazetteCapture): Parsed | null {
    // From 2003 the template marks its own content area. Before that the page
    // is a body with a masthead image above and two navigation links below.
    const begin = /<!--\s*begin table:? page content\s*-->/i.exec(html);
    const end = /<!--\s*end of copy\s*-->|<!--\s*end table:? page content\s*-->/i.exec(html.slice(begin ? begin.index : 0));
    let region: string;
    if (begin && end) {
        region = html.slice(begin.index, begin.index + end.index);
    } else {
        const bodies = [...html.matchAll(/<body\b[^>]*>/gi)];
        const start = bodies.length ? bodies.at(-1)!.index + bodies.at(-1)![0].length : 0;
        region = html.slice(start);
        // 1999-2002 mark where the footer starts.
        const marked = /<!--\s*footer\s*-->/i.exec(region);
        if (marked) region = region.slice(0, marked.index);
        const footer = /<hr\b[^>]*>\s*(?:<[^>]+>\s*)*<a href="(?:index\.html?|\.\/)">\s*go back/i.exec(region) ??
            /<a href="[^"]*">\s*go back to previous page/i.exec(region);
        if (footer) region = region.slice(0, footer.index);
    }

    const pre = /<pre\b[^>]*>([\s\S]*?)<\/pre>/i.exec(region);
    let paragraphs: string[];
    let headline: string;

    if (pre && pre[1]!.replace(/<[^>]*>/g, "").trim().length > region.replace(/<[^>]*>/g, "").trim().length / 2) {
        paragraphs = preBlocks(pre[1]!).filter((block) => !isChrome(block));
        headline = paragraphs.shift() ?? "";
    } else {
        paragraphs = blocksOf(region).filter((block) => !isChrome(block));
        const found = staticHeadline(region);
        headline = found?.text ?? "";
        // Everything up to the headline is masthead; the headline itself is
        // stored once, as the headline.
        const at = paragraphs.findIndex((block, index) => index < 6 && (block === headline || block.startsWith(`${headline} `)));
        if (at >= 0) {
            const rest = paragraphs[at]!.slice(headline.length).trim();
            paragraphs.splice(0, at + 1, ...(rest ? [rest] : []));
        }
    }

    if (!headline) return null;
    const byline = takeByline(paragraphs);
    if (paragraphs.length === 0) return null;

    const title = /<title>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? "";
    return {
        headline,
        subhead: "",
        byline,
        publishedOn: capture.listedOn ?? isoFromText(textOf(title)),
        paragraphs,
    };
}

function parseWordpress(html: string, capture: GazetteCapture): Parsed | null {
    const postarea = /<div\b[^>]*class="[^"]*\bpostarea\b[^"]*"[^>]*>/i.exec(html);
    const scope = postarea ? html.slice(postarea.index) : html;

    const h1 = /<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(scope);
    const headline = textOf(h1?.[1] ?? "");
    if (!h1 || !headline) return null;

    let start = h1.index + h1[0].length;
    const dateOpen = /<div\b[^>]*class="date"[^>]*>/i.exec(scope.slice(start));
    let dateBlock = "";
    if (dateOpen) {
        const contents = divContents(scope, start + dateOpen.index, dateOpen[0].length);
        if (contents) {
            dateBlock = contents.inner;
            start = contents.end;
        }
    }

    const tail = scope.slice(start);
    const stop = /<div id="hidefromprint">\s*<p>\s*More from|<div\b[^>]*class="postmeta"|<div\b[^>]*id="comments"|<h3\b[^>]*id="comments"|<div\b[^>]*id="respond"|<div\b[^>]*id="contentright"/i.exec(tail);
    const region = withoutDivs(stop ? tail.slice(0, stop.index) : tail, /wp-caption/);

    const paragraphs = blocksOf(region).filter((block) => !isChrome(block));
    let byline = textOf(/<span class="time2">([\s\S]*?)<\/span>/i.exec(dateBlock)?.[1] ?? "").replace(/^by\s+/i, "");
    if (!byline) byline = takeByline(paragraphs);
    if (paragraphs.length === 0) return null;

    return {
        headline,
        subhead: "",
        byline,
        publishedOn: isoFromText(textOf(/<span class="time">([\s\S]*?)<\/span>/i.exec(dateBlock)?.[1] ?? "")) ?? capture.listedOn,
        paragraphs,
    };
}

function parseHub(html: string, capture: GazetteCapture): Parsed | null {
    // The masthead is an <h1 class="masthead">; the headline is the bare one.
    const h1 = /<h1>([\s\S]*?)<\/h1>/i.exec(html);
    const og = /<meta property="og:title"\s+content="([^"]*)"/i.exec(html);
    const headline = textOf(h1?.[1] ?? "") || textOf(og?.[1] ?? "");
    if (!headline) return null;

    const open = /<div\b[^>]*class="[^"]*\bbody-content\b[^"]*"[^>]*>/i.exec(html);
    if (!open) return null;
    const body = divContents(html, open.index, open[0].length);
    if (!body) return null;

    const region = withoutDivs(body.inner, /article-inset|gallery|related|share/);
    const paragraphs = blocksOf(region).filter((block) => !isChrome(block));
    if (paragraphs.length === 0) return null;

    // The meta tag arrived in a later template; the earlier one prints the
    // date only in the byline paragraph, after the author's name.
    const pubdate = /<p class="[^"]*\bpubdate\b[^"]*">([\s\S]*?)<\/p>/i.exec(html)?.[1] ?? "";
    const published =
        /<meta property="article:published_time"\s+content="(\d{4}-\d{2}-\d{2})/i.exec(html)?.[1] ??
        isoFromText(textOf(pubdate.replace(/<span class="(?:topics|tags)-in">[\s\S]*?<\/span>/gi, " ")));
    const byline = textOf(/<span class="author">([\s\S]*?)<\/span>/i.exec(html)?.[1] ?? "").replace(/^by\s+/i, "");

    return {
        headline,
        subhead: textOf(/<h2 class="subheadline">([\s\S]*?)<\/h2>/i.exec(html)?.[1] ?? ""),
        byline,
        publishedOn: published ?? capture.listedOn ?? hubIssueMonth(capture.fileId),
        paragraphs,
    };
}

/**
 * Some 2012 pages print no date at all; the address still names the issue
 * ("2012/september", "2015/may-june"). Date the article to the issue's first
 * month, on the 1st, the archive's convention for a month-only date.
 */
function hubIssueMonth(fileId: string): string | null {
    const match = /^gazette:hub\/(\d{4})\/([a-z]+)/.exec(fileId);
    if (!match) return null;
    const month = MONTHS.indexOf(match[2]!) + 1;
    return month ? iso(Number(match[1]), month, 1) : null;
}

/** Everything the archive keeps about one capture, or null when it is not a readable article. */
export function parseCapture(html: string, capture: GazetteCapture): GazetteArticle | null {
    const parsed =
        capture.era === "static" ? parseStatic(html, capture) :
        capture.era === "wordpress" ? parseWordpress(html, capture) :
        parseHub(html, capture);
    if (!parsed) return null;

    return {
        ...parsed,
        fileId: capture.fileId,
        era: capture.era,
        url: capture.liveUrl,
        captureUrl: captureUrl(capture),
    };
}

/** "2006-01-09" -> "January 9, 2006". */
function formatPublished(value: string): string {
    const [year, month, day] = value.split("-");
    const name = MONTHS[Number(month) - 1];
    if (!name) return value;
    return `${name[0]!.toUpperCase()}${name.slice(1)} ${Number(day)}, ${year}`;
}

/**
 * The article as the archive stores it: headline, deck, attribution, body.
 *
 * The attribution names the paper and the capture the text was read from. The
 * capture matters more here than for the News-Letter: the text is the Wayback
 * Machine's copy, and a reader checking a quotation should be able to find
 * exactly the page it came from.
 */
export function gazetteMarkdown(article: GazetteArticle): string {
    const attribution = [
        article.byline && `By ${article.byline}`,
        "The Johns Hopkins Gazette",
        article.publishedOn && formatPublished(article.publishedOn),
    ].filter(Boolean);

    return [
        `# ${article.headline}`,
        article.subhead,
        `*${attribution.join(" · ")}*`,
        ...article.paragraphs,
        `*Text read from the Internet Archive's capture: ${article.captureUrl.replace("id_/", "/")}*`,
    ]
        .filter(Boolean)
        .join("\n\n");
}

/** The body alone, for the listing blurb. */
export function gazetteBody(article: GazetteArticle): string {
    return article.paragraphs.join("\n\n");
}

/** Headline, deck and body: what the phrase test reads. Not the attribution. */
export function gazetteSearchableText(article: GazetteArticle): string {
    return [article.headline, article.subhead, ...article.paragraphs].join("\n");
}

// ---------------------------------------------------------------------------
// Fetching
// ---------------------------------------------------------------------------

export class GazetteBudgetReached extends Error {
    constructor() {
        super("Gazette request budget reached");
    }
}

let lastRequestAt = 0;

/** Every request to the Wayback Machine waits on one clock, so no path can crawl faster. */
async function waitForTurn(deadline: number): Promise<void> {
    const wait = lastRequestAt + GAZETTE_REQUEST_DELAY_MS - Date.now();
    if (Date.now() + Math.max(0, wait) >= deadline) throw new GazetteBudgetReached();
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    lastRequestAt = Date.now();
}

/**
 * One request, retrying what is worth retrying.
 *
 * 429 and 5xx are the Internet Archive asking for a pause, and so is a dropped
 * connection, which is how it often sheds load. Anything else is an answer.
 */
async function waybackFetch(url: string, deadline: number, attempt = 0): Promise<Response | null> {
    await waitForTurn(deadline);
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new GazetteBudgetReached();

    let response: Response | null = null;
    try {
        response = await fetch(url, {
            headers: { "User-Agent": GAZETTE_USER_AGENT },
            cache: "no-store",
            signal: AbortSignal.timeout(Math.min(60_000, remaining)),
        });
    } catch (cause) {
        if (Date.now() >= deadline) throw new GazetteBudgetReached();
        if (attempt >= GAZETTE_MAX_RETRIES) throw cause;
    }

    if (response && !(response.status === 429 || response.status >= 500)) return response;
    if (attempt >= GAZETTE_MAX_RETRIES) return response;

    await response?.body?.cancel();
    const backoffMs = GAZETTE_RETRY_BASE_MS * 2 ** attempt;
    if (Date.now() + backoffMs >= deadline) throw new GazetteBudgetReached();
    await new Promise((resolve) => setTimeout(resolve, backoffMs));
    return waybackFetch(url, deadline, attempt + 1);
}

/** Every article capture under one prefix. Throws when the index will not answer. */
export async function listPrefix(prefix: string, deadline = Infinity): Promise<GazetteCapture[]> {
    const response = await waybackFetch(cdxUrl(prefix), deadline);
    if (!response || !response.ok) {
        throw new Error(`Wayback CDX listing for ${prefix} failed (${response?.status ?? "no response"})`);
    }
    return parseCdx(await response.text());
}

/** Every article capture for one year, across every site that year's issues lived on. */
export async function listYear(
    year: number,
    options: { deadline?: number; onPrefix?: (prefix: string, found: number) => void } = {},
): Promise<GazetteCapture[]> {
    const lists: GazetteCapture[][] = [];
    for (const prefix of yearPrefixes(year)) {
        const captures = await listPrefix(prefix, options.deadline);
        options.onPrefix?.(prefix, captures.length);
        lists.push(captures);
    }
    return mergeCaptures(lists);
}

/** One capture, parsed, or null when it is gone or is not a readable article. */
export async function fetchCapture(capture: GazetteCapture, deadline = Infinity): Promise<GazetteArticle | null> {
    const response = await waybackFetch(captureUrl(capture), deadline);
    if (!response || !response.ok) {
        await response?.body?.cancel();
        return null;
    }
    const html = decodePage(new Uint8Array(await response.arrayBuffer()));
    return parseCapture(html, capture);
}
