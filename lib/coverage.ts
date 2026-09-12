/**
 * Storing The Johns Hopkins News-Letter's coverage of the SGA.
 *
 * The Drive sync reconciles the archive against a folder the SGA controls, and
 * can therefore ask Drive what changed. There is no such question to ask a
 * newspaper: an article is published once and does not move. So the two halves
 * of "make re-runs cheap" are answered differently here. An article the archive
 * already holds is not fetched at all -- not re-exported, not re-hashed, not
 * looked at -- because the only thing a second fetch could discover is a
 * correction, and paying a request per article per night to find one is the
 * wrong trade. `--refetch` is how somebody who wants that asks for it.
 *
 * What that leaves is the search itself, which is why searches are fenced to a
 * calendar year. A routine run reads two years, six pages, sixty seconds; a
 * backfill reads every year since 2001 and stops when it runs out of budget,
 * and the next run picks up where it left off because everything it stored is
 * now something it skips.
 *
 * The filtering rule is the one worth stating plainly: the paper's search
 * decides what gets fetched and this module decides what gets kept. An article
 * whose own text contains none of the archive's phrases is dropped after being
 * fetched, and the phrases that kept it are written to the row.
 */

import { createHash } from "node:crypto";

import {
    MAX_ARTICLES_PER_RUN,
    MAX_SEARCH_PAGES_PER_WINDOW,
    NEWSLETTER_EARLIEST_YEAR,
    NEWSLETTER_PHRASES,
    NEWSLETTER_RECENT_YEARS,
    NEWSLETTER_RUN_BUDGET_MS,
    NEWSLETTER_SEARCH_RESULT_CAP,
} from "@/config/newsletter";
import { listedDate } from "@/lib/dates";
import { sessionForDate } from "@/lib/identity";
import { deriveDescription } from "@/lib/markdown";
import {
    NEWSLETTER_DISCOVERED_VIA,
    NEWSLETTER_FILE_PREFIX,
    NEWSLETTER_MIME,
    type NewsletterArticle,
    type SearchResult,
    articleBody,
    articleMarkdown,
    fetchArticle,
    matchedPhrases,
    searchYear,
} from "@/lib/newsletter";
import { prisma } from "@/lib/prisma";
import { indexDocumentPassages } from "@/lib/search";
import { reanchorDocument } from "@/lib/sync";

export type CoverageSummary = {
    /** Search requests issued, i.e. one per phrase per year per page. */
    searchesRun: number;
    /**
     * Distinct articles the searches offered, after deduplication across the
     * phrases and the pages. Counted when a year's results come in rather than
     * as each is worked through, so that a run stopped by its budget still
     * reports how much is waiting rather than how much it got to.
     */
    candidatesFound: number;
    /** Candidates skipped without a request, because they are already held. */
    alreadyHeld: number;
    /** Candidates skipped without a request, because a past run read and refused them. */
    alreadyRefused: number;
    articlesCreated: number;
    /** Articles whose text had changed since the archive fetched it. */
    articlesUpdated: number;
    /** Fetched, then dropped: the text contains none of the phrases. */
    articlesRejected: number;
    /** The page was gone, or held nothing a citation could point at. */
    articlesUnreadable: number;
    /** True when the run stopped on its budget with candidates left over. */
    budgetReached: boolean;
    /**
     * Years where the engine reported its own cap as the hit count, meaning the
     * window was truncated and the archive is quietly missing articles inside
     * it. Should always be empty: a year is far narrower than the cap. If it is
     * not, the fence in `searchUrl` has to become narrower than a year, which
     * is a code change rather than something a retry fixes.
     */
    truncatedYears: number[];
};

/** What the caller is told about each article, as it happens. */
export type CoverageEvent = {
    status: "created" | "updated" | "unchanged" | "rejected" | "unreadable";
    url: string;
    headline: string;
    publishedOn: string | null;
    sessionNumber: number | null;
    phrases: string[];
};

export type CoverageOptions = {
    /** Search every year since NEWSLETTER_EARLIEST_YEAR, not just the recent ones. */
    backfill?: boolean;
    /** Search exactly these years, overriding both defaults. */
    years?: number[];
    /** Fetch articles the archive already holds, to pick up corrections. */
    refetch?: boolean;
    limit?: number;
    runBudgetMs?: number;
    onEvent?: (event: CoverageEvent) => void;
    onSearch?: (phrase: string, year: number, page: number, found: number) => void;
};

function hashContent(content: string): string {
    return createHash("sha256").update(content).digest("hex");
}

/**
 * Noon UTC on the day the paper published, or null.
 *
 * Noon rather than midnight for the same reason lib/identity.ts uses it: the
 * site formats dates in Baltimore, and an instant at midnight UTC is the
 * previous evening there.
 */
function publishedAt(article: NewsletterArticle): Date | null {
    if (!article.publishedOn) return null;

    const [year, month, day] = article.publishedOn.split("-").map(Number);
    if (!year || !month || !day) return null;

    return new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
}

