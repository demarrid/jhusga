"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { createReply } from "@/api/forum";
import { BODY_MAX_CHARS } from "@/config/forum";

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
            className="my-6"
            onSubmit={(event) => {
                event.preventDefault();
                submit();
            }}
        >
            <label className="block" htmlFor="reply-body">
                Reply
            </label>
            <textarea
                id="reply-body"
                value={body}
                rows={6}
                maxLength={BODY_MAX_CHARS}
                className="border border-foreground-800 rounded-md px-2 py-1 w-full bg-background"
                onChange={(event) => setBody(event.target.value)}
            />

            {officeLabel && (
                <label className="flex flex-row items-center gap-2 my-2">
                    <input
                        type="checkbox"
                        checked={named}
                        onChange={(event) => setNamed(event.target.checked)}
                    />
                    Reply on the record, as {officeLabel}
                </label>
            )}

            <p className="my-2">
                <button
                    type="submit"
                    disabled={pending || body.trim().length < 10}
                    className="bg-primary-400 text-white px-3 py-1 rounded-md disabled:opacity-50"
                >
                    {pending ? "Posting…" : "Reply"}
                </button>
            </p>

            <div aria-live="polite">{error && <p className="text-red-500">{error}</p>}</div>
        </form>
    );
}
