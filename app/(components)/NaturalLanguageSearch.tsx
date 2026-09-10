"use client";

import Link from "next/link";
import { useState, useTransition } from "react";

import { askArchive } from "@/api/search";
import CitedProse from "@/app/(components)/CitedProse";
import { MAX_QUESTION_CHARS, type SearchScope } from "@/config/search";
import { SESSION_NUMBER, sessionOrdinal } from "@/config/session";
import { documentKindLabel } from "@/lib/kinds";
import type { QuestionAnswer } from "@/lib/search";

import styles from "./NaturalLanguageSearch.module.css";

/**
 * Asking the archive a question in the reader's own words.
 *
 * Shown alongside the document filters as the second mode of one archive
 * search surface. Filters narrow a list of files; this mode answers a question
 * for someone who may not know which governing document contains the answer.
 *
 * The two halves of the reply are shown differently on purpose. The documents
 * that matched come from Postgres and are always right about what they are --
 * a list of places to read. The written answer comes from a model and is only
 * shown when every quote in it was found verbatim in a stored document, with
 * each claim carrying the passage it rests on. When there is no checked answer
 * the reader still gets the list, rather than an apology.
 */

const EXAMPLES = [
    "How many caucus senators can there be?",
    "When was the first caucus position introduced?",
    "What does it take to amend the constitution?",
    "How is a funding bill passed?",
];

export default function NaturalLanguageSearch() {
    const [question, setQuestion] = useState("");
    const [scope, setScope] = useState<SearchScope>("current");
    const [answer, setAnswer] = useState<QuestionAnswer | null>(null);
    const [pending, startTransition] = useTransition();

    function ask(asked: string, withScope: SearchScope) {
        if (asked.trim().length < 3) return;
        startTransition(async () => {
            setAnswer(await askArchive(asked, withScope));
        });
    }

    return (
        <div className={styles.panel}>
            <form
                className={styles.form}
                onSubmit={(event) => {
                    event.preventDefault();
                    ask(question, scope);
                }}
            >
                <input
                    type="text"
                    value={question}
                    maxLength={MAX_QUESTION_CHARS}
                    placeholder="How many caucus senators can there be?"
                    aria-label="Ask a question about the SGA"
                    className={styles.question}
                    onChange={(event) => setQuestion(event.target.value)}
                />

                <button
                    type="submit"
                    disabled={pending || question.trim().length < 3}
                    className={styles.askButton}
                >
                    {pending ? "Reading…" : "Ask"}
                </button>

                <label className={styles.scopeToggle}>
                    <input
                        type="checkbox"
                        checked={scope === "all"}
                        onChange={(event) => {
                            const next: SearchScope = event.target.checked ? "all" : "current";
                            setScope(next);
                            // Re-asking immediately is the point of the toggle:
                            // it is how a reader moves a question from "what
                            // are the rules now" to "when did that change".
                            if (answer) ask(question, next);
                        }}
                    />
                    Search past sessions too
                </label>
            </form>

            {!answer && !pending && (
                <p className={styles.examples}>
                    {"For example: "}
                    {EXAMPLES.map((example, index) => (
                        <span key={example}>
                            {index > 0 && " · "}
                            <button
                                type="button"
                                className={styles.exampleButton}
                                onClick={() => {
                                    setQuestion(example);
                                    ask(example, scope);
                                }}
                            >
                                {example}
                            </button>
                        </span>
                    ))}
                </p>
            )}

            <div className={styles.answerRegion} aria-live="polite" aria-busy={pending}>
                {answer && !pending && <Answer answer={answer} />}
            </div>
        </div>
    );
}

function Answer({ answer }: { answer: QuestionAnswer }) {
    const scopeLabel =
        answer.scope === "all"
            ? "every session in the archive"
            : `the ${sessionOrdinal(SESSION_NUMBER)} session`;

    const reason = noAnswerReason(answer, scopeLabel);

    return (
        <div className={styles.answer}>
            {answer.content ? (
                <div className={styles.answerContent}>
                    {answer.status === "stale" && (
                        <p className={styles.notice}>
                            A passage cited below has changed since this was answered, so
                            it is awaiting recheck.
                        </p>
                    )}

                    <CitedProse content={answer.content} citations={answer.citations} />
                </div>
            ) : (
                reason && <p className={styles.notice}>{reason}</p>
            )}

            {answer.matches.length > 0 && (
                <div className={styles.matches}>
                    <h3>{answer.content ? "Read for this answer" : "Closest documents"}</h3>
                    <ul>
                        {answer.matches.map((match) => (
                            <li key={match.id}>
                                <Link href={`/documents/${match.id}`}>{match.title}</Link>
                                <span className={styles.matchMetadata}>
                                    {" — "}
                                    {[
                                        documentKindLabel(match.kind),
                                        match.heading,
                                        match.sessionNumber !== null &&
                                        match.sessionNumber !== SESSION_NUMBER &&
                                        `${sessionOrdinal(match.sessionNumber)} session`,
                                    ]
                                        .filter(Boolean)
                                        .join(" · ")}
                                </span>
                                <p>{match.excerpt}</p>
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            {answer.status === "empty" && answer.matches.length === 0 && (
                <p className={styles.notice}>
                    {`Nothing in ${scopeLabel} matches those words.`}
                    {answer.scope === "current" &&
                        " Past sessions are not searched unless you ask for them."}
                </p>
            )}
        </div>
    );
}

/**
 * Why there is no written answer.
 *
 * Distinguished rather than collapsed into one message, because "the documents
 * do not say" and "we could not check the answer" mean opposite things to
 * someone deciding whether to keep looking. Returns null where the list below
 * already says it.
 */
function noAnswerReason(answer: QuestionAnswer, scopeLabel: string): string | null {
    switch (answer.status) {
        case "empty":
            return answer.matches.length === 0
                ? null
                : `Nothing in ${scopeLabel} answers that outright. The documents below are the closest matches.`;
        case "failed":
            return "No answer could be written whose quotes all check out against the documents, so none is shown. The documents below are where to look.";
        case "unavailable":
            return (
                answer.error ??
                "Written answers are switched off on this deployment. The documents below are what matched."
            );
        default:
            return null;
    }
}