/**
 * The years a run searches, in the order it searches them.
 *
 * A backfill goes forwards from 2001, so that a run cut short by its budget
 * leaves the archive complete up to a date rather than patchy throughout, and
 * so the next run's resume point is a year rather than a guess. A routine run
 * goes backwards from now, because that is where anything new is.
 */
function yearsToSearch(options: CoverageOptions): number[] {
    if (options.years?.length) return options.years;

    const thisYear = new Date().getUTCFullYear();

    if (options.backfill) {
        const years: number[] = [];
        for (let year = NEWSLETTER_EARLIEST_YEAR; year <= thisYear; year += 1) {
            years.push(year);
        }
        return years;
    }

    const years: number[] = [];
    for (let back = 0; back < NEWSLETTER_RECENT_YEARS; back += 1) {
        const year = thisYear - back;
        if (year >= NEWSLETTER_EARLIEST_YEAR) years.push(year);
    }
    return years;
}

/**
 * Everything an article contributes to the archive's phrase test.
 *
 * The headline and the deck count, not just the body: "SGA falls short with
 * election remedy" is coverage of the SGA whether or not the piece below it
 * spells the acronym out again. The site's own navigation is not here, which is
 * the entire difference between this test and the one the paper's search ran.
 */
function searchableText(article: NewsletterArticle): string {
    return [article.headline, article.subhead, ...article.paragraphs].join("\n");
}

/**
 * Store one article, or say why it was not stored.
 *
 * An article is never held for review the way a Drive document can be. A hold
 * exists because a world-editable Google Doc can be rewritten by a stranger
 * between two syncs and the archive cannot tell that from an amendment; a
 * published article has no such failure mode, and `anyoneCanEdit` is written
 * false rather than left null to say so positively.
 */
async function storeArticle(
    article: NewsletterArticle,
    summary: CoverageSummary,
): Promise<CoverageEvent> {
    const phrases = matchedPhrases(searchableText(article));

    const base = {
        url: article.url,
        headline: article.headline,
        publishedOn: article.publishedOn,
        phrases: [...phrases],
    };

    // The paper's engine stems and matches across the whole page, so it offers
    // articles that never use any of these phrases. Fetching was the only way
    // to find out; keeping it would be the archive asserting a connection its
    // own evidence does not support.
    if (phrases.length === 0) {
        // Written down so the next run does not spend a request rediscovering
        // it. This is the only decision here that costs a fetch to reach.
        await prisma.newsletterMiss.upsert({
            where: { fileId: article.fileId },
            create: { fileId: article.fileId, headline: article.headline },
            update: { headline: article.headline, checkedAt: new Date() },
        });

        summary.articlesRejected += 1;
        return { ...base, status: "rejected", sessionNumber: null };
    }

    // Kept after having once been refused, which happens when the phrase list
    // grows or the paper corrected the piece. The refusal must not outlive it.
    await prisma.newsletterMiss.deleteMany({ where: { fileId: article.fileId } });

    const datedAt = publishedAt(article);
    // An article dates itself, so its session comes from that date and never
    // from a folder: there is no folder. June is the boundary, so the
    // September-to-May coverage of one session lands on that session.
    const sessionNumber = datedAt ? sessionForDate(datedAt) : null;

    const content = articleMarkdown(article);
    const contentHash = hashContent(content);

    const existing = await prisma.document.findUnique({
        where: { driveFileId: article.fileId },
        select: { id: true, contentHash: true },
    });

    const stored = {
        source: article.url,
        mimeType: NEWSLETTER_MIME,
        title: article.headline,
        // Shown as printed. There is no tidier name for a headline, and
        // lib/titles.ts is told not to invent one; see `canonicalTitle`.
        displayTitle: article.headline,
        description: deriveDescription(articleBody(article)),
        content,
        contentHash,
        kind: "newsletter.article",
        folderPath: "",
        discoveredVia: NEWSLETTER_DISCOVERED_VIA,
        sessionNumber,
        // Deliberately empty. A lineage key groups the copies of one document
        // that each session adopts, and two articles about two years of the
        // same committee are two pieces of reporting, not two drafts.
        lineageKey: "",
        meetingKey: "",
        meetingRole: "",
        datedAt,
        // The day the paper published, which is the only date an article has.
        // There is no later modification: `driveModifiedTime` stays null so
        // that nothing describes an article as having been "updated".
        driveCreatedTime: datedAt,
        driveModifiedTime: null,
        lastSyncedAt: new Date(),
        anyoneCanEdit: false,
        // The reporter is named in the stored text, where the paper put them.
        // These columns are Drive provenance and are read as "who in the SGA
        // touched this file", which nobody did.
        driveOwnerName: null,
        driveOwnerEmail: null,
        driveLastEditorName: null,
        driveLastEditorEmail: null,
        reviewState: "published",
        matchedPhrases: phrases.join(", "),
    };

    if (existing && existing.contentHash === contentHash) {
        await prisma.document.update({
            where: { id: existing.id },
            data: { lastSyncedAt: stored.lastSyncedAt, matchedPhrases: stored.matchedPhrases },
        });
        return { ...base, status: "unchanged", sessionNumber };
    }

    const document = await prisma.document.upsert({
        where: { driveFileId: article.fileId },
        create: { driveFileId: article.fileId, ...stored },
        update: stored,
    });

    // The same append-only history as everything else. For an article it is
    // near-always one row, and the exception is the interesting one: a second
    // row means the paper changed a piece after publishing it.
    await prisma.documentRevision.upsert({
        where: { documentId_contentHash: { documentId: document.id, contentHash } },
        create: {
            documentId: document.id,
            title: article.headline,
            content,
            contentHash,
        },
        update: { fetchedAt: new Date() },
    });

    await indexDocumentPassages(document.id, content);

    if (!existing) {
        summary.articlesCreated += 1;
        return { ...base, status: "created", sessionNumber };
    }

    summary.articlesUpdated += 1;
    await reanchorDocument(document.id, content);
    await prisma.documentSummary.updateMany({
        where: { documentId: document.id, status: "fresh" },
        data: { status: "stale" },
    });

    return { ...base, status: "updated", sessionNumber };
}

