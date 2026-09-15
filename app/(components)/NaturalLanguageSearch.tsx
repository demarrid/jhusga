"use client";

import Link from "next/link";
import {
    useEffect,
    useRef,
    useState,
    useSyncExternalStore,
    useTransition,
    type CSSProperties,
} from "react";

import { askArchive, askArchiveSources } from "@/api/search";
import CitedProse from "@/app/(components)/CitedProse";
import { MAX_QUESTION_CHARS, describeQuestionReading } from "@/config/search";
import { SESSION_NUMBER, sessionOrdinal } from "@/config/session";
import { proseLine } from "@/lib/cite";
import { formatDateShort } from "@/lib/dates";
import { documentKindLabel } from "@/lib/kinds";
import type { MatchedDocument, QuestionAnswer, ReadingDocument } from "@/lib/search";

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
    "Who is currently in the Judiciary branch?",
    "What meetings can I attend?",
    "What is a Parlimentarian?",
    "Why are the Bylaws so long?",
    "How do I run for office?"
];

/** Milliseconds each example stays visible before sliding to the next. */
const EXAMPLE_CYCLE_MS = 2_800;

/** First item repeated at the end so the carousel can snap back without reversing. */
const EXAMPLE_LOOP = [...EXAMPLES, EXAMPLES[0]];

/** How long each document stays current in the reading status. */
function readingStepMs(count: number): number {
    if (count <= 1) return 2_200;
    if (count <= 4) return 1_800;
    if (count <= 8) return 1_400;
    return 900;
}

/** A list longer than this is reported as a count, not walked line by line. */
const READING_LIST_LIMIT = 12;

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

/**
 * How far through the documents the status line has got.
 *
 * One piece of state rather than two, because an index only means anything
 * against the list it counts: kept apart, the position of the last question
 * survives into the next one and the status opens partway down a list it has
 * not read.
 */
type Reading = { documents: ReadingDocument[]; index: number };

const NOTHING_READ: Reading = { documents: [], index: 0 };

