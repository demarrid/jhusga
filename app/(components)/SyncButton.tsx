"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import styles from "./SyncButton.module.css";

type Status = "idle" | "running" | "done" | "error";

/** How long the tick or the cross stays up before the button looks idle again. */
const RESULT_SHOWN_MS = 5_000;

const IDLE_LABEL = "Request sync with Drive";

/**
 * Starts the same pass the nightly cron runs, and spins until it finishes.
 *
 * The request is held open for the whole sync -- a minute or two -- rather
 * than polled, because the route has nothing to report until it is done. What
 * it says afterwards (synced, nothing changed, try again in five minutes) is
 * the button's tooltip and is announced to screen readers.
 */
export default function SyncButton() {
    const router = useRouter();
    const [status, setStatus] = useState<Status>("idle");
    const [message, setMessage] = useState(IDLE_LABEL);
    const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
        return () => {
            if (resetTimer.current) clearTimeout(resetTimer.current);
        };
    }, []);

    async function requestSync() {
        if (status === "running") return;
        if (resetTimer.current) clearTimeout(resetTimer.current);

        setStatus("running");
        setMessage("Syncing with Drive…");

        let ok = false;
        let reply = "The sync could not be reached.";

        try {
            const response = await fetch("/api/sync", { method: "POST" });
            const body = (await response.json().catch(() => null)) as
                | { ok?: boolean; message?: string }
                | null;
            ok = response.ok && body?.ok === true;
            reply = body?.message ?? (ok ? "Synced." : "The sync could not be started.");
        } catch {
            // Network failure; the default reply above says so.
        }

        setStatus(ok ? "done" : "error");
        setMessage(reply);
        if (ok) router.refresh();

        resetTimer.current = setTimeout(() => setStatus("idle"), RESULT_SHOWN_MS);
    }

    const running = status === "running";

    return (
        <span className={styles.wrap}>
            <button
                type="button"
                className={status === "idle" ? styles.button : `${styles.button} ${styles[status]}`}
                onClick={requestSync}
                disabled={running}
                aria-busy={running}
                aria-label={running ? message : IDLE_LABEL}
                title={message}
            >
                <svg
                    className={styles.icon}
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                >
                    <path d="M21 12a9 9 0 1 1-2.64-6.36" />
                    <path d="M21 4v5h-5" />
                </svg>
            </button>
            <span role="status" className={styles.hiddenStatus}>
                {status === "idle" ? "" : message}
            </span>
        </span>
    );
}
