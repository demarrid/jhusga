/**
 * Minimal provider-agnostic text generation.
 *
 * Deliberately plain `fetch` against three well-known HTTP APIs rather than an
 * SDK: the only thing this project asks of a model is "read these documents,
 * answer in JSON", and that does not justify a dependency that has to be kept
 * in step with the framework.
 */

export type AiProvider = "anthropic" | "openai" | "gemini";

export type AiRequest = {
    system: string;
    user: string;
    maxTokens?: number;
    /** Ask the provider to constrain the reply to JSON, where it can. */
    json?: boolean;
};

/**
 * Why the model stopped, normalised across the three providers.
 *
 * "length" is the one that matters: it means the reply was cut off mid-flight,
 * which for a reasoning model can happen before a single visible character has
 * been emitted.
 */
export type AiFinishReason = "stop" | "length" | "filtered" | "unknown";

export type AiResult = {
    text: string;
    model: string;
    finishReason: AiFinishReason;
    /** Tokens spent on hidden reasoning, where the provider reports them. */
    reasoningTokens: number;
};

/**
 * Overridable with AI_MODEL. Worth checking against the provider's current
 * model list, since these identifiers are retired periodically.
 */
const DEFAULT_MODELS: Record<AiProvider, string> = {
    anthropic: "claude-sonnet-4-5",
    openai: "gpt-5.1",
    gemini: "gemini-2.5-pro",
};

const REQUEST_TIMEOUT_MS = 120_000;

/**
 * Reasoning models bill their thinking against the same completion budget as
 * their answer, and spend it first. A budget sized for the answer alone can
 * therefore be exhausted before any visible text is produced, which arrives
 * as a successful response with empty content. These bounds keep the first
 * attempt clear of that, and cap how far a retry will climb.
 */
const DEFAULT_MAX_TOKENS = 8_192;
const MIN_JSON_TOKENS = 4_096;
const MAX_RETRY_TOKENS = 32_768;

function provider(): AiProvider {
    const configured = (process.env.AI_PROVIDER || "anthropic").toLowerCase();
    if (configured !== "anthropic" && configured !== "openai" && configured !== "gemini") {
        throw new Error(
            `AI_PROVIDER must be anthropic, openai, or gemini (got "${configured}")`,
        );
    }
    return configured;
}

function apiKey(): string {
    const key = process.env.AI_API_KEY;
    if (!key) throw new Error("AI_API_KEY is not set");
    return key;
}

function modelName(forProvider: AiProvider): string {
    return process.env.AI_MODEL || DEFAULT_MODELS[forProvider];
}

async function postJson(
    url: string,
    headers: Record<string, string>,
    body: unknown,
): Promise<unknown> {
    const response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        cache: "no-store",
    });

    if (!response.ok) {
        const detail = await response.text().catch(() => "");
        throw new Error(
            `${new URL(url).host} returned ${response.status}: ${detail.slice(0, 500)}`,
        );
    }

    return response.json();
}

/** Provider stop reasons, mapped onto the four this module distinguishes. */
function normalizeFinishReason(raw: string | null | undefined): AiFinishReason {
    switch ((raw ?? "").toLowerCase()) {
        case "end_turn":
        case "stop":
        case "stop_sequence":
            return "stop";
        case "max_tokens":
        case "length":
            return "length";
        case "refusal":
        case "content_filter":
        case "safety":
        case "recitation":
        case "prohibited_content":
        case "blocklist":
            return "filtered";
        default:
            return "unknown";
    }
}

