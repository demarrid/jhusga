/**
 * Storing The Johns Hopkins Gazette's coverage of the student government.
 *
 * The run is the News-Letter backfill's (lib/coverage.ts) with the search
 * replaced by a listing: for each year, the Wayback Machine's index names
 * every captured article, and every one the archive has not already decided
 * about is fetched and phrase-tested. There is no routine run and no
 * checkpoint, because the paper stopped publishing in 2015; what makes a
 * re-run cheap is that a stored article and a refused one are both skipped
 * without a request, so a backfill cut short by its budget resumes where it
 * stopped.
 *
 * Refusals are written to the News-Letter's miss table under the `gazette:`
 * prefix. The table is a list of keys a past run read and turned down, and
 * the keys of the two papers cannot collide.
 */

import {
    GAZETTE_EARLIEST_YEAR,
    GAZETTE_LATEST_YEAR,
    GAZETTE_MAX_ARTICLES_PER_RUN,
} from "@/config/gazette";
import { storeSecondaryArticle } from "@/lib/coverage";
import { listedDate } from "@/lib/dates";
import {
    GAZETTE_DISCOVERED_VIA,
    GAZETTE_FILE_PREFIX,
    GAZETTE_MIME,
    GazetteBudgetReached,
    type GazetteCapture,
    fetchCapture,
    gazetteBody,
    gazetteMarkdown,
    gazetteSearchableText,
    listYear,
} from "@/lib/gazette";
import { prisma } from "@/lib/prisma";

export type GazetteSummary = {
    /** CDX listing requests issued. */
    listingsRun: number;
    candidatesFound: number;
    alreadyHeld: number;
    alreadyRefused: number;
    articlesCreated: number;
    articlesUpdated: number;
    articlesRejected: number;
    articlesUnreadable: number;
    budgetReached: boolean;
    /** The last year whose every candidate was decided, for the resume message. */
    completedThrough: number | null;
};

export type GazetteEvent = {
    status: "created" | "updated" | "unchanged" | "rejected" | "unreadable";
    url: string;
    headline: string;
    publishedOn: string | null;
    sessionNumber: number | null;
    phrases: string[];
};

export type GazetteOptions = {
    /** Exactly these years; otherwise every year the paper published online. */
    years?: number[];
    /** Fetch articles already held or refused, to re-read them. */
    refetch?: boolean;
    limit?: number;
    runBudgetMs?: number;
    onListing?: (year: number, prefix: string, found: number) => void;
    onEvent?: (event: GazetteEvent) => void;
};

export function gazetteYears(options: Pick<GazetteOptions, "years"> = {}): number[] {
    if (options.years?.length) return [...options.years].sort((a, b) => a - b);
    const years: number[] = [];
    for (let year = GAZETTE_EARLIEST_YEAR; year <= GAZETTE_LATEST_YEAR; year += 1) years.push(year);
    return years;
}

/** Every Gazette key the archive has already decided about: held, and refused. */
export async function gazetteDecided(): Promise<{ held: Set<string>; refused: Set<string> }> {
    const [documents, misses] = await Promise.all([
        prisma.document.findMany({
            where: { driveFileId: { startsWith: GAZETTE_FILE_PREFIX } },
            select: { driveFileId: true },
        }),
        prisma.newsletterMiss.findMany({
            where: { fileId: { startsWith: GAZETTE_FILE_PREFIX } },
            select: { fileId: true },
        }),
    ]);
    return {
        held: new Set(documents.map((document) => document.driveFileId)),
        refused: new Set(misses.map((miss) => miss.fileId)),
    };
}

/**
 * List the Gazette year by year and store what mentions the student government.
 *
 * Years run oldest first, and each year is listed and then worked through
 * before the next is listed, so a run stopped by its budget leaves the archive
 * complete up to a date rather than patchy throughout.
 */
export async function ingestGazetteCoverage(options: GazetteOptions = {}): Promise<GazetteSummary> {
    const summary: GazetteSummary = {
        listingsRun: 0,
        candidatesFound: 0,
        alreadyHeld: 0,
        alreadyRefused: 0,
        articlesCreated: 0,
        articlesUpdated: 0,
        articlesRejected: 0,
        articlesUnreadable: 0,
        budgetReached: false,
        completedThrough: null,
    };

    const limit = options.limit ?? GAZETTE_MAX_ARTICLES_PER_RUN;
    const deadline = Date.now() + (options.runBudgetMs ?? Number.POSITIVE_INFINITY);
    const { held, refused } = await gazetteDecided();
    let fetched = 0;

    const work = async (capture: GazetteCapture): Promise<"stop" | "next"> => {
        if (!options.refetch) {
            if (held.has(capture.fileId)) {
                summary.alreadyHeld += 1;
                return "next";
            }
            if (refused.has(capture.fileId)) {
                summary.alreadyRefused += 1;
                return "next";
            }
        }

        if (fetched >= limit || Date.now() >= deadline) {
            summary.budgetReached = true;
            return "stop";
        }
        fetched += 1;

        const article = await fetchCapture(capture, deadline);
        if (!article) {
            // Not refused: an unreadable capture is retried next run, and a
            // parser fix can then read it.
            summary.articlesUnreadable += 1;
            options.onEvent?.({
                status: "unreadable",
                url: capture.liveUrl,
                headline: capture.fileId,
                publishedOn: capture.listedOn,
                sessionNumber: null,
                phrases: [],
            });
            return "next";
        }

        const stored = await storeSecondaryArticle({
            fileId: article.fileId,
            url: article.url,
            headline: article.headline,
            publishedOn: article.publishedOn,
            searchableText: gazetteSearchableText(article),
            content: gazetteMarkdown(article),
            body: gazetteBody(article),
            kind: "gazette.article",
            discoveredVia: GAZETTE_DISCOVERED_VIA,
            mimeType: GAZETTE_MIME,
        });

        if (stored.status === "rejected") {
            summary.articlesRejected += 1;
            refused.add(article.fileId);
        } else {
            held.add(article.fileId);
        }
        if (stored.status === "created") summary.articlesCreated += 1;
        if (stored.status === "updated") summary.articlesUpdated += 1;

        options.onEvent?.({
            url: article.url,
            headline: article.headline,
            publishedOn: article.publishedOn,
            ...stored,
        });
        return "next";
    };

    try {
        for (const year of gazetteYears(options)) {
            const captures = await listYear(year, {
                deadline,
                onPrefix: (prefix, found) => {
                    summary.listingsRun += 1;
                    options.onListing?.(year, prefix, found);
                },
            });
            summary.candidatesFound += captures.length;

            for (const capture of captures) {
                if ((await work(capture)) === "stop") return summary;
            }
            summary.completedThrough = year;
        }
    } catch (cause) {
        if (!(cause instanceof GazetteBudgetReached)) throw cause;
        summary.budgetReached = true;
    }

    return summary;
}

/** What the archive holds from the Gazette, for the script's closing report. */
export async function gazetteHeld(): Promise<{ count: number; earliest: Date | null; latest: Date | null }> {
    const documents = await prisma.document.findMany({
        where: { driveFileId: { startsWith: GAZETTE_FILE_PREFIX } },
        select: { datedAt: true, driveCreatedTime: true, driveModifiedTime: true },
    });

    const dates = documents
        .map((document) => listedDate(document))
        .filter((date): date is Date => date !== null)
        .sort((left, right) => left.getTime() - right.getTime());

    return { count: documents.length, earliest: dates.at(0) ?? null, latest: dates.at(-1) ?? null };
}
