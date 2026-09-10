"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { createPost } from "@/api/forum";
import {
    BODY_MAX_CHARS,
    DEFAULT_CATEGORY_SLUG,
    FORUM_CATEGORIES,
    TITLE_MAX_CHARS,
} from "@/config/forum";
import styles from "@/app/discussion/discussion.module.css";

/**
 * Writing a thread.
 *
 * The one control here worth explaining is the name checkbox, which only
 * appears for officeholders and is off every time the form loads. Defaulting
 * it on would make anonymity something an officer has to remember to ask for,
 * and the whole point of the arrangement is the other way round.
 */
export default function NewPostForm({
    officeLabel,
}: {
    /** The office to offer to sign as, or null for everybody else. */
    officeLabel: string | null;
}) {
    const router = useRouter();
    const [title, setTitle] = useState("");
    const [body, setBody] = useState("");
    const [categorySlug, setCategorySlug] = useState(DEFAULT_CATEGORY_SLUG);
    const [named, setNamed] = useState(false);
    const [error, setError] = useState("");
    const [pending, startTransition] = useTransition();

    function submit() {
        startTransition(async () => {
            setError("");
            const result = await createPost({
                title,
                body,
                categorySlug,
                postAsOfficer: named,
            });

            if (!result.ok || !result.id) {
                setError(result.error ?? "That did not post.");
                return;
            }

            router.push(`/discussion/${result.id}`);
            router.refresh();
        });
    }

    return (
        <form
            className={styles.form}
            onSubmit={(event) => {
                event.preventDefault();
                submit();
            }}
        >
            <p className={styles.field}>
                <label htmlFor="post-title">
                    Title
                </label>
                <input
                    id="post-title"
                    type="text"
                    value={title}
                    maxLength={TITLE_MAX_CHARS}
                    placeholder="What is this about?"
                    className={styles.input}
                    onChange={(event) => setTitle(event.target.value)}
                />
            </p>

            <p className={styles.field}>
                <label htmlFor="post-category">
                    Category
                </label>
                <select
                    id="post-category"
                    value={categorySlug}
                    className={styles.select}
                    onChange={(event) => setCategorySlug(event.target.value)}
                >
                    {FORUM_CATEGORIES.map((category) => (
                        <option key={category.slug} value={category.slug}>
                            {category.name}
                        </option>
                    ))}
                </select>
            </p>

            <p className={styles.field}>
                <label htmlFor="post-body">
                    What you want to say
                </label>
                <textarea
                    id="post-body"
                    value={body}
                    rows={10}
                    maxLength={BODY_MAX_CHARS}
                    className={styles.textarea}
                    onChange={(event) => setBody(event.target.value)}
                />
                <span className={styles.fieldNote}>
                    {body.length.toLocaleString()} of{" "}
                    {BODY_MAX_CHARS.toLocaleString()} characters
                </span>
            </p>

            {officeLabel && (
                <p className={styles.field}>
                    <label className={styles.checkboxLabel}>
                        <input
                            type="checkbox"
                            checked={named}
                            onChange={(event) => setNamed(event.target.checked)}
                        />
                        Post on the record, as {officeLabel}
                    </label>
                    <span className={styles.fieldNote}>
                        Leave this off and the post is anonymous, exactly like
                        anyone else&rsquo;s.
                    </span>
                </p>
            )}

            <p className={styles.formActions}>
                <button
                    type="submit"
                    disabled={pending || title.trim().length < 8 || body.trim().length < 10}
                    className={styles.submitButton}
                >
                    {pending ? "Posting…" : "Post"}
                </button>
                <span className={styles.fieldNote}>
                    Once posted this stays up. You cannot delete it; a moderator
                    can, and the reason is published.
                </span>
            </p>

            <div aria-live="polite">{error && <p className={styles.error}>{error}</p>}</div>
        </form>
    );
}
