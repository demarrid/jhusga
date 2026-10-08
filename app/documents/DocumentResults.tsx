"use client";

import Link from "next/link";
import { useEffect, useEffectEvent, useRef, useState } from "react";

import type { DocumentListing, DocumentPage } from "@/api/documents";
import { useDocumentQuery } from "@/app/(components)/DocumentQuery";
import LoadingBar from "@/app/(components)/LoadingBar";
import { SESSION_NUMBER, sessionOrdinal } from "@/config/session";
import { proseLine } from "@/lib/cite";
import { compareNamesBySurname, contributorRoleLabel } from "@/lib/contributors";
import { formatDateShort, formatDateTime } from "@/lib/dates";
import {
    DOCUMENT_PAGE_SIZE,
    DOCUMENT_SORT_LABELS,
    defaultDocumentSort,
    documentSortsFor,
    type DocumentCursor,
    type DocumentSort,
} from "@/lib/document-sort";
import { documentKindLabel } from "@/lib/kinds";

import styles from "./documents.module.css";

/** How far below the screen the next page starts loading. */
const PREFETCH_MARGIN = "0px 0px 900px 0px";

/** A listing as it arrives from /api/documents, with its dates still strings. */
type WireListing = Omit<DocumentListing, "driveCreatedTime" | "driveModifiedTime" | "datedAt"> & {
    driveCreatedTime: string | null;
    driveModifiedTime: string | null;
    datedAt: string | null;
};

function revive(document: WireListing): DocumentListing {
    const date = (value: string | null) => (value ? new Date(value) : null);
    return {
        ...document,
        driveCreatedTime: date(document.driveCreatedTime),
        driveModifiedTime: date(document.driveModifiedTime),
        datedAt: date(document.datedAt),
    };
}

type Loaded = { documents: DocumentListing[]; next: DocumentCursor | null };

/**
 * The document list, one page at a time.
 *
 * The first page is rendered on the server with the rest of the page. Later
 * ones are fetched as the reader nears the bottom. The page keys this
 * component by its query, so a new filter or sort starts from a fresh first
 * page, and the request for a page of the old one is cancelled on the way out.
 */
export default function DocumentResults({
    initial,
    search,
    sort,
    hasQuery,
    emptyMessage,
}: {
    initial: DocumentPage;
    /** The listing's own query string, sent with each request for a page. */
    search: string;
    sort: DocumentSort;
    /** Whether a title or content search is typed, which makes relevance a choice. */
    hasQuery: boolean;
    emptyMessage: string;
}) {
    const { pending, apply } = useDocumentQuery();
    const [loaded, setLoaded] = useState<Loaded>({
        documents: initial.documents,
        next: initial.next,
    });
    const [status, setStatus] = useState<"idle" | "loading" | "failed">("idle");
    // Shown at once rather than when the navigation lands, so the control
    // answers the click while the bar says the list is on its way.
    const [chosenSort, setChosenSort] = useState(sort);
    const request = useRef<AbortController | null>(null);
    const sentinel = useRef<HTMLDivElement>(null);

    useEffect(() => () => request.current?.abort(), []);

    function loadMore() {
        const cursor = loaded.next;
        if (!cursor || request.current) return;

        const controller = new AbortController();
        request.current = controller;
        setStatus("loading");

        const params = new URLSearchParams(search);
        params.set("after", cursor.after);
        params.set("offset", String(cursor.offset));

        fetch(`/api/documents?${params.toString()}`, { signal: controller.signal })
            .then(async (response) => {
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                return (await response.json()) as { documents: WireListing[]; next: DocumentCursor | null };
            })
            .then((page) => {
                if (controller.signal.aborted) return;
                setLoaded((current) => {
                    // A page can repeat documents already shown: one that
                    // moved across a page boundary between requests, or the
                    // step back after the cursor's document was removed.
                    const seen = new Set(current.documents.map((document) => document.id));
                    return {
                        documents: [
                            ...current.documents,
                            ...page.documents.map(revive).filter((document) => !seen.has(document.id)),
                        ],
                        next: page.next,
                    };
                });
                setStatus("idle");
            })
            .catch(() => {
                if (!controller.signal.aborted) setStatus("failed");
            })
            .finally(() => {
                if (request.current === controller) request.current = null;
            });
    }

    const onSentinelVisible = useEffectEvent(loadMore);

    // Re-observed after every page, so a page too short to push the sentinel
    // off screen is followed straight away by the next one. Held off while
    // the filters change: those pages belong to a list about to be replaced.
    const canLoad = loaded.next !== null && status === "idle" && !pending;

    useEffect(() => {
        const target = sentinel.current;
        if (!canLoad || !target) return;

        const observer = new IntersectionObserver(
            (entries) => {
                if (entries.some((entry) => entry.isIntersecting)) onSentinelVisible();
            },
            { rootMargin: PREFETCH_MARGIN },
        );
        observer.observe(target);
        return () => observer.disconnect();
    }, [canLoad, loaded.next]);

    function chooseSort(next: DocumentSort) {
        if (next === chosenSort) return;
        setChosenSort(next);
        apply({ sort: next === defaultDocumentSort(hasQuery) ? "" : next });
    }

    return (
        <>
            <div className={styles.listToolbar}>
                <LoadingBar active={pending} className={styles.listLoading} />
                <div className={styles.sortControl} role="group" aria-labelledby="document-sort-label">
                    <span id="document-sort-label">Sort by</span>
                    {documentSortsFor(hasQuery).map((option) => (
                        <button
                            key={option}
                            type="button"
                            aria-pressed={chosenSort === option}
                            onClick={() => chooseSort(option)}
                        >
                            {DOCUMENT_SORT_LABELS[option]}
                        </button>
                    ))}
                </div>
            </div>

            <div className={pending ? styles.listPending : undefined} aria-busy={pending}>
                {loaded.documents.length === 0 ? (
                    <p className={styles.muted}>{emptyMessage}</p>
                ) : (
                    <ul className={styles.documentList}>
                        {loaded.documents.map((document, index) => (
                            <DocumentCard key={document.id} document={document} index={index + 1} sort={sort} />
                        ))}
                    </ul>
                )}

                <div ref={sentinel} className={styles.listFooter}>
                    {status === "loading" && (
                        <p className={styles.listStatus} role="status">
                            <span className={styles.spinner} aria-hidden="true" />
                            Loading more documents
                        </p>
                    )}
                    {status === "failed" && (
                        <p className={styles.listStatus} role="alert">
                            The next documents could not be loaded.
                            <button type="button" className={styles.retry} onClick={loadMore}>
                                Try again
                            </button>
                        </p>
                    )}
                    {status === "idle" && !loaded.next && initial.total > DOCUMENT_PAGE_SIZE && (
                        <p className={styles.listStatus}>
                            End of the list · all {initial.total} documents shown
                        </p>
                    )}
                </div>
            </div>
        </>
    );
}

