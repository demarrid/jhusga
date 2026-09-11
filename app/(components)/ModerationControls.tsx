"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { moderate } from "@/api/forum";
import styles from "@/app/discussion/discussion.module.css";

/**
 * A moderator's controls, and the reason box they cannot get past.
 *
 * The reason is required by the server too; it is here as well so that the
 * moderator writes it while looking at the thing they are hiding, rather than
 * afterwards. It is published verbatim next to the removal and in the log.
 */
export default function ModerationControls({
    targetType,
    targetId,
    hidden,
    hiddenBy,
    locked,
}: {
    targetType: "post" | "reply";
    targetId: string;
    hidden: boolean;
    /** "" visible, "screen" awaiting review, "moderator" already decided. */
    hiddenBy: string;
    /** Undefined for a reply, which cannot be locked on its own. */
    locked?: boolean;
}) {
    const router = useRouter();
    const [reason, setReason] = useState("");
    const [error, setError] = useState("");
    const [pending, startTransition] = useTransition();

    const awaitingReview = hidden && hiddenBy === "screen";

    function act(action: "hide" | "uphold" | "restore" | "lock" | "unlock") {
        startTransition(async () => {
            setError("");
            const result = await moderate({ targetType, targetId, action, reason });
            if (!result.ok) {
                setError(result.error ?? "That did not work.");
                return;
            }
            setReason("");
            router.refresh();
        });
    }

    return (
        <div className={styles.moderationControls}>
            <p className={styles.muted}>
                {awaitingReview
                    ? "Screening is holding this, so nobody else can see it. Publishing it or upholding the hold both go in the log under your name — leaving it is the only option that does not."
                    : "Moderating. Whatever you do here is published under your name, with the reason, in the log."}
            </p>

            <p className={styles.field}>
                <input
                    type="text"
                    value={reason}
                    placeholder="Why — this is published"
                    aria-label="Reason, which is published"
                    className={styles.input}
                    onChange={(event) => setReason(event.target.value)}
                />
            </p>

            <p className={styles.moderationActions}>
                {hidden ? (
                    <button
                        type="button"
                        disabled={pending}
                        className={styles.textButton}
                        onClick={() => act("restore")}
                    >
                        {awaitingReview ? "Publish it" : "Restore"}
                    </button>
                ) : (
                    <button
                        type="button"
                        disabled={pending || reason.trim().length < 4}
                        className={styles.dangerButton}
                        onClick={() => act("hide")}
                    >
                        Hide
                    </button>
                )}

                {/*
                  * Ending the hold the other way. It stays withheld, but as
                  * somebody's decision rather than the screening's, which puts
                  * it back in the listing where it can be disputed.
                  */}
                {awaitingReview && (
                    <button
                        type="button"
                        disabled={pending || reason.trim().length < 4}
                        className={styles.dangerButton}
                        onClick={() => act("uphold")}
                    >
                        Uphold the hold
                    </button>
                )}

                {locked !== undefined &&
                    (locked ? (
                        <button
                            type="button"
                            disabled={pending}
                            className={styles.textButton}
                            onClick={() => act("unlock")}
                        >
                            Unlock replies
                        </button>
                    ) : (
                        <button
                            type="button"
                            disabled={pending || reason.trim().length < 4}
                            className={styles.dangerButton}
                            onClick={() => act("lock")}
                        >
                            Lock replies
                        </button>
                    ))}
            </p>

            <div aria-live="polite">{error && <p className={styles.error}>{error}</p>}</div>
        </div>
    );
}
