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
};

export type AiResult = {
    text: string;
    model: string;
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

export async function generateText(request: AiRequest): Promise<AiResult> {
    const activeProvider = provider();
    const model = modelName(activeProvider);
    const maxTokens = request.maxTokens ?? 4096;

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
        )) as { content?: { type: string; text?: string }[] };

        const text = (payload.content ?? [])
            .filter((block) => block.type === "text")
            .map((block) => block.text ?? "")
            .join("");
        return { text, model };
    }

    if (activeProvider === "openai") {
        const payload = (await postJson(
            "https://api.openai.com/v1/chat/completions",
            { authorization: `Bearer ${apiKey()}` },
            {
                model,
                max_completion_tokens: maxTokens,
                messages: [
                    { role: "system", content: request.system },
                    { role: "user", content: request.user },
                ],
            },
        )) as { choices?: { message?: { content?: string } }[] };

        return { text: payload.choices?.[0]?.message?.content ?? "", model };
    }

    const payload = (await postJson(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey())}`,
        {},
        {
            systemInstruction: { parts: [{ text: request.system }] },
            contents: [{ role: "user", parts: [{ text: request.user }] }],
            generationConfig: { maxOutputTokens: maxTokens },
        },
    )) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };

    const text = (payload.candidates?.[0]?.content?.parts ?? [])
        .map((part) => part.text ?? "")
        .join("");
    return { text, model };
}

/**
 * Generate and parse a JSON object.
 *
 * Models wrap JSON in prose or fences often enough that it is worth extracting
 * the outermost braces rather than trusting the response wholesale.
 */
export async function generateJson<T>(request: AiRequest): Promise<{
    value: T;
    model: string;
}> {
    const { text, model } = await generateText(request);

    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start === -1 || end <= start) {
        throw new Error(`Model response contained no JSON object: ${text.slice(0, 300)}`);
    }

    return { value: JSON.parse(text.slice(start, end + 1)) as T, model };
}

export function activeModelDescription(): string {
    const activeProvider = provider();
    return `${activeProvider}/${modelName(activeProvider)}`;
}
