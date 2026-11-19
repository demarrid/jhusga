import type { Metadata } from "next";
import Link from "next/link";

import { formatDate } from "@/lib/dates";
import { pageMetadata } from "@/lib/seo";
import { getHistoryTopics, type HistoryTopicSummary } from "@/server/history";

import styles from "./history.module.css";

export const dynamic = "force-dynamic";

const HISTORY_DESCRIPTION =
    "Timelines of what the SGA at Johns Hopkins has done on a subject, assembled from its " +
    "own records and News-Letter reporting. Every point links to the documents behind it.";

export const metadata: Metadata = pageMetadata({
    title: "History",
    description: HISTORY_DESCRIPTION,
    path: "/history",
});

export default async function History() {
    const topics = await getHistoryTopics();

    return (
        <main className={styles.page}>
            <header className={styles.pageHeader}>
                <p>From the archive</p>
                <div>
                    <h1>History</h1>
                    <p>{HISTORY_DESCRIPTION}</p>
                </div>
            </header>

            <section className={styles.body} aria-labelledby="history-topics-heading">
                <div className={styles.sectionHeading}>
                    <div>
                        <span>Timelines</span>
                        <h2 id="history-topics-heading">Choose a subject</h2>
                    </div>
                    <p>
                        {topics.length} subject{topics.length === 1 ? "" : "s"}
                    </p>
                </div>

                <ul className={styles.topicList}>
                    {topics.map((summary, index) => (
                        <TopicCard key={summary.topic.slug} summary={summary} index={index} />
                    ))}
                </ul>
            </section>
        </main>
    );
}

function TopicCard({ summary, index }: { summary: HistoryTopicSummary; index: number }) {
    const { topic, eventCount, perYear, generatedAt } = summary;
    const span =
        perYear.length > 0
            ? `${perYear[0]!.year}–${perYear[perYear.length - 1]!.year}`
            : null;

    return (
        <li className={styles.topicCard}>
            <span className={styles.topicIndex}>{String(index + 1).padStart(2, "0")}</span>
            <div>
                <p className={styles.topicMeta}>
                    {eventCount > 0
                        ? `${eventCount} event${eventCount === 1 ? "" : "s"}${span ? ` · ${span}` : ""}`
                        : "Not yet computed"}
                </p>
                <h3>
                    <Link href={`/history/${topic.slug}`} className={styles.stretchedLink}>
                        {topic.title}
                    </Link>
                </h3>
                <p className={styles.topicDescription}>{topic.description}</p>
                <ul className={styles.threadChips} aria-label="Threads">
                    {topic.threads.map((thread) => (
                        <li key={thread.id}>
                            <span style={{ background: thread.color }} aria-hidden="true" />
                            {thread.label}
                        </li>
                    ))}
                </ul>
                {generatedAt && <p className={styles.topicUpdated}>Computed {formatDate(generatedAt)}</p>}
            </div>
            <div className={styles.topicAside}>
                {perYear.length > 1 && <Sparkline perYear={perYear} />}
                <span className={styles.topicArrow} aria-hidden="true">↗</span>
            </div>
        </li>
    );
}

/** Events per year, so the shape of a subject's history shows before it is opened. */
function Sparkline({ perYear }: { perYear: { year: number; count: number }[] }) {
    const width = 168;
    const height = 40;
    const max = Math.max(...perYear.map((entry) => entry.count), 1);
    const step = width / perYear.length;

    return (
        <svg
            className={styles.sparkline}
            viewBox={`0 0 ${width} ${height}`}
            width={width}
            height={height}
            role="img"
            aria-label={`Events per year, ${perYear[0]!.year} to ${perYear[perYear.length - 1]!.year}`}
        >
            {perYear.map((entry, index) => {
                const barHeight = entry.count === 0 ? 0 : Math.max(2, (entry.count / max) * (height - 4));
                return (
                    <rect
                        key={entry.year}
                        x={index * step + 0.5}
                        y={height - barHeight}
                        width={Math.max(1, step - 1.5)}
                        height={barHeight}
                    >
                        <title>{`${entry.year}: ${entry.count}`}</title>
                    </rect>
                );
            })}
        </svg>
    );
}
