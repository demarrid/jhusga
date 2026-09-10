/**
 * Sending mail, through Resend.
 *
 * Plain `fetch` against one documented endpoint rather than the SDK, for the
 * same reason lib/ai.ts does: the whole requirement is "post a short message
 * to one address", and that does not justify a dependency to keep in step with
 * the framework.
 *
 * The only mail this site sends is a sign-in code. That matters for what is
 * *not* here: no templates, no batching, no marketing list, and no record of
 * who was written to. See lib/login.ts -- the address is hashed before it
 * touches the database, and the plaintext exists only for the length of the
 * request that mails it.
 */

const ENDPOINT = "https://api.resend.com/emails";
const REQUEST_TIMEOUT_MS = 15_000;

export type Mail = {
    to: string;
    subject: string;
    text: string;
    /** Optional; the text part is always sent, so a client that refuses HTML still reads. */
    html?: string;
};

export function mailIsConfigured(): boolean {
    return Boolean(process.env.RESEND_API_KEY && process.env.RESEND_FROM);
}

function apiKey(): string {
    const key = process.env.RESEND_API_KEY;
    if (!key) throw new Error("RESEND_API_KEY is not set");
    return key;
}

function from(): string {
    const address = process.env.RESEND_FROM;
    if (!address) {
        throw new Error(
            'RESEND_FROM is not set; use a verified sender, e.g. "SGA <noreply@jhusga.org>"',
        );
    }
    return address;
}

/**
 * Send one message.
 *
 * Throws on failure rather than returning a flag, because every caller has to
 * tell the reader their code is not coming; silently swallowing this would
 * leave somebody staring at a form that says a code is on its way.
 */
export async function sendMail(mail: Mail): Promise<{ id: string }> {
    const response = await fetch(ENDPOINT, {
        method: "POST",
        headers: {
            authorization: `Bearer ${apiKey()}`,
            "content-type": "application/json",
        },
        body: JSON.stringify({
            from: from(),
            to: [mail.to],
            subject: mail.subject,
            text: mail.text,
            ...(mail.html ? { html: mail.html } : {}),
        }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        cache: "no-store",
    });

    if (!response.ok) {
        const detail = await response.text().catch(() => "");
        throw new Error(`Resend returned ${response.status}: ${detail.slice(0, 300)}`);
    }

    const payload = (await response.json().catch(() => ({}))) as { id?: string };
    return { id: payload.id ?? "" };
}
