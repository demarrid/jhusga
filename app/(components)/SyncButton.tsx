"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import styles from "./SyncButton.module.css";

type Status = "idle" | "running" | "done" | "error";

/** How long the tick or the cross stays up before the button looks idle again. */
const RESULT_SHOWN_MS = 5_000;

/** How often a running sync is asked how it is getting on. */
const POLL_MS = 3_000;

/** A sync is a few minutes; past this the button stops waiting and says so. */
const GIVE_UP_MS = 20 * 60_000;

const IDLE_LABEL = "Request sync with Drive";

type Reply = { ok?: boolean; message?: string; runId?: string; status?: string; stalled?: boolean };

async function ask(input: string, init?: RequestInit): Promise<{ response: Response; body: Reply | null }> {
    const response = await fetch(input, { cache: "no-store", ...init });
    return { response, body: (await response.json().catch(() => null)) as Reply | null };
}

/**
 * Starts the same pass the nightly cron runs, and spins until it finishes.
 *
 * The sync is worked through in short server invocations over a few minutes,
 * so the button starts it and then polls. A run whose hand-off between
 * invocations was lost is nudged once to resume. What the sync says as it goes
 * and afterwards (synced, nothing changed, try again in five minutes) is the
 * button's tooltip and is announced to screen readers.
 */
export default function SyncButton() {
    const router = useRouter();
    const [status, setStatus] = useState<Status>("idle");
    const [message, setMessage] = useState(IDLE_LABEL);
    const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const mounted = useRef(true);

    useEffect(() => {
        mounted.current = true;
        return () => {
            mounted.current = false;
            if (resetTimer.current) clearTimeout(resetTimer.current);
        };
    }, []);

    async function follow(runId: string): Promise<{ ok: boolean; reply: string }> {
        const started = Date.now();
        let nudged = false;

        while (mounted.current && Date.now() - started < GIVE_UP_MS) {
            await new Promise((resolve) => setTimeout(resolve, POLL_MS));
            const { response, body } = await ask(`/api/sync?run=${encodeURIComponent(runId)}`);
            if (!response.ok) {
                return { ok: false, reply: body?.message ?? "The sync could not be reached." };
            }
            if (body?.status !== "running") {
                return { ok: body?.ok === true, reply: body?.message ?? "Synced." };
            }
            if (body.message) setMessage(body.message);
            if (body.stalled && !nudged) {
                nudged = true;
                await ask("/api/sync", { method: "POST" });
            }
        }
        return { ok: false, reply: "The sync is still running. Check back in a few minutes." };
    }

    async function requestSync() {
        if (status === "running") return;
        if (resetTimer.current) clearTimeout(resetTimer.current);

        setStatus("running");
        setMessage("Syncing with Drive…");

        let ok = false;
        let reply = "The sync could not be reached.";

        try {
            const { response, body } = await ask("/api/sync", { method: "POST" });
            ok = response.ok && body?.ok === true;
            reply = body?.message ?? (ok ? "Synced." : "The sync could not be started.");
            if (ok && body?.runId) {
                setMessage(reply);
                ({ ok, reply } = await follow(body.runId));
            }
        } catch {
            ok = false;
            reply = "The sync could not be reached.";
        }

        if (!mounted.current) return;
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
