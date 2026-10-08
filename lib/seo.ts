import type { Metadata } from "next";

import { SESSION_NUMBER, sessionOrdinal } from "@/config/session";
import { truncateAtWord } from "@/lib/cite";

/**
 * What a page says about itself to anything that is not a browser.
 *
 * Search results, Discord, Slack, iMessage and the rest read the <head> and
 * nothing else, so a page whose only metadata is the site's name shows up
 * everywhere as "SGA at JHU" with the same sentence under it. Every page
 * builds its metadata through `pageMetadata` so that what the embed shows is
 * the same thing a reader would see first on the page: a document's summary,
 * a thread's opening lines, the paragraph the home page leads with.
 *
 * Open Graph is replaced wholesale by whichever segment sets it last, not
 * merged, which is why this helper returns the whole object rather than
 * trusting the root layout to fill in the site name and image.
 */

export const SITE_NAME = "SGA at JHU";

export const SITE_TITLE =
    "Student Government Association at Johns Hopkins University";

/** "%s" is the page's own title; the suffix keeps the site name in every tab and embed. */
export const TITLE_TEMPLATE = `%s · ${SITE_NAME}`;

/**
 * Where the site is reachable. Needed to turn the relative image and
 * canonical paths below into the absolute URLs embeds insist on.
 *
 * NEXT_PUBLIC_SITE_URL wins so a preview deploy can describe itself;
 * Vercel's production hostname is next; the domain in the README is last.
 */
export function siteUrl(): URL {
    const configured =
        process.env.NEXT_PUBLIC_SITE_URL ||
        (process.env.VERCEL_PROJECT_PRODUCTION_URL &&
            `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`) ||
        "https://jhusga.org";
    return new URL(configured);
}

/**
 * The square logo, as the thumbnail beside every embed.
 *
 * Square rather than a 1200x630 banner on purpose: with `twitter:card` set to
 * "summary", Discord and Slack render the image as an icon beside the text
 * rather than a billboard above it, which is what a seal looks right as.
 */
export const OG_IMAGE = {
    url: "/og-image.png",
    width: 512,
    height: 512,
    alt: "Seal of the Student Government Association at Johns Hopkins University",
    type: "image/png",
} as const;

/** The site in one sentence, for the pages that have no better one. */
export const DEFAULT_DESCRIPTION =
    "Documents, legislation, meeting minutes, contacts, and a public forum for the " +
    "Student Government Association at Johns Hopkins University.";

/** Longest a description gets before search engines and embeds cut it themselves. */
const DESCRIPTION_MAX = 300;

/** The current session, for descriptions that should say which year they describe. */
export const SESSION_LABEL = `${sessionOrdinal(SESSION_NUMBER)} session`;

/**
 * Metadata for one page.
 *
 * `path` is the canonical path of the page, used for og:url and the canonical
 * link; pass it without the query string unless the query is what makes the
 * page what it is. `noIndex` keeps a page out of search results without
 * hiding it from the embeds people paste into chat: a sign-in form and a
 * composer are reachable but not worth a search engine's time.
 */
export function pageMetadata({
    title,
    description,
    path,
    noIndex = false,
    type = "website",
}: {
    /** The page's own title. Omit for the home page, which uses the site title. */
    title?: string;
    description: string;
    path: string;
    noIndex?: boolean;
    type?: "website" | "article";
}): Metadata {
    const text = tidyDescription(description);

    return {
        ...(title ? { title } : {}),
        description: text,
        alternates: { canonical: path },
        openGraph: {
            type,
            siteName: SITE_NAME,
            locale: "en_US",
            url: path,
            // Title and description are left unset so they inherit the
            // resolved page title (template applied) and description above.
            images: [OG_IMAGE],
        },
        twitter: {
            card: "summary",
        },
        ...(noIndex ? { robots: { index: false, follow: true } } : {}),
    };
}

/**
 * Prose to one line, cut at a word, within what a snippet will show.
 *
 * Body text arrives as paragraphs, bulleted restatements, and whatever a
 * poster typed; a description is one run of plain text.
 */
export function tidyDescription(text: string, max: number = DESCRIPTION_MAX): string {
    return truncateAtWord(text, max);
}
