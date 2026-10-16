'use server'

import { MAX_QUESTION_CHARS } from "@/config/search";
import {
    answerQuestion,
    sourceDocumentsForQuestion,
    type QuestionAnswer,
    type ReadingDocument,
} from "@/lib/search";
import { demoModeEnabled } from "@/lib/data-mode";
import { demoSearchAnswer } from "@/lib/demo-data";

/**
 * Asking the archive a question.
 *
 * The one place on this site where a reader's action can cost a model call, so
 * it is also the one place with a rate limit. Everything else is generated on
 * the cron path and only read here.
 */

/**
 * Answers are cached by question, so the limit only has to stop a flood of
 * *distinct* questions -- a crawler, or someone pasting a dictionary in. A
 * reader typing follow-ups is nowhere near it.
 */
const WINDOW_MS = 60_000;
const MAX_ANSWERS_PER_WINDOW = 12;

/**
 * Naming the documents is Postgres rather than a model, so it is held to a
 * looser limit than answering -- but still to one. It ranks the whole passage
 * index, and it is asked for on every question the reader types.
 */
const MAX_LOOKUPS_PER_WINDOW = 40;

// Per-instance, which is the honest bound available without a shared store:
// it caps what one serverless instance will spend, not what the fleet will.
// Worth replacing with a Postgres counter if the site is ever a target.
const recentAnswers: number[] = [];
const recentLookups: number[] = [];

function withinRateLimit(calls: number[], max: number): boolean {
    const now = Date.now();
    while (calls.length > 0 && now - calls[0]! > WINDOW_MS) {
        calls.shift();
    }
    if (calls.length >= max) return false;
    calls.push(now);
    return true;
}

export async function askArchive(
    question: string,
): Promise<QuestionAnswer> {
    const asked = question.trim().slice(0, MAX_QUESTION_CHARS);

    const empty: QuestionAnswer = {
        question: asked,
        scope: "all",
        focus: "current",
        reading: "current",
        status: "empty",
        content: "",
        citations: [],
        matches: [],
        timeframe: null,
        generatedAt: null,
        error: null,
    };

    if (asked.length < 3) return empty;

    if (demoModeEnabled()) return demoSearchAnswer(asked);

    if (!withinRateLimit(recentAnswers, MAX_ANSWERS_PER_WINDOW)) {
        return {
            ...empty,
            status: "unavailable",
            error: "Too many questions at once. Try again in a minute.",
        };
    }

    return answerQuestion(asked);
}

/**
 * The documents a question will be read from, without waiting for an answer.
 *
 * Retrieval is what the question box reports while the model is still
 * working. Asked for alongside askArchive and answered from the same pass
 * over the index, so the pair costs what the answer alone used to.
 *
 * An empty list is a fair answer to give when the limit is hit: the status
 * line falls back to saying the archive is being looked through, and the
 * answer below it is unaffected.
 */
export async function askArchiveSources(
    question: string,
): Promise<ReadingDocument[]> {
    const asked = question.trim().slice(0, MAX_QUESTION_CHARS);
    if (asked.length < 3) return [];

    if (demoModeEnabled()) {
        return demoSearchAnswer(asked).matches.map((match) => ({
            id: match.id,
            title: match.title,
        }));
    }

    if (!withinRateLimit(recentLookups, MAX_LOOKUPS_PER_WINDOW)) return [];

    return sourceDocumentsForQuestion(asked);
}
