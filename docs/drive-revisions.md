# Drive revision attribution

The archive's DOCX export contains document text, not Google Docs revision authors.
OAuth revision metadata supplies last-editor names separately; retained revision
exports supply text for comparison. An API key cannot read that history.

## Personal OAuth setup

1. Enable Google Drive API in your Google Cloud project. Configure the OAuth
   consent screen and add your personal Google account as a test user if needed.
2. Create a **Web application** OAuth client. Add
   `https://developers.google.com/oauthplayground` as an authorized redirect URI.
3. Open [OAuth Playground](https://developers.google.com/oauthplayground).
   In its settings select **Use your own OAuth credentials** and enter your
   client ID and secret. Use offline access and force the consent prompt.
4. Authorize `https://www.googleapis.com/auth/drive.readonly` using the account
   that has **writer/editor or owner access** to the minutes; public viewer
   access is insufficient for revision history. Exchange the code
   for tokens. Copy the refresh token into your server environment, along with
   `GOOGLE_OAUTH_CLIENT_ID` and `GOOGLE_OAUTH_CLIENT_SECRET`.
5. Apply migrations with `npx prisma migrate deploy`, then generate the client
   with `npx prisma generate`. Run `npm run revisions` for all published native
   Google Docs minutes, or `npm run revisions -- DRIVE_FILE_ID` for one file.
   Re-run after syncs to capture newly retained history. This command is separate
   from the five-minute sync cron because historical exports can be expensive.

Keep credentials in `.env` locally and deployment secrets on the server. They
must never use a NEXT_PUBLIC prefix. No account credentials are needed in chat.
An external OAuth app in Testing normally has a seven-day refresh-token lifetime
for Drive scopes. For unattended use, configure the appropriate production
consent status; token revocation and account access changes can still stop imports.

## Credit policy and limits

Meeting cards list qualifying contributors in descending order of newly written
or replaced words. A qualifying revision adds at least **30 words**, and a person
must account for at least **5%** of all observed additions. These constants live
in `lib/editors.ts`. Case, punctuation, formatting, and word/paragraph moves earn
zero. Deletions alone earn zero; word-frequency comparison deliberately undercounts
rewrites using the same vocabulary. Tiny edits are not accumulated into credit.

The first available snapshot is a baseline and earns no credit: its last editor
cannot be assumed to have written everything in it. Missing exports break the
comparison chain. Unknown editors still affect the denominator. An unavailable
history leaves author labels blank; neither ownership nor the current last editor
is a fallback. Resolved names are deduplicated while preserving rank.

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
