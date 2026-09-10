"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { sendSignInCode, submitSignInCode } from "@/api/auth";
import { ALLOWED_EMAIL_DOMAINS } from "@/config/forum";
import styles from "@/app/auth/auth.module.css";

/**
 * Signing in, in two steps.
 *
 * The address is typed here and nowhere else. It is held in this component's
 * state long enough to submit the code alongside it, and it is never put in
 * the URL, which would otherwise leave it in a browser history and in every
 * server log along the way.
 */
export default function SignIn({ next }: { next?: string }) {
    const router = useRouter();
    const [email, setEmail] = useState("");
    const [code, setCode] = useState("");
    const [sent, setSent] = useState(false);
    const [message, setMessage] = useState("");
    const [error, setError] = useState("");
    const [pending, startTransition] = useTransition();

    function request() {
        startTransition(async () => {
            setError("");
            const result = await sendSignInCode(email);
            if (!result.ok) {
                setError(result.error ?? "That did not work.");
                return;
            }
            setSent(true);
            setMessage(result.message ?? "");
        });
    }

    function verify() {
        startTransition(async () => {
            setError("");
            const result = await submitSignInCode(email, code);
            if (!result.ok) {
                setError(result.error ?? "That did not work.");
                return;
            }
            // The address is dropped from memory as the page changes; there is
            // nothing to clear because nothing was kept.
            router.push(next ?? "/discussion");
            router.refresh();
        });
    }

    return (
        <section className={styles.signIn}>
            <p>
                A Hopkins address ({ALLOWED_EMAIL_DOMAINS.join(", ")}) is sent a
                one-time code; it is stored only as a one-way hash, and
                nothing posted afterward is attached to it.
            </p>

            {!sent ? (
                <form
                    className={styles.authForm}
                    onSubmit={(event) => {
                        event.preventDefault();
                        request();
                    }}
                >
                    <input
                        type="email"
                        value={email}
                        autoComplete="email"
                        placeholder="jdoe1@jh.edu"
                        aria-label="Your Hopkins email address"
                        className={styles.input}
                        onChange={(event) => setEmail(event.target.value)}
                    />
                    <button
                        type="submit"
                        disabled={pending || email.trim().length < 5}
                        className={styles.button}
                    >
                        {pending ? "Sending…" : "Send code"}
                    </button>
                </form>
            ) : (
                <form
                    className={styles.authForm}
                    onSubmit={(event) => {
                        event.preventDefault();
                        verify();
                    }}
                >
                    <input
                        type="text"
                        value={code}
                        inputMode="numeric"
                        autoComplete="one-time-code"
                        maxLength={6}
                        placeholder="000000"
                        aria-label="The six-digit code"
                        className={`${styles.input} ${styles.codeInput}`}
                        onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))}
                    />
                    <button
                        type="submit"
                        disabled={pending || code.length !== 6}
                        className={styles.button}
                    >
                        {pending ? "Checking…" : "Sign in"}
                    </button>
                    <button
                        type="button"
                        className={styles.textButton}
                        onClick={() => {
                            setSent(false);
                            setCode("");
                            setMessage("");
                            setError("");
                        }}
                    >
                        Use a different address
                    </button>
                </form>
            )}

            <div aria-live="polite">
                {error && <p className={styles.error}>{error}</p>}
                {!error && message && <p className={styles.message}>{message}</p>}
            </div>
        </section>
    );
}
