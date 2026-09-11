"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { createReply } from "@/api/forum";
import Checkbox from "@/app/(components)/Checkbox";
import { BODY_MAX_CHARS } from "@/config/forum";
import styles from "@/app/discussion/discussion.module.css";

export default function ReplyForm({
    postId,
    officeLabel,
}: {
    postId: string;
    officeLabel: string | null;
}) {
    const router = useRouter();
    const [body, setBody] = useState("");
    const [named, setNamed] = useState(false);
    const [error, setError] = useState("");
    const [pending, startTransition] = useTransition();

    function submit() {
        startTransition(async () => {
            setError("");
            const result = await createReply({ postId, body, postAsOfficer: named });

            if (!result.ok) {
                setError(result.error ?? "That did not post.");
                return;
            }

            setBody("");
            setNamed(false);
            router.refresh();
        });
    }

    return (
        <form
            className={styles.replyForm}
            onSubmit={(event) => {
                event.preventDefault();
                submit();
            }}
        >
            <label htmlFor="reply-body">
                Reply
            </label>
            <textarea
                id="reply-body"
                value={body}
                rows={6}
                maxLength={BODY_MAX_CHARS}
                className={styles.textarea}
                onChange={(event) => setBody(event.target.value)}
            />

            {officeLabel && (
                <span className={styles.checkboxLabel}>
                    <Checkbox checked={named} onChange={setNamed}>
                        Reply publicly, as {officeLabel}
                    </Checkbox>
                </span>
            )}

            <p className={styles.formActions}>
                <button
                    type="submit"
                    disabled={pending || body.trim().length < 10}
                    className={styles.submitButton}
                >
                    {pending ? "Posting…" : "Reply"}
                </button>
            </p>

            <div aria-live="polite">{error && <p className={styles.error}>{error}</p>}</div>
        </form>
    );
}
