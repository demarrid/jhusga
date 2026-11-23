# Drive revision attribution

The archive's DOCX export contains document text, not Google Docs revision authors.
OAuth revision metadata supplies last-editor names separately; retained revision
exports supply text for comparison. An API key cannot read that history.

## Connect or renew in one command

Run `npm run drive:connect` from the repository root, open the sign-in link it
prints, and approve Google Drive read-only access. The command receives the
callback locally, verifies the new refresh token, and saves it in `.env`.
It never prints tokens. Use the Google account with **editor or owner access**
to the minutes; public viewer access does not grant revision-history access.

To check credentials without changing them: `npm run drive:connect -- --check`.
Use `--help` for the short setup reminder. The command works with Node directly
on Windows or in WSL (the browser must be able to reach WSL's localhost).
It times out after ten minutes; Ctrl+C cancels it without replacing credentials.

### One-time setup

1. Enable the Google Drive API in your Google Cloud project.
2. In **Google Auth Platform → Clients**, select your **Web application** client.
   Add this exact **Authorized redirect URI**:
   `http://127.0.0.1:53682/google/callback`. Keep any existing redirect URIs.
3. Set `GOOGLE_OAUTH_CLIENT_ID` and `GOOGLE_OAUTH_CLIENT_SECRET` in `.env`.
   Existing OAuth Playground credentials can be reused; no new client is needed.
4. Run `npm run drive:connect` and follow the link. If Google reports
   `redirect_uri_mismatch`, check step 2, including the port and path.

### Stop the seven-day expiry

An **External** app with publishing status **Testing** issues refresh tokens
that expire after seven days for Drive scopes. Refreshing access tokens does
not extend that deadline. In the same project's **Google Auth Platform →
Audience**, use **Publish app** to move to **In production**, then run
`npm run drive:connect` again. This removes the Testing-specific deadline;
revocation, account policies, and other Google token limits can still require
reconnection. Google may require verification depending on the app's use and
requested scopes. Publishing the OAuth app does not make your Drive files public.

This is the likely explanation for weekly expiry, not a setting the renewal
command can inspect or change. See Google's [token lifetime rules](https://developers.google.com/identity/protocols/oauth2)
and [Audience settings](https://support.google.com/cloud/answer/15549945?hl=en).

### Apply the renewed credential to the live site

The command updates **local `.env` only**. In Vercel's project settings, replace
`GOOGLE_OAUTH_REFRESH_TOKEN` for **Production** with the value saved in `.env`,
and redeploy. The deployed client ID and secret must match the local client.
Restart an already-running local server too. Never put these credentials in
`NEXT_PUBLIC_*` variables or paste them into chat.

### Retry revision imports

Run `npm run revisions -- DRIVE_FILE_ID` for one published minutes document,
or `npm run revisions` for all published native Google Docs minutes. Sync
refreshes revision history for new or changed published minutes after meeting
classification, skipping unchanged text, agendas, and held edits. Credentials
must be configured in the environment running the sync. Failed imports retain
stored history and are reported in the sync result and logs.

For a new installation, apply migrations with `npx prisma migrate deploy` and
generate the client with `npx prisma generate` before importing revisions.

## Credit policy and limits

Meeting cards list qualifying contributors in descending order of newly written
or replaced words. A qualifying revision adds at least **30 words**, and a person
must account for at least **5%** of all observed additions. These constants live
in `lib/editors.ts`. Case, punctuation, formatting, and word/paragraph moves earn
zero. Deletions alone earn zero; word-frequency comparison deliberately undercounts
rewrites using the same vocabulary. Tiny edits are not accumulated into credit.

The first available snapshot is a baseline and earns no credit: its last editor
cannot be assumed to have written everything in it. Missing exports break the
comparison chain. Unnamed edits earn no credit and do not affect the named-writing denominator;
their text remains the baseline so it is not attributed to the next named editor.
When retained history supplies no qualifying resolved writer, meeting cards fall
back to the resolved Drive owner name, including when history has not been imported.
If the owner cannot be resolved either, the card says writing credit is unverified.
Resolved names are deduplicated while preserving rank.

Google may omit revisions, merge edits, or omit signed-out editor identities.
The API reports only the **last modifying user** of a retained revision. Credits
are therefore estimates of observed writing, not a complete authorship record.
OAuth can recover retained history, not deleted history or every coeditor within
a merged revision. Revision imports never replace published content or review state.
Successful snapshots are retained across imports; a failed file import leaves its
prior stored history intact, and the command exits unsuccessfully if any file fails.

Sources: [revision history limitations](https://developers.google.com/workspace/drive/api/guides/manage-revisions),
[revision metadata](https://developers.google.com/workspace/drive/api/reference/rest/v3/revisions),
[offline OAuth](https://developers.google.com/identity/protocols/oauth2/web-server),
[token lifetime](https://developers.google.com/identity/protocols/oauth2).

Revision requests are spaced at least 1.5 seconds apart. HTTP 429 and server
errors receive up to five retries, with exponential waits starting at five
seconds, jitter, and any longer Retry-After delay supplied by Google.

## Request scope

Revision authorship imports and permission checks run only for published minutes.
Bill and resolution credits come from named introducers, authors, sponsors, or
collective signatures in archived text, without revision-history calls or AI
generation. Bill Voting Records is read as archived spreadsheet text for passage
checks; its revision history is never used for authorship.
