"use client";

import Link from "next/link";
import { useState, useTransition } from "react";

import { askArchive } from "@/api/search";
import CitedProse from "@/app/(components)/CitedProse";
import { MAX_QUESTION_CHARS, type SearchScope } from "@/config/search";
import { SESSION_NUMBER, sessionOrdinal } from "@/config/session";
import { documentKindLabel } from "@/lib/kinds";
import type { QuestionAnswer } from "@/lib/search";

/**
 * Asking the archive a question in the reader's own words.
 *
 * Separate from the filters below it, and deliberately so: those narrow a list
 * of files, this one answers a question. Someone who wants to know how many
 * caucus senators there can be does not know which document says so, and
 * typing the question into a filename filter finds nothing.
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
        <section className="bg-primary-100 rounded-md p-4 my-6">
            <h2>Ask the archive</h2>

            <p className="text-foreground-400">
                A question in your own words, answered from the documents below.
                Every claim links to the passage it came from.
            </p>

            <form
                className="flex flex-row flex-wrap items-center gap-2 my-3"
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
                    className="border border-foreground-800 rounded-md px-2 py-1 grow min-w-64 bg-background"
                    onChange={(event) => setQuestion(event.target.value)}
                />

                <button
                    type="submit"
                    disabled={pending || question.trim().length < 3}
                    className="bg-primary-400 text-white px-3 py-1 rounded-md disabled:opacity-50"
                >
                    {pending ? "Reading…" : "Ask"}
                </button>

                <label className="flex flex-row items-center gap-1">
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
                <p className="text-foreground-400 text-sm">
                    {"For example: "}
                    {EXAMPLES.map((example, index) => (
                        <span key={example}>
                            {index > 0 && " · "}
                            <button
                                type="button"
                                className="text-primary-700 underline"
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

            <div aria-live="polite" aria-busy={pending}>
                {answer && !pending && <Answer answer={answer} />}
            </div>
        </section>
    );
}

function Answer({ answer }: { answer: QuestionAnswer }) {
    const scopeLabel =
        answer.scope === "all"
            ? "every session in the archive"
            : `the ${sessionOrdinal(SESSION_NUMBER)} session`;

    const reason = noAnswerReason(answer, scopeLabel);

    return (
        <div className="my-3">
            {answer.content ? (
                <div className="bg-background rounded-md p-3">
                    {answer.status === "stale" && (
                        <p className="text-foreground-400 italic">
                            A passage cited below has changed since this was answered, so
                            it is awaiting recheck.
                        </p>
                    )}

                    <CitedProse content={answer.content} citations={answer.citations} />
                </div>
            ) : (
                reason && <p className="text-foreground-400 italic">{reason}</p>
            )}

            {answer.matches.length > 0 && (
                <div className="my-3">
                    <h3>{answer.content ? "Read for this answer" : "Closest documents"}</h3>
                    <ul>
                        {answer.matches.map((match) => (
                            <li key={match.id} className="my-2">
                                <Link href={`/documents/${match.id}`}>{match.title}</Link>
                                <span className="text-foreground-400">
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
                                <p className="text-foreground-400 text-sm">{match.excerpt}</p>
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            {answer.status === "empty" && answer.matches.length === 0 && (
                <p className="text-foreground-400 italic">
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