export default function NaturalLanguageSearch() {
    const [question, setQuestion] = useState("");
    const [answer, setAnswer] = useState<QuestionAnswer | null>(null);
    const [reading, setReading] = useState<Reading>(NOTHING_READ);
    const [pending, startTransition] = useTransition();
    const [exampleIndex, setExampleIndex] = useState(0);
    const [exampleSlide, setExampleSlide] = useState(true);
    const reducedMotion = usePrefersReducedMotion();
    const asking = useRef(false);

    useEffect(() => {
        if (question.length > 0) return;

        if (window.matchMedia(REDUCED_MOTION_QUERY).matches) return;

        const timer = window.setInterval(() => {
            setExampleIndex((index) => index + 1);
        }, EXAMPLE_CYCLE_MS);

        return () => window.clearInterval(timer);
    }, [question]);

    const readingDocuments = reading.documents;

    useEffect(() => {
        if (!pending || reducedMotion || readingDocuments.length === 0) return;

        const timer = window.setInterval(() => {
            setReading((current) =>
                current.index >= current.documents.length
                    ? current
                    : { ...current, index: current.index + 1 },
            );
        }, readingStepMs(readingDocuments.length));

        return () => window.clearInterval(timer);
    }, [pending, reducedMotion, readingDocuments]);

    function finishExampleLoop() {
        if (exampleIndex !== EXAMPLES.length) return;

        setExampleSlide(false);
        setExampleIndex(0);
        requestAnimationFrame(() => {
            requestAnimationFrame(() => setExampleSlide(true));
        });
    }

    function ask(asked: string) {
        // The button is disabled while a question is in flight, but the input
        // is not, so without this a held Enter key starts a second pair of
        // requests whose replies race the first. A ref rather than `pending`,
        // because two submits in one tick read the same stale flag.
        if (asking.current || asked.trim().length < 3) return;
        asking.current = true;

        // Cleared here rather than inside the transition below: an update made
        // in an async transition does not reach the screen until that
        // transition settles, which would leave the last question's documents
        // on show for the whole of the next one.
        setAnswer(null);
        setReading(NOTHING_READ);

        startTransition(async () => {
            // Retrieval is started first and in the same tick as generation, so
            // the names of the documents being read can arrive while the model
            // is still working. See askArchiveSources.
            let finished = false;
            const sourcesPromise = askArchiveSources(asked)
                .then((documents) => {
                    if (!finished) setReading({ documents, index: 0 });
                })
                .catch(() => {});

            try {
                setAnswer(await askArchive(asked));
            } finally {
                finished = true;
                await sourcesPromise;
                asking.current = false;
            }
        });
    }

    // The bar only measures the walk through the documents, which is the part
    // whose length is known. Once it reaches the end the model is still
    // writing, so the bar goes back to the indeterminate sweep rather than
    // sitting full -- a bar that fills and then stops reads as a hang.
    const walkingSources =
        pending && !reducedMotion && reading.index < reading.documents.length;
    const readingProgress = walkingSources
        ? (reading.index + 1) / (reading.documents.length + 1)
        : 0;

    return (
        <div className={styles.panel}>
            <form
                className={styles.form}
                onSubmit={(event) => {
                    event.preventDefault();
                    ask(question);
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
                        className={[
                            styles.loadingTrack,
                            pending ? styles.loading : "",
                            walkingSources ? styles.determinate : "",
                        ]
                            .filter(Boolean)
                            .join(" ")}
                        style={
                            walkingSources
                                ? ({ "--reading-progress": readingProgress } as CSSProperties)
                                : undefined
                        }
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
            </form>

            <div className={styles.answerRegion} aria-busy={pending}>
                {pending && (
                    <ReadingStatus
                        documents={reading.documents}
                        index={reading.index}
                        reducedMotion={reducedMotion}
                    />
                )}
                <div aria-live="polite">
                    {answer && !pending && <Answer answer={answer} />}
                </div>
            </div>
        </div>
    );
}

/**
 * What is being read while an answer is still being written.
 *
 * Retrieval returns in a moment; generation does not. The names below are the
 * documents that retrieval picked, walked through one at a time so the wait
 * is a progress report rather than a blank pause. Screen readers hear the
 * count once, not every title as it cycles.
 */
function ReadingStatus({
    documents,
    index,
    reducedMotion,
}: {
    documents: ReadingDocument[];
    index: number;
    reducedMotion: boolean;
}) {
    if (documents.length === 0) {
        return (
            <p className={styles.readingStatus} aria-live="polite">
                Looking through the archive…
            </p>
        );
    }

    const total = documents.length;
    const plural = total === 1 ? "" : "s";
    const writing = !reducedMotion && index >= total;
    const current = headlineDocument(documents, index, reducedMotion);
    const announcement = writing
        ? `Writing an answer from ${total} document${plural}.`
        : `Reading ${total} document${plural}.`;

    return (
        <div className={styles.reading}>
            <p className={styles.readingAnnouncement} aria-live="polite">
                {announcement}
            </p>
            <p className={styles.readingStatus} aria-hidden="true">
                {writing
                    ? "Writing an answer from those documents…"
                    : reducedMotion
                      ? `Reading ${total} document${plural}`
                      : `Reading ${index + 1} of ${total} document${plural}`}
            </p>
            {current && (
                <p key={current.id} className={styles.readingTitle} aria-hidden="true">
                    {current.title}
                </p>
            )}
            {total > 1 && total <= READING_LIST_LIMIT && (
                <ol className={styles.readingList} aria-hidden="true">
                    {documents.map((document, documentIndex) => (
                        <li
                            key={document.id}
                            className={readingItemClass(documentIndex, index, reducedMotion)}
                        >
                            {document.title}
                        </li>
                    ))}
                </ol>
            )}
        </div>
    );
}

/**
 * The document named in large type, if any.
 *
 * With motion, whichever one the status has reached. Without, nothing moves
 * while the reader waits, so a lone document is named and a list is left to
 * the list below.
 */
function headlineDocument(
    documents: ReadingDocument[],
    index: number,
    reducedMotion: boolean,
): ReadingDocument | null {
    if (reducedMotion) return documents.length === 1 ? documents[0] : null;
    return index < documents.length ? documents[index] : null;
}

function readingItemClass(
    documentIndex: number,
    index: number,
    reducedMotion: boolean,
): string | undefined {
    if (reducedMotion) return undefined;
    if (documentIndex === index) return styles.readingNow;
    return documentIndex < index ? styles.readingDone : undefined;
}

/**
 * Whether the reader has asked for less motion.
 *
 * Subscribed to rather than read once, so changing the system setting takes
 * effect without a reload. The server and the first client render both answer
 * no, which is the markup the page is hydrated from.
 */
function usePrefersReducedMotion(): boolean {
    return useSyncExternalStore(subscribeToReducedMotion, readReducedMotion, () => false);
}

function subscribeToReducedMotion(onChange: () => void): () => void {
    const media = window.matchMedia(REDUCED_MOTION_QUERY);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
}

function readReducedMotion(): boolean {
    return window.matchMedia(REDUCED_MOTION_QUERY).matches;
}

function Answer({ answer }: { answer: QuestionAnswer }) {
    const scopeLabel =
        answer.reading === "current"
            ? "the documents now in force"
            : answer.reading === "membership"
              ? "the contact list"
              : "the archive";

    const reason = noAnswerReason(answer, scopeLabel);

    return (
        <div className={styles.answer}>
            <p className={styles.readingNote}>
                {describeQuestionReading(answer.reading, answer.timeframe)}
            </p>

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
