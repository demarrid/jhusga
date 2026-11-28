import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { CSSProperties, ReactNode } from "react";

import CitedProse from "@/app/(components)/CitedProse";
import {
    HISTORY_EVENT_KIND_LABELS,
    HISTORY_OUTCOME_LABELS,
} from "@/config/history";
import { sessionOrdinal } from "@/config/session";
import { truncateAtWord } from "@/lib/cite";
import { formatDate } from "@/lib/dates";
import { academicYearKey, academicYearLabel, eventLabel, eventSummary, historySpanLabel } from "@/lib/history";
import JsonLd from "@/app/(components)/JsonLd";
import { SITE_NAME, absoluteUrl, breadcrumbJsonLd, organizationJsonLd, pageMetadata } from "@/lib/seo";
import { getHistoryTimeline, type HistoryEventRecord, type HistoryTimeline } from "@/server/history";

import styles from "../history.module.css";
import Timeline, { type TimelineEvent } from "./Timeline";

export const dynamic = "force-dynamic";

/**
 * A topic's metadata, or one event's when the link carries `?event=`.
 *
 * The timeline writes the open event into the URL, so that is the link people
 * copy and paste into chat; its preview should name the event they are
 * pointing at. Search engines still get one page per topic: the canonical
 * link drops the query either way.
 */
export async function generateMetadata({ params, searchParams }: PageProps<"/history/[slug]">): Promise<Metadata> {
    const { slug } = await params;
    const { event } = await searchParams;
    const timeline = await getHistoryTimeline(slug);
    if (!timeline) return {};
    const { topic, events } = timeline;
    const path = `/history/${topic.slug}`;

    const shared = typeof event === "string" ? events.find((record) => record.id === event) : undefined;
    if (shared) {
        const metadata = pageMetadata({
            title: `${shared.title} · ${topic.title}`,
            description: eventSummary(shared.content) || topic.description,
            path,
        });
        return { ...metadata, openGraph: { ...metadata.openGraph, url: `${path}?event=${shared.id}` } };
    }

    const span = yearSpan(events);
    const extent = events.length > 0
        ? ` ${events.length} event${events.length === 1 ? "" : "s"}${span ? `, ${span}` : ""}, each linked to the documents it was read from.`
        : "";
    return pageMetadata({
        title: `${topic.title} · History`,
        description: `${topic.description}${extent}`,
        path,
    });
}

/** "2004–2026" for the dated events on a timeline, or null if none are dated. */
function yearSpan(events: HistoryEventRecord[]): string | null {
    const years = events.flatMap((record) => (record.occurredAt ? [record.occurredAt.getUTCFullYear()] : []));
    if (years.length === 0) return null;
    const first = Math.min(...years);
    const last = Math.max(...years);
    return first === last ? String(first) : `${first}–${last}`;
}

/**
 * The timeline as Schema.org data: a collection page in the site's history
 * section, about one subject, whose list is the events in date order.
 *
 * Events are ListItems rather than schema.org/Event, which describes things a
 * reader could attend; a Senate vote in 2009 would read to a search engine as
 * an upcoming event with no venue.
 */
function timelineJsonLd(timeline: HistoryTimeline) {
    const { topic, events, generatedAt } = timeline;
    const path = `/history/${topic.slug}`;
    return {
        "@graph": [
            {
                "@type": "CollectionPage",
                "@id": absoluteUrl(path),
                url: absoluteUrl(path),
                name: `${topic.title}: a history of the SGA at Johns Hopkins`,
                description: topic.description,
                inLanguage: "en-US",
                about: { "@type": "Thing", name: topic.title },
                ...(generatedAt ? { dateModified: generatedAt.toISOString() } : {}),
                isPartOf: { "@type": "WebSite", name: SITE_NAME, url: absoluteUrl("/") },
                publisher: organizationJsonLd(),
                breadcrumb: breadcrumbJsonLd([
                    { name: "History", path: "/history" },
                    { name: topic.title, path },
                ]),
                ...(events.length > 0
                    ? {
                        mainEntity: {
                            "@type": "ItemList",
                            itemListOrder: "https://schema.org/ItemListOrderAscending",
                            numberOfItems: events.length,
                            itemListElement: events.map((record, index) => ({
                                "@type": "ListItem",
                                position: index + 1,
                                name: record.title,
                                // The anchor in the record list rather than `?event=`:
                                // each query is a fresh render of the same page.
                                url: absoluteUrl(`${path}#event-${record.id}`),
                                ...(record.occurredAt
                                    ? { description: `${historySpanLabel(record.occurredAt, record.endedAt, record.datePrecision)}: ${truncateAtWord(eventSummary(record.content), 200)}` }
                                    : {}),
                            })),
                        },
                    }
                    : {}),
            },
        ],
    };
}