export async function generateText(request: AiRequest): Promise<AiResult> {
    const activeProvider = provider();
    const model = modelName(activeProvider);
    const maxTokens = request.maxTokens ?? DEFAULT_MAX_TOKENS;

    if (activeProvider === "anthropic") {
        const payload = (await postJson(
            "https://api.anthropic.com/v1/messages",
            { "x-api-key": apiKey(), "anthropic-version": "2023-06-01" },
            {
                model,
                max_tokens: maxTokens,
                system: request.system,
                messages: [{ role: "user", content: request.user }],
            },
        )) as {
            content?: { type: string; text?: string }[];
            stop_reason?: string;
        };

        const text = (payload.content ?? [])
            .filter((block) => block.type === "text")
            .map((block) => block.text ?? "")
            .join("");
        return {
            text,
            model,
            finishReason: normalizeFinishReason(payload.stop_reason),
            // Extended thinking arrives as its own block type rather than a
            // token count, so there is nothing to report here.
            reasoningTokens: 0,
        };
    }

    if (activeProvider === "openai") {
        const payload = (await postJson(
            "https://api.openai.com/v1/chat/completions",
            { authorization: `Bearer ${apiKey()}` },
            {
                model,
                max_completion_tokens: maxTokens,
                ...(request.json ? { response_format: { type: "json_object" } } : {}),
                // Only sent when configured: the effort levels a model accepts
                // vary, and an unrecognised one is a 400 rather than a default.
                ...(process.env.AI_REASONING_EFFORT
                    ? { reasoning_effort: process.env.AI_REASONING_EFFORT }
                    : {}),
                messages: [
                    { role: "system", content: request.system },
                    { role: "user", content: request.user },
                ],
            },
        )) as {
            choices?: { message?: { content?: string }; finish_reason?: string }[];
            usage?: { completion_tokens_details?: { reasoning_tokens?: number } };
        };

        return {
            text: payload.choices?.[0]?.message?.content ?? "",
            model,
            finishReason: normalizeFinishReason(payload.choices?.[0]?.finish_reason),
            reasoningTokens:
                payload.usage?.completion_tokens_details?.reasoning_tokens ?? 0,
        };
    }

    const payload = (await postJson(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey())}`,
        {},
        {
            systemInstruction: { parts: [{ text: request.system }] },
            contents: [{ role: "user", parts: [{ text: request.user }] }],
            generationConfig: {
                maxOutputTokens: maxTokens,
                ...(request.json ? { responseMimeType: "application/json" } : {}),
            },
        },
    )) as {
        candidates?: {
            content?: { parts?: { text?: string }[] };
            finishReason?: string;
        }[];
        usageMetadata?: { thoughtsTokenCount?: number };
    };

    const text = (payload.candidates?.[0]?.content?.parts ?? [])
        .map((part) => part.text ?? "")
        .join("");
    return {
        text,
        model,
        finishReason: normalizeFinishReason(payload.candidates?.[0]?.finishReason),
        reasoningTokens: payload.usageMetadata?.thoughtsTokenCount ?? 0,
    };
}

/**
 * Models wrap JSON in prose or fences often enough that it is worth extracting
 * the outermost braces rather than trusting the response wholesale.
 */
function extractJsonObject(text: string): string | null {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start === -1 || end <= start) return null;
    return text.slice(start, end + 1);
}

/** What went wrong, in terms a run log can be read back from. */
function describeUnusableReply(result: AiResult, budget: number): string {
    const spent = result.reasoningTokens
        ? `, ${result.reasoningTokens} of them on reasoning`
        : "";

    if (!result.text.trim()) {
        if (result.finishReason === "length") {
            return `Model returned no text before exhausting its ${budget}-token budget${spent}`;
        }
        if (result.finishReason === "filtered") {
            return "Model declined to answer and returned no text";
        }
        return `Model returned an empty response (finish reason: ${result.finishReason})`;
    }

    if (result.finishReason === "length") {
        return `Model reply was cut off at its ${budget}-token budget${spent}: ${result.text.slice(0, 300)}`;
    }
    return `Model response contained no JSON object: ${result.text.slice(0, 300)}`;
}

/**
 * Generate and parse a JSON object.
 *
 * A reply that ran out of budget is retried once with a larger one. This is
 * worth the second call because the failure is silent: a reasoning model that
 * spends its whole allowance thinking returns HTTP 200 with empty content, so
 * without the retry an unremarkable document fails for no visible reason and
 * stays failed on every subsequent run.
 */
export async function generateJson<T>(request: AiRequest): Promise<{
    value: T;
    model: string;
}> {
    // Callers size maxTokens for the answer they expect. JSON has a floor
    // regardless, because the reasoning that precedes it is not theirs to size.
    let budget = Math.max(request.maxTokens ?? DEFAULT_MAX_TOKENS, MIN_JSON_TOKENS);
    let failure = "";

    for (;;) {
        const result = await generateText({ ...request, json: true, maxTokens: budget });
        const candidate = extractJsonObject(result.text);

        if (candidate) {
            try {
                return { value: JSON.parse(candidate) as T, model: result.model };
            } catch (cause) {
                // Truncation mid-object leaves a closing brace from a nested
                // value behind, so this reads as unparseable rather than absent.
                failure =
                    result.finishReason === "length"
                        ? `Model reply was cut off at its ${budget}-token budget`
                        : `Model returned malformed JSON: ${
                            cause instanceof Error ? cause.message : String(cause)
                        }`;
            }
        } else {
            failure = describeUnusableReply(result, budget);
        }

        if (result.finishReason !== "length" || budget >= MAX_RETRY_TOKENS) {
            throw new Error(failure);
        }

        budget = Math.min(budget * 4, MAX_RETRY_TOKENS);
    }
}

export function activeModelDescription(): string {
    const activeProvider = provider();
    return `${activeProvider}/${modelName(activeProvider)}`;
}
