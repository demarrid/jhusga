import assert from 'node:assert/strict';
import { test } from 'node:test';
import { once } from 'node:events';
import { authorizationUrl, callbackServer, redirectUri, updatedEnv } from './drive-connect.mjs';

test('offline consent uses state, PKCE, read-only Drive and the registered callback', () => {
    const url = new URL(authorizationUrl('client', 'nonce', 'verifier'));
    assert.equal(url.origin, 'https://accounts.google.com');
    for (const [key, value] of Object.entries({ state: 'nonce', access_type: 'offline', prompt: 'consent',
        redirect_uri: redirectUri, scope: 'https://www.googleapis.com/auth/drive.readonly', code_challenge_method: 'S256' })) {
        assert.equal(url.searchParams.get(key), value);
    }
    assert.ok(url.searchParams.get('code_challenge'));
    assert.equal(url.searchParams.has('client_secret'), false);
});

test('only refresh-token assignments change, without dotenv injection', () => {
    const before = '# keep me\nOTHER="unchanged"\nGOOGLE_OAUTH_REFRESH_TOKEN="old"\nexport GOOGLE_OAUTH_REFRESH_TOKEN=duplicate\n';
    const after = updatedEnv(before, 'new/token-123');
    assert.equal(after, '# keep me\nOTHER="unchanged"\nGOOGLE_OAUTH_REFRESH_TOKEN="new/token-123"\nGOOGLE_OAUTH_REFRESH_TOKEN="new/token-123"\n');
    assert.equal(updatedEnv('OTHER=x', 'token'), 'OTHER=x\nGOOGLE_OAUTH_REFRESH_TOKEN="token"\n');
    assert.throws(() => updatedEnv(before, 'bad"\nINJECTED=yes'), /unexpected/);
});

async function fixture(t, overrides = {}) {
    const saved = [];
    const finished = [];
    let exchanges = 0;
    const server = callbackServer({ state: 'expected', exchange: async () => { exchanges++; return 'private-token'; },
        save: async token => saved.push(token), finish: error => finished.push(error), ...overrides });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    t.after(() => { server.closeAllConnections(); server.close(); });
    const base = `http://127.0.0.1:${server.address().port}/google/callback`;
    return { saved, finished, calls: () => exchanges, get: query => fetch(base + query) };
}

test('invalid state cannot exchange or save; valid callback is used once and never exposes tokens', async t => {
    const f = await fixture(t);
    assert.equal((await f.get('?state=wrong&code=abc')).status, 400);
    assert.equal(f.calls(), 0);
    const result = await f.get('?state=expected&code=abc');
    assert.equal(result.status, 200);
    assert.equal(result.headers.get('cache-control'), 'no-store');
    assert.ok(!(await result.text()).includes('private-token'));
    assert.deepEqual(f.saved, ['private-token']);
    assert.equal((await f.get('?state=expected&code=abc')).status, 409);
    assert.equal(f.calls(), 1);
});

test('cancelled consent and failed exchange leave existing credentials alone', async t => {
    const cancelled = await fixture(t);
    assert.equal((await cancelled.get('?state=expected&error=access_denied')).status, 400);
    assert.deepEqual(cancelled.saved, []);
    assert.equal(cancelled.calls(), 0);
    assert.ok(cancelled.finished[0] instanceof Error);
    const failed = await fixture(t, { exchange: async () => { throw new Error('token request failed'); } });
    assert.equal((await failed.get('?state=expected&code=abc')).status, 500);
    assert.deepEqual(failed.saved, []);
    assert.ok(failed.finished[0] instanceof Error);
});
