'use server'

import { MAX_QUESTION_CHARS, type SearchScope } from "@/config/search";
import { answerQuestion, type QuestionAnswer } from "@/lib/search";
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

// Per-instance, which is the honest bound available without a shared store:
// it caps what one serverless instance will spend, not what the fleet will.
// Worth replacing with a Postgres counter if the site is ever a target.
const recentCalls: number[] = [];

function withinRateLimit(): boolean {
    const now = Date.now();
    while (recentCalls.length > 0 && now - recentCalls[0]! > WINDOW_MS) {
        recentCalls.shift();
    }
    if (recentCalls.length >= MAX_ANSWERS_PER_WINDOW) return false;
    recentCalls.push(now);
    return true;
}

export async function askArchive(
    question: string,
    scope: SearchScope = "current",
): Promise<QuestionAnswer> {
    const asked = question.trim().slice(0, MAX_QUESTION_CHARS);

    const empty: QuestionAnswer = {
        question: asked,
        scope,
        status: "empty",
        content: "",
        citations: [],
        matches: [],
        generatedAt: null,
        error: null,
    };

    if (asked.length < 3) return empty;

    if (demoModeEnabled()) return demoSearchAnswer(asked, scope);

    if (!withinRateLimit()) {
        return {
            ...empty,
            status: "unavailable",
            error: "Too many questions at once. Try again in a minute.",
        };
    }

    return answerQuestion(asked, { scope });
}
