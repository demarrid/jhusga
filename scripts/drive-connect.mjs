import { createServer } from 'node:http';
import { randomBytes, createHash } from 'node:crypto';
import { readFile, writeFile, rename, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const redirectUri = 'http://127.0.0.1:53682/google/callback';
const scope = 'https://www.googleapis.com/auth/drive.readonly';

export function authorizationUrl(clientId, state, verifier) {
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    url.search = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri,
        response_type: 'code', scope, access_type: 'offline', prompt: 'consent', state,
        code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256' }).toString();
    return url.toString();
}

export function updatedEnv(source, token) {
    // Tokens are opaque; refuse characters that could change dotenv syntax.
    if (typeof token !== 'string' || !/^[A-Za-z0-9._~+\/-]+$/.test(token)) throw new Error('Google returned an unexpected refresh-token format. Nothing was saved.');
    const line = `GOOGLE_OAUTH_REFRESH_TOKEN="${token}"`;
    const pattern = /^[\t ]*(?:export[\t ]+)?GOOGLE_OAUTH_REFRESH_TOKEN[\t ]*=.*$/gm;
    if (pattern.test(source)) return source.replace(pattern, line);
    return source + (source.endsWith('\n') ? '' : '\n') + line + '\n';
}

async function tokenRequest(parameters) {
    const response = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST', body: new URLSearchParams(parameters), signal: AbortSignal.timeout(30_000),
    });
    const data = await response.json();
    if (!response.ok) {
        const advice = data.error === 'invalid_grant' ? 'Consent expired or was revoked. Run npm run drive:connect; check whether Google Auth Platform is still in Testing.'
            : data.error === 'invalid_client' ? 'Check GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET in .env.'
            : 'Check the OAuth client and its authorized redirect URI in Google Cloud.';
        throw new Error(`Google OAuth failed (HTTP ${response.status}). ${advice}`);
    }
    if (!data.access_token) throw new Error('Google did not return an access token. Nothing was saved.');
    return data;
}

export function callbackServer({ state, exchange, save, finish }) {
    let used = false;
    return createServer(async (request, response) => {
        const reply = (status, message) => {
            response.writeHead(status, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store',
                'referrer-policy': 'no-referrer', 'x-content-type-options': 'nosniff' });
            response.end(message);
        };
        const url = new URL(request.url, redirectUri);
        if (request.method !== 'GET' || url.pathname !== '/google/callback') return reply(404, 'Not found');
        if (url.searchParams.get('state') !== state) return reply(400, 'Invalid sign-in state. Use the link printed by the command.');
        if (used) return reply(409, 'This sign-in has already been handled.');
        if (url.searchParams.has('error')) {
            used = true;
            reply(400, 'Google sign-in was cancelled or denied. Your existing credentials were not changed.');
            finish(new Error('Google sign-in was cancelled or denied. Run npm run drive:connect to try again.'));
            return;
        }
        const code = url.searchParams.get('code');
        if (!code) return reply(400, 'Missing authorization code.');
        used = true;
        try {
            const token = await exchange(code);
            await save(token);
            reply(200, 'Drive connected. Your refreshed credentials were saved to .env. You can close this tab. For the live site, update the deployment secret and redeploy; see the terminal.');
            finish();
        } catch (error) {
            reply(500, 'Could not finish connecting Drive. See the terminal for next steps.');
            finish(error);
        }
    });
}

async function main() {
    const args = process.argv.slice(2);
    if (args.includes('--help')) {
        console.log('npm run drive:connect          Sign in and save a new refresh token to .env\nnpm run drive:connect -- --check  Check the saved credentials without changing them\n\nOne-time setup: add this authorized redirect URI to your Google Web OAuth client:\n' + redirectUri + '\nSee docs/drive-revisions.md for setup and the seven-day Testing limit.');
        return;
    }
    if (args.some(arg => arg !== '--check')) throw new Error('Unknown option. Use --help.');
    const envPath = resolve('.env');
    process.loadEnvFile(envPath);
    const client_id = process.env.GOOGLE_OAUTH_CLIENT_ID;
    const client_secret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
    if (!client_id || !client_secret) throw new Error('Set GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET in .env first. See docs/drive-revisions.md.');
    const credentials = { client_id, client_secret };
    if (args.includes('--check')) {
        const refresh_token = process.env.GOOGLE_OAUTH_REFRESH_TOKEN;
        if (!refresh_token) throw new Error('No refresh token saved. Run npm run drive:connect.');
        await tokenRequest({ ...credentials, grant_type: 'refresh_token', refresh_token });
        console.log('Drive OAuth is working. No credentials were changed.');
        return;
    }
    const state = randomBytes(32).toString('base64url');
    const verifier = randomBytes(48).toString('base64url');
    await new Promise((resolveDone, reject) => {
        let timer;
        const finish = (error) => {
            clearTimeout(timer);
            server.close();
            if (error) reject(error); else resolveDone();
        };
        const server = callbackServer({ state, finish,
            exchange: async (code) => {
                const data = await tokenRequest({ ...credentials, code, code_verifier: verifier,
                    grant_type: 'authorization_code', redirect_uri: redirectUri });
                if (!data.refresh_token) throw new Error('Google did not return offline access. Nothing was saved; rerun and grant consent.');
                if (data.scope && !data.scope.split(' ').includes(scope)) throw new Error('Drive read-only permission was not granted. Nothing was saved.');
                await tokenRequest({ ...credentials, grant_type: 'refresh_token', refresh_token: data.refresh_token });
                return data.refresh_token;
            },
            save: async (token) => {
                const source = await readFile(envPath, 'utf8');
                const temp = `${envPath}.${randomBytes(8).toString('hex')}.tmp`;
                try {
                    await writeFile(temp, updatedEnv(source, token), { mode: 0o600, flag: 'wx' });
                    await rename(temp, envPath);
                } finally { await unlink(temp).catch(() => {}); }
            },
        });
        server.on('error', () => finish(new Error('Cannot listen on 127.0.0.1:53682. Close another drive:connect command and try again.')));
        server.listen(53682, '127.0.0.1', () => {
            console.log('Open this link and approve Drive read-only access with the account that can edit the minutes:\n\n' + authorizationUrl(client_id, state, verifier));
            console.log('\nIf Google reports redirect_uri_mismatch, add this URI to your OAuth client: ' + redirectUri);
            console.log('Waiting up to 10 minutes. No tokens will be printed.');
        });
        timer = setTimeout(() => finish(new Error('Sign-in timed out. Run npm run drive:connect to try again.')), 10 * 60_000);
    });
    console.log('Saved and verified the new refresh token in .env. Restart any local server.\nFor production: update GOOGLE_OAUTH_REFRESH_TOKEN in Vercel from .env and redeploy.\nTo avoid weekly renewal, change External / Testing to In production in Google Auth Platform > Audience, then reconnect.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
    main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
