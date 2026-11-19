import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { CSSProperties, ReactNode } from "react";

import CitedProse from "@/app/(components)/CitedProse";
import {
    HISTORY_EVENT_KIND_LABELS,
    HISTORY_OUTCOME_LABELS,
    historyTopic,
} from "@/config/history";
import { sessionOrdinal } from "@/config/session";
import { truncateAtWord } from "@/lib/cite";
import { formatDate } from "@/lib/dates";
import { academicYearKey, academicYearLabel, historySpanLabel } from "@/lib/history";
import { pageMetadata } from "@/lib/seo";
import { getHistoryTimeline, type HistoryEventRecord } from "@/server/history";

import styles from "../history.module.css";
import Timeline, { type TimelineEvent } from "./Timeline";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: PageProps<"/history/[slug]">): Promise<Metadata> {
    const { slug } = await params;
    const topic = historyTopic(slug);
    if (!topic) return {};
    return pageMetadata({
        title: `${topic.title} · History`,
        description: topic.description,
        path: `/history/${topic.slug}`,
    });
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

                        <aside className={styles.method} aria-labelledby="history-method-heading">
                            <h2 id="history-method-heading">How this timeline was made</h2>
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
                                    News-Letter articles are secondary reporting. &ldquo;Context&rdquo; marks a
                                    development outside the SGA that its records tie to its work.
                                </li>
                            </ul>
                        </aside>
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
