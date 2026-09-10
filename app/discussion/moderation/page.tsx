import Link from "next/link";

import { getViewer } from "@/api/auth";
import { getHeldQueue, getModerationLog } from "@/api/forum";
import ModerationControls from "@/app/(components)/ModerationControls";
import { formatDateShort, formatDateTime } from "@/lib/dates";

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
        <div className="max-w-4xl mx-auto p-6">
            <p className="text-foreground-400">
                <Link className="text-primary-700" href="/discussion">
                    Discussion
                </Link>
            </p>

            <h1>Moderation log</h1>

            <p>
                Everything a moderator has done on the forum, with the reason
                given at the time — and everything the automatic screening has
                held back before a moderator saw it. Nothing is deleted: held
                and hidden material stays readable behind a click, so a removal
                can be judged against the thing that was removed.{" "}
                <Link className="text-primary-700" href="/discussion/rules">
                    What moderators may do
                </Link>{" "}
                is set out with the rest of the rules.
            </p>

            <p className="text-foreground-400">
                A post the screening is holding does not appear on the
                discussion at all, so this page is the only place it is
                announced. That is the trade: the text waits, the fact that it
                is waiting does not.
            </p>

            <section className="my-6">
                <h2>
                    {held.length === 0
                        ? "Nothing is being held"
                        : held.length === 1
                            ? "1 submission is being held"
                            : `${held.length} submissions are being held`}
                </h2>

                {held.length === 0 ? (
                    <p className="text-foreground-400">
                        Everything submitted is either on the discussion or has
                        been ruled on below.
                    </p>
                ) : (
                    <>
                        <p className="text-foreground-400">
                            Waiting for a moderator. Each is readable here, so
                            the hold can be checked against what was actually
                            written — and so the backlog is countable, which is
                            the number worth being embarrassed by.
                        </p>

                        {held.map((item) => (
                            <div key={item.id} className="my-4">
                                <details className="bg-primary-100 rounded-md p-3">
                                    <summary>
                                        {item.title}
                                        <span className="text-foreground-400">
                                            {" — "}
                                            {formatDateShort(item.createdAt)}
                                            {item.reason ? ` · ${item.reason}` : ""}
                                        </span>
                                    </summary>
                                    <p className="whitespace-pre-wrap my-3">{item.body}</p>
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

            <h2>What has been done</h2>

            {entries.length === 0 ? (
                <p className="text-foreground-400 italic my-6">
                    Nothing has been moderated. This page will fill itself in if
                    that changes.
                </p>
            ) : (
                <ul className="my-6">
                    {entries.map((entry) => (
                        <li key={entry.id} className="my-3">
                            <span>{describe(entry.action)}</span>{" "}
                            {entry.targetType === "post" ? (
                                <Link href={`/discussion/${entry.targetId}`}>
                                    {entry.context}
                                </Link>
                            ) : (
                                <span>{entry.context}</span>
                            )}

                            <span className="text-foreground-400">
                                {" — "}
                                {entry.actorLabel}
                                {" · "}
                                {formatDateTime(entry.createdAt)}
                            </span>

                            {entry.reason && (
                                <p className="text-foreground-400">{entry.reason}</p>
                            )}
                        </li>
                    ))}
                </ul>
            )}
        </div>
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
