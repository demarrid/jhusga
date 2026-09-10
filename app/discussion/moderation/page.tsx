import Link from "next/link";

import { getViewer } from "@/api/auth";
import { getHeldQueue, getModerationLog } from "@/api/forum";
import ModerationControls from "@/app/(components)/ModerationControls";
import { formatDateShort, formatDateTime } from "@/lib/dates";

import DiscussionHeader from "../DiscussionHeader";
import styles from "../discussion.module.css";

export const dynamic = "force-dynamic";

/**
 * Every moderation action, in public, to anybody who asks.
 *
 * Not a courtesy. A forum where one person can hide what other people wrote is
 * only defensible if the people being moderated can see it happening, and a
 * log nobody can read is the same as no log. Nothing is filtered out of this
 * page and there is no signed-in version of it that shows more -- the only
 * difference a moderator sees is the buttons, not the contents.
 *
 * This page also carries the held queue, and has to. A held reply is left out
 * of its thread and has no page of its own, so without this it would be
 * unreadable by everyone including the moderator who has to rule on it.
 */
export default async function ModerationLog() {
    const [viewer, entries, held] = await Promise.all([
        getViewer(),
        getModerationLog(),
        getHeldQueue(),
    ]);

    const moderating = viewer?.role === "moderator";

    return (
        <main className={styles.page}>
          <DiscussionHeader eyebrow="Public record" title="Moderation log" compact />
          <div className={styles.content}>
            <p className={styles.proseIntro}>
                Everything a moderator has done on the forum, with the reason
                given at the time — and everything the automatic screening has
                held back before a moderator saw it. Nothing is deleted: held
                and hidden material stays readable behind a click, so a removal
                can be judged against the thing that was removed.{" "}
                <Link className={styles.inlineLink} href="/discussion/rules">
                    What moderators may do
                </Link>{" "}
                is set out with the rest of the rules.
            </p>

            <p className={styles.muted}>
                A post the screening is holding does not appear on the
                discussion at all, so this page is the only place it is
                announced. That is the trade: the text waits, the fact that it
                is waiting does not.
            </p>

            <section className={styles.recordSection}>
                <h2 className={styles.recordHeading}>
                    {held.length === 0
                        ? "Nothing is being held"
                        : held.length === 1
                            ? "1 submission is being held"
                            : `${held.length} submissions are being held`}
                </h2>

                {held.length === 0 ? (
                    <p className={styles.muted}>
                        Everything submitted is either on the discussion or has
                        been ruled on below.
                    </p>
                ) : (
                    <>
                        <p className={styles.muted}>
                            Waiting for a moderator. Each is readable here, so
                            the hold can be checked against what was actually
                            written — and so the backlog is countable, which is
                            the number worth being embarrassed by.
                        </p>

                        {held.map((item) => (
                            <div key={item.id}>
                                <details className={styles.heldItem}>
                                    <summary>
                                        {item.title}
                                        <span className={styles.muted}>
                                            {" — "}
                                            {formatDateShort(item.createdAt)}
                                            {item.reason ? ` · ${item.reason}` : ""}
                                        </span>
                                    </summary>
                                    <p className={styles.body}>{item.body}</p>
                                </details>

                                {moderating && (
                                    <ModerationControls
                                        targetType={item.targetType}
                                        targetId={item.id}
                                        hidden
                                        hiddenBy="screen"
                                    />
                                )}
                            </div>
                        ))}
                    </>
                )}
            </section>

            <section className={styles.recordSection}>
            <h2 className={styles.recordHeading}>What has been done</h2>

            {entries.length === 0 ? (
                <p className={styles.emptyState}>
                    Nothing has been moderated. This page will fill itself in if
                    that changes.
                </p>
            ) : (
                <ul className={styles.recordList}>
                    {entries.map((entry) => (
                        <li key={entry.id}>
                            <span>{describe(entry.action)}</span>{" "}
                            {entry.targetType === "post" ? (
                                <Link href={`/discussion/${entry.targetId}`}>
                                    {entry.context}
                                </Link>
                            ) : (
                                <span>{entry.context}</span>
                            )}

                            <span className={styles.muted}>
                                {" — "}
                                {entry.actorLabel}
                                {" · "}
                                {formatDateTime(entry.createdAt)}
                            </span>

                            {entry.reason && (
                                <p className={styles.muted}>{entry.reason}</p>
                            )}
                        </li>
                    ))}
                </ul>
            )}
            </section>
            <Link className={styles.backLink} href="/discussion">← Back to the discussion</Link>
          </div>
        </main>
    );
}

function describe(action: string): string {
    switch (action) {
        case "withhold":
            return "Held back, pending review:";
        case "hide":
            return "Hid";
        case "uphold":
            return "Upheld the hold on";
        case "restore":
            return "Published";
        case "lock":
            return "Locked replies on";
        case "unlock":
            return "Unlocked replies on";
        default:
            return action;
    }
}
