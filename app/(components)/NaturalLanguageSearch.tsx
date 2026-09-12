"use client";

import Link from "next/link";
import { useEffect, useState, useTransition, type CSSProperties } from "react";

import { askArchive } from "@/api/search";
import Checkbox from "@/app/(components)/Checkbox";
import CitedProse from "@/app/(components)/CitedProse";
import { MAX_QUESTION_CHARS, type SearchScope } from "@/config/search";
import { SESSION_NUMBER, sessionOrdinal } from "@/config/session";
import { proseLine } from "@/lib/cite";
import { formatDateShort } from "@/lib/dates";
import { documentKindLabel } from "@/lib/kinds";
import type { MatchedDocument, QuestionAnswer } from "@/lib/search";

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
 *
 * A question naming a period is answered by date rather than by word, so the
 * list it returns is the period itself -- every document the archive holds for
 * it, newest first -- and is worth reading whether or not prose was written
 * about it. See lib/when.ts.
 */

const EXAMPLES = [
    "What happened last week?",
    "How many Caucus Senators can there be?",
    "What does it take to amend the constitution?",
    "How is a funding bill passed?",
    "What are the current initiatives?",
    "Who is currently in Judiciary branch?",
    "What meetings can I attend?",
    "What is a Parlimentarian?",
    "Why are the Bylaws so long?",
    "How do I run for office?"
];

/** Milliseconds each example stays visible before sliding to the next. */
const EXAMPLE_CYCLE_MS = 2_800;

/** First item repeated at the end so the carousel can snap back without reversing. */
const EXAMPLE_LOOP = [...EXAMPLES, EXAMPLES[0]];

export default function NaturalLanguageSearch() {
    const [question, setQuestion] = useState("");
    const [scope, setScope] = useState<SearchScope>("current");
    const [answer, setAnswer] = useState<QuestionAnswer | null>(null);
    const [pending, startTransition] = useTransition();
    const [exampleIndex, setExampleIndex] = useState(0);
    const [exampleSlide, setExampleSlide] = useState(true);

    useEffect(() => {
        if (question.length > 0) return;

        const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        if (reducedMotion) return;

        const timer = window.setInterval(() => {
            setExampleIndex((index) => index + 1);
        }, EXAMPLE_CYCLE_MS);

        return () => window.clearInterval(timer);
    }, [question]);

    function finishExampleLoop() {
        if (exampleIndex !== EXAMPLES.length) return;

        setExampleSlide(false);
        setExampleIndex(0);
        requestAnimationFrame(() => {
            requestAnimationFrame(() => setExampleSlide(true));
        });
    }

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
                <div className={styles.questionField}>
                    <div className={styles.questionInputWrap}>
                        {question.length === 0 && (
                            <div className={styles.exampleCycle} aria-hidden="true">
                                <ul
                                    className={
                                        exampleSlide
                                            ? styles.exampleCycleTrack
                                            : `${styles.exampleCycleTrack} ${styles.exampleCycleTrackInstant}`
                                    }
                                    style={{ "--example-index": exampleIndex } as CSSProperties}
                                    onTransitionEnd={finishExampleLoop}
                                >
                                    {EXAMPLE_LOOP.map((example, index) => (
                                        <li key={`${example}-${index}`}>{example}</li>
                                    ))}
                                </ul>
                            </div>
                        )}
                        <input
                            type="text"
                            value={question}
                            maxLength={MAX_QUESTION_CHARS}
                            placeholder=""
                            aria-label="Ask a question about the SGA"
                            className={styles.question}
                            onChange={(event) => setQuestion(event.target.value)}
                        />
                    </div>
                    <div
                        className={`${styles.loadingTrack} ${pending ? styles.loading : ""}`}
                        aria-hidden="true"
                    >
                        <span />
                    </div>
                </div>
                <button
                    type="submit"
                    disabled={pending || question.trim().length < 3}
                    className={styles.askButton}
                >
                    {pending ? "Reading…" : "Ask"}
                </button>
                <div className={styles.scopeToggle}>
                    <Checkbox
                        checked={scope === "all"}
                        onChange={(checked) => {
                            const next: SearchScope = checked ? "all" : "current";
                            setScope(next);
                            // Re-asking immediately is the point of the toggle:
                            // it is how a reader moves a question from "what
                            // are the rules now" to "when did that change".
                            if (answer) ask(question, next);
                        }}
                    >
                        Include past sessions
                    </Checkbox>
                </div>
            </form>

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
                    <h3>{matchesHeading(answer)}</h3>
                    <ul>
                        {answer.matches.map((match) => (
                            <Match key={match.id} match={match} />
                        ))}
                    </ul>
                </div>
            )}

            {answer.status === "empty" && answer.matches.length === 0 && (
                <p className={styles.notice}>
                    {answer.timeframe
                        ? `${sentenceCase(scopeLabel)} holds nothing for ${answer.timeframe.label}.`
                        : `Nothing in ${scopeLabel} matches those words.`}
                    {answer.scope === "current" &&
                        " Past sessions are not searched unless you ask for them."}
                </p>
            )}
        </div>
    );
}

/**
 * One document in the results.
 *
 * The restatement is shown in place of the passage that matched, because a
 * reader choosing between results wants to know what each document does, not
 * to read the middle of a sentence out of one they have not opened. The
 * passage is the fallback for documents the archive has not summarised yet.
 */
function Match({ match }: { match: MatchedDocument }) {
    const preview = match.summary ? proseLine(match.summary, 320) : match.excerpt;

    return (
        <li>
            <Link href={`/documents/${match.id}`}>{match.title}</Link>
            <span className={styles.matchMetadata}>
                {" — "}
                {[
                    formatDateShort(match.date),
                    documentKindLabel(match.kind),
                    match.summary ? "" : match.heading,
                    match.sessionNumber !== null &&
                    match.sessionNumber !== SESSION_NUMBER &&
                    `${sessionOrdinal(match.sessionNumber)} session`,
                ]
                    .filter(Boolean)
                    .join(" · ")}
            </span>
            {preview && <p>{preview}</p>}
        </li>
    );
}

/** What the list under an answer is a list of. */
function matchesHeading(answer: QuestionAnswer): string {
    if (answer.timeframe) {
        return answer.timeframe.outside
            ? "The most recent documents"
            : `Documents for ${answer.timeframe.label}`;
    }

    return answer.content ? "Read for this answer" : "Closest documents";
}

function sentenceCase(text: string): string {
    return text.charAt(0).toUpperCase() + text.slice(1);
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
    const { timeframe } = answer;

    // A question about a period is not unanswered when there is no prose: the
    // list below *is* the answer, and it is right by construction.
    if (timeframe && answer.matches.length > 0 && !answer.content) {
        return timeframe.outside
            ? `${sentenceCase(scopeLabel)} holds nothing for ${timeframe.label}. The most recent documents are below.`
            : `Every document in ${scopeLabel} for ${timeframe.label} is below, newest first.`;
    }

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