function DocumentCard({
    document,
    index,
    sort,
}: {
    document: DocumentListing;
    index: number;
    sort: DocumentSort;
}) {
    // One person chip lists every capacity in which that person appears.
    const byPerson = new Map<string, { name: string; roles: string[] }>();
    for (const contributor of document.contributors) {
        const entry = byPerson.get(contributor.id);
        if (entry) {
            entry.roles.push(contributor.role);
        } else {
            byPerson.set(contributor.id, {
                name: contributor.name,
                roles: [contributor.role],
            });
        }
    }

    // Preserve the original Drive name as hover context after normalization.
    const renamed = document.driveTitle !== document.title;
    const metadata = [
        documentKindLabel(document.kind),
        document.discoveredVia === "link" ? "Linked from the archive" : document.folderPath,
        document.sessionNumber !== null &&
            document.sessionNumber !== SESSION_NUMBER &&
            `${sessionOrdinal(document.sessionNumber)} session`,
    ]
        .filter(Boolean)
        .join(" · ");

    return (
        <li className={styles.documentCard}>
            <div className={styles.documentIndex}>{String(index).padStart(2, "0")}</div>
            <article>
                <p className={styles.documentMetadata}>{metadata}</p>
                <h3>
                    <Link
                        href={`/documents/${document.id}`}
                        title={renamed ? `Filed in Drive as “${document.driveTitle}”` : undefined}
                    >
                        {document.title}
                    </Link>
                </h3>

                <DocumentDates document={document} sort={sort} />

                {/*
                 * The restatement, not the Drive description. The description is
                 * whatever the officer who uploaded the file typed into the box, which
                 * is usually nothing; the restatement says what the document does and
                 * every claim in it was checked against the document's own words. See
                 * lib/summarize.ts.
                 */}
                {(document.summary || document.description) && (
                    <p className={styles.documentDescription}>
                        {document.summary ? proseLine(document.summary, 260) : document.description}
                    </p>
                )}

                {byPerson.size > 0 && (
                    <div className={styles.contributors} aria-label="People named in this document">
                        {[...byPerson]
                            .sort((left, right) => compareNamesBySurname(left[1].name, right[1].name))
                            .map(([id, entry]) => (
                                <Link
                                    key={id}
                                    href={`/documents?mode=find&person=${id}`}
                                    className={styles.contributorChip}
                                >
                                    {entry.name}
                                    <span className={styles.contributorTooltip}>
                                        {entry.roles.map(contributorRoleLabel).join(", ")}
                                    </span>
                                </Link>
                            ))}
                    </div>
                )}
            </article>
            <Link
                className={styles.documentArrow}
                href={`/documents/${document.id}`}
                aria-label={`Open ${document.title}`}
            >
                ↗
            </Link>
        </li>
    );
}

/**
 * The card's dates, without repeating a day already shown.
 *
 * Normally the document's own date (or its creation, when it states none)
 * and when it was last updated. Sorted by Created, the creation date leads,
 * since the list is in that order and a stated date would hide it.
 */
function DocumentDates({ document, sort }: { document: DocumentListing; sort: DocumentSort }) {
    const candidates: [string, Date | null][] =
        sort === "created"
            ? [
                  ["Created", document.driveCreatedTime],
                  ["Dated", document.datedAt],
              ]
            : [document.datedAt ? ["Dated", document.datedAt] : ["Created", document.driveCreatedTime]];
    candidates.push(["Updated", document.driveModifiedTime]);

    const shown: { label: string; date: Date }[] = [];
    for (const [label, date] of candidates) {
        if (!date || shown.some((entry) => formatDateShort(entry.date) === formatDateShort(date))) continue;
        shown.push({ label, date });
    }
    if (shown.length === 0) return null;

    return (
        <p className={styles.documentDates}>
            {shown.map(({ label, date }, index) => (
                <span key={label}>
                    {index > 0 && " · "}
                    <time dateTime={date.toISOString()} title={formatDateTime(date) ?? undefined}>
                        {`${label} ${formatDateShort(date)}`}
                    </time>
                </span>
            ))}
        </p>
    );
}
