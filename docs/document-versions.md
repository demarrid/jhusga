# Document versions

The reader has an inline version selector below the masthead. The URL stores the selected occurrence (`?version=<id>`); `?version=latest` always requests the latest published text. The newest option is labelled “latest”.

Undated documents default to the latest published occurrence. Dated documents (including minutes) default to the last available occurrence at or before the end of their stated day in America/New_York. If none exists, the earliest available version is shown with a history-gap note. Source modification timestamps date versions when available; otherwise the selector explicitly says “first saved” and uses the observation timestamp. A capture cannot reconstruct edits between syncs.

`DocumentRevision` continues to store complete, deduplicated snapshots. `DocumentVersion` records separate source occurrences and their publication status, so A → B → A retains three entries. Sync writes the document, snapshot and occurrence together. Review approval/rejection changes the occurrence status in the same transaction. Held, rejected and unknown legacy versions are never public, including through the revision comparison page.

The migration conservatively backfills only current published text and explicitly reviewed historical snapshots as public. Older snapshots without proof of publication remain stored with `unknown` status; missing history is never invented. Previously lost reversion timestamps cannot be recovered.

Historical text is parsed afresh, including its outline and links. Current summary/citation offsets and people extraction are not attached to different text. The summary pane points to the latest version instead. Existing generated citation links explicitly request `version=latest`. The external source link is labeled as the latest source, because it cannot serve archived versions.

Apply the additive migration with `npx prisma migrate deploy` and regenerate the Prisma client before running the updated application or sync workers. No remote Drive revision requests or AI generation are needed. Run `npm run check -- document-versions archive archive-cache governing-review sync-batching render outline` to check the affected paths.