export default async function HistoryTopicPage({ params, searchParams }: PageProps<"/history/[slug]">) {
    const { slug } = await params;
    const { event } = await searchParams;
    const timeline = await getHistoryTimeline(slug);
    if (!timeline) notFound();

    const { topic, events, status, generatedAt, documentCount } = timeline;
    const threadColor = new Map(topic.threads.map((thread) => [thread.id, thread.color]));
    const threadLabel = new Map(topic.threads.map((thread) => [thread.id, thread.label]));

    const details: Record<string, ReactNode> = {};
    const placed: TimelineEvent[] = [];
    for (const record of events) {
        details[record.id] = <EventBody record={record} />;
        if (!record.occurredAt) continue;
        placed.push({
            id: record.id,
            start: record.occurredAt.getTime(),
            end: record.endedAt?.getTime() ?? null,
            precision: record.datePrecision,
            dateLabel: historySpanLabel(record.occurredAt, record.endedAt, record.datePrecision, { short: true }),
            title: record.title,
            label: eventLabel(record.label, record.title),
            summary: truncateAtWord(eventSummary(record.content), 180),
            thread: record.thread,
            kind: record.kind,
            involvement: record.involvement,
            outcome: record.outcome,
            weight: record.weight,
            searchText: `${record.title} ${record.content.replace(/\[\d+\]/g, "")} ${record.citations
                .map((citation) => citation.documentTitle)
                .join(" ")}`.toLowerCase(),
        });
    }

    const byYear = new Map<string, HistoryEventRecord[]>();
    for (const record of events) {
        const key = academicYearKey(record.occurredAt);
        byYear.set(key, [...(byYear.get(key) ?? []), record]);
    }
    const initialEventId = typeof event === "string" && placed.some((item) => item.id === event) ? event : null;

    return (
        <main className={styles.page}>
            <JsonLd data={timelineJsonLd(timeline)} />
            <header className={styles.pageHeader}>
                <Link href="/history">← History</Link>
                <div>
                    <h1>{topic.title}</h1>
                    <p>{topic.description}</p>
                    {events.length > 0 && (
                        <p className={styles.headerMeta}>
                            {events.length} event{events.length === 1 ? "" : "s"} from {documentCount} document
                            {documentCount === 1 ? "" : "s"}
                            {generatedAt ? ` · Computed ${formatDate(generatedAt)}` : ""}
                        </p>
                    )}
                </div>
            </header>

            {events.length === 0 ? (
                <div className={styles.body}>
                    <p className={styles.emptyState}>
                        This timeline has not been computed yet. Once it is, every point on it will link to
                        the documents it was read from.
                    </p>
                </div>
            ) : (
                <>
                    <section className={styles.timelineSection} aria-label={`${topic.title} timeline`}>
                        {status === "stale" && (
                            <p className={styles.staleNotice}>
                                Some documents have changed or were not read on the last run, so this timeline
                                may be missing recent events.
                            </p>
                        )}
                        {placed.length > 0 && (
                            <Timeline
                                events={placed}
                                threads={topic.threads}
                                details={details}
                                initialEventId={initialEventId}
                            />
                        )}
                    </section>

                    <section className={styles.body} aria-labelledby="history-record-heading">
                        <div className={styles.sectionHeading}>
                            <div>
                                <span>Read as a list</span>
                                <h2 id="history-record-heading">The record</h2>
                            </div>
                            <p>In date order</p>
                        </div>

                        <div className={styles.record}>
                            {[...byYear.entries()].map(([key, records]) => {
                                const start = Number(key.slice(0, 4));
                                return (
                                    <section key={key} className={styles.yearGroup} aria-label={academicYearLabel(key)}>
                                        <h3>
                                            {academicYearLabel(key)}
                                            {Number.isFinite(start) && start > 1912 && (
                                                <small>{sessionOrdinal(start - 1912)} session</small>
                                            )}
                                        </h3>
                                        <ol className={styles.yearEvents}>
                                            {records.map((record) => (
                                                <li
                                                    key={record.id}
                                                    id={`event-${record.id}`}
                                                    className={styles.recordEvent}
                                                    style={{ "--thread-color": threadColor.get(record.thread) } as CSSProperties}
                                                >
                                                    <p className={styles.recordMeta}>
                                                        <span>{historySpanLabel(record.occurredAt, record.endedAt, record.datePrecision)}</span>
                                                        <span className={styles.recordThread}>{threadLabel.get(record.thread)}</span>
                                                        <span>{HISTORY_EVENT_KIND_LABELS[record.kind]}</span>
                                                        {record.outcome && (
                                                            <span className={styles.outcome} data-outcome={record.outcome}>
                                                                {HISTORY_OUTCOME_LABELS[record.outcome]}
                                                            </span>
                                                        )}
                                                        {record.involvement === "context" && (
                                                            <span className={styles.contextTag}>Context</span>
                                                        )}
                                                    </p>
                                                    <h4>{record.title}</h4>
                                                    {details[record.id]}
                                                </li>
                                            ))}
                                        </ol>
                                    </section>
                                );
                            })}
                        </div>

                        <details className={styles.method}>
                            <summary>How this timeline was made</summary>
                            <ul>
                                <li>
                                    Every document in the archive that mentions the subject was read on its own,
                                    and what it records was written down with a quote. A quote that could not be
                                    found word for word in the document was thrown out.
                                </li>
                                <li>
                                    Records of the same thing (an agenda, the minutes, the bill, and a News-Letter
                                    article about it) were then grouped into one event. Each source chip opens the
                                    passage it came from.
                                </li>
                                <li>
                                    Whether legislation passed comes from the Bill Voting Records, then the
                                    Senate&apos;s minutes. Committee votes and news reports do not count, and
                                    records that disagree are marked inconclusive.
                                </li>
                                <li>
                                    News-Letter and Gazette articles are secondary reporting. &ldquo;Context&rdquo; marks a
                                    development outside the SGA that its records tie to its work.
                                </li>
                            </ul>
                        </details>
                    </section>
                </>
            )}
        </main>
    );
}

function EventBody({ record }: { record: HistoryEventRecord }) {
    return (
        <div className={styles.recordBody}>
            <CitedProse
                content={record.content}
                citations={record.citations.map((citation) => ({
                    id: citation.id,
                    documentTitle: truncateAtWord(citation.documentTitle, 120),
                    quote: citation.quote,
                    href: citation.href,
                    orphaned: citation.orphaned,
                }))}
            />
        </div>
    );
}