/**
 * Search the paper for the archive's phrases and store what it finds.
 *
 * Ordered search-then-fetch within each year rather than across the whole run,
 * so a run that stops on its budget stops having finished a year. The candidate
 * set is deduplicated across the three phrases and across pages before anything
 * is fetched, which is what stops an article that says "the SGA, the student
 * government" from being fetched twice.
 */
export async function ingestNewsletterCoverage(
    options: CoverageOptions = {},
): Promise<CoverageSummary> {
    const summary: CoverageSummary = {
        searchesRun: 0,
        candidatesFound: 0,
        alreadyHeld: 0,
        articlesCreated: 0,
        articlesUpdated: 0,
        articlesRejected: 0,
        articlesUnreadable: 0,
        budgetReached: false,
        truncatedYears: [],
        alreadyRefused: 0,
    };

    const limit = options.limit ?? MAX_ARTICLES_PER_RUN;
    const deadline = Date.now() + (options.runBudgetMs ?? NEWSLETTER_RUN_BUDGET_MS);

    const held = new Set(
        (
            await prisma.document.findMany({
                where: { driveFileId: { startsWith: NEWSLETTER_FILE_PREFIX } },
                select: { driveFileId: true },
            })
        ).map((document) => document.driveFileId),
    );

    // The two together are every article this archive has already decided
    // about. Both are skipped without a request; `--refetch` ignores both.
    const refused = new Set(
        (await prisma.newsletterMiss.findMany({ select: { fileId: true } })).map(
            (miss) => miss.fileId,
        ),
    );

    let fetched = 0;
    const seen = new Set<string>();

    for (const year of yearsToSearch(options)) {
        const candidates = new Map<string, SearchResult>();

        for (const phrase of NEWSLETTER_PHRASES) {
            const results = await searchYear(phrase, year, {
                maxPages: MAX_SEARCH_PAGES_PER_WINDOW,
                onPage: (page, found, reported) => {
                    summary.searchesRun += 1;
                    if (
                        reported === NEWSLETTER_SEARCH_RESULT_CAP &&
                        !summary.truncatedYears.includes(year)
                    ) {
                        summary.truncatedYears.push(year);
                    }
                    options.onSearch?.(phrase, year, page, found);
                },
            });

            for (const result of results) candidates.set(result.fileId, result);
        }

        for (const fileId of candidates.keys()) {
            if (!seen.has(fileId)) summary.candidatesFound += 1;
        }

        for (const [fileId, result] of candidates) {
            if (seen.has(fileId)) continue;
            seen.add(fileId);

            if (!options.refetch) {
                if (held.has(fileId)) {
                    summary.alreadyHeld += 1;
                    continue;
                }
                if (refused.has(fileId)) {
                    summary.alreadyRefused += 1;
                    continue;
                }
            }

            if (fetched >= limit || Date.now() >= deadline) {
                summary.budgetReached = true;
                return summary;
            }

            fetched += 1;
            const article = await fetchArticle(result.url);

            if (!article) {
                summary.articlesUnreadable += 1;
                options.onEvent?.({
                    status: "unreadable",
                    url: result.url,
                    headline: result.headline,
                    publishedOn: result.listedOn,
                    sessionNumber: null,
                    phrases: [],
                });
                continue;
            }

            options.onEvent?.(await storeArticle(article, summary));
        }
    }

    return summary;
}

/** What the archive holds from the paper, for the script's closing report. */
export async function coverageHeld(): Promise<{
    count: number;
    earliest: Date | null;
    latest: Date | null;
}> {
    const documents = await prisma.document.findMany({
        where: { driveFileId: { startsWith: NEWSLETTER_FILE_PREFIX } },
        select: { datedAt: true, driveCreatedTime: true, driveModifiedTime: true },
    });

    const dates = documents
        .map((document) => listedDate(document))
        .filter((date): date is Date => date !== null)
        .sort((left, right) => left.getTime() - right.getTime());

    return {
        count: documents.length,
        earliest: dates.at(0) ?? null,
        latest: dates.at(-1) ?? null,
    };
}
