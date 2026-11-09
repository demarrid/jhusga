import assert from 'node:assert/strict';
import { signInEmail } from '../lib/sign-in-email';
import { sendMail } from '../lib/resend';

async function main() {
    const email = signInEmail('012345', 15);
    assert.match(email.html!, /for <a[^>]+>jhusga\.org<\/a>/);
    assert.match(email.html!, />012345<\/td>/);
    assert.match(email.text, /012345/);
    assert.match(email.html!, /expire in 15 minutes/);
    assert.match(email.text, /expire in 15 minutes/);
    assert.match(email.html!, /https:\/\/www\.jhusga\.org\/logo\.png/);
    assert.throws(() => signInEmail('<script>', 15));
    const originalFetch = globalThis.fetch;
    const originalKey = process.env.RESEND_API_KEY;
    const originalFrom = process.env.RESEND_FROM;
    const sent: Record<string, unknown>[] = [];
    try {
        process.env.RESEND_API_KEY = 'test-only';
        globalThis.fetch = async (_url, options) => {
            sent.push(JSON.parse(String(options?.body)));
            return new Response(JSON.stringify({ id: 'test-mail' }), { status: 200 });
        };
        for (const from of ['noreply@example.org', 'Old Name <noreply@example.org>']) {
            process.env.RESEND_FROM = from;
            await sendMail({ to: 'reader@example.org', ...email });
            assert.equal(sent.at(-1)?.from, 'SGA at JHU <noreply@example.org>');
            assert.equal(sent.at(-1)?.html, email.html);
            assert.equal(sent.at(-1)?.text, email.text);
        }
        process.env.RESEND_FROM = 'bad\r\nBcc: stranger@example.org';
        await assert.rejects(sendMail({ to: 'reader@example.org', ...email }));
        assert.equal(sent.length, 2);
    } finally {
        globalThis.fetch = originalFetch;
        if (originalKey === undefined) delete process.env.RESEND_API_KEY;
        else process.env.RESEND_API_KEY = originalKey;
        if (originalFrom === undefined) delete process.env.RESEND_FROM;
        else process.env.RESEND_FROM = originalFrom;
    }
    console.log('Sign-in email checks passed; all delivery requests were mocked.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
