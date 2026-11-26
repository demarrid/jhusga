# Archive document categories

Audit date: November 14, 2026. Source: all 3,252 documents in the connected archive database, with the 114th session reviewed first, followed by historical and undated records.

The database contained 1,596 uncategorized documents (49.08%). Of those, 33 were in the current session (15% of its 220 documents). The reviewed classifier assigns 1,575 of these documents to supported categories. The remaining 21 represent 0.65% overall: one current-session document (0.45%) and 20 historical or undated records (0.66% of 3,032). These are audit projections until the backfill is applied; they do not describe a completed production deployment.

The current-session remainder is an empty `Background.pdf`. Other remaining records include empty exports and previously reviewed exceptions. They are not assigned generic labels solely to satisfy the threshold.

## Added categories

- Reports; plans and proposals; working documents.
- Meeting notes; class council minutes; other meeting minutes. Agenda filters remain separate, using the archived meeting role even where no paired meeting key exists.
- Correspondence; public statements; petitions; election materials.
- Schedules; surveys and feedback; applications and evaluations; resumes/CVs.
- Financial records; reference materials; transition guides; event materials.
- Photos and graphics; archive collections; Senate authorization orders.

Formal bill captions identify legislation even when filenames only name an event. Financial records, instructions, training exercises, personal rewrites, and discussions are not promoted to legislation or governing text just because they mention funding or bylaws. Classification does not assert passage or adoption.

Ambiguous titles have reviewed Drive-identity overrides in `config/archive-reviewed-categories.json`, with an evidence explanation. They survive subsequent syncs and renames. Existing reviewed exceptions remain in force unless a new reviewed category is recorded.

## Executive Meeting #10

Document `236a176e-6846-4c49-a24c-5980a6f8600f` has the filename `Executive #10`, a standardized title identifying Executive Board Meeting #10 minutes, and `meetingRole=minutes`. Its stored kind was `unknown`. The old metadata-only classifier did not recognize the short filename; the content/title-aware pass did. Metadata refreshes wrote that weaker classification back into the database. They now preserve established classifications, while published exports and the category pass classify from the text.

## Rollout and verification

Deploy the application changes before applying new category strings: older application versions do not recognize them. Then run `npx tsx scripts/classify-archive.ts` to audit and `npx tsx scripts/classify-archive.ts --apply` to apply the backfill. The script only changes unknown records, saves before/after metadata in an ignored `.archive-local/category-backfill-*.json` manifest, guards against concurrent source changes, and reports current and historical coverage. No Drive revisions, AI generation, passage statuses, or credit labels are changed.

The CLI cannot invalidate the deployed Next.js cache; archive filter counts refresh on their existing one-hour fallback. The document rows themselves are updated directly.

Regression checks: `npm run check -- document-categories identity meetings sync-batching sync-run document-media-sync archive-quality amendment-passage` and `npx tsc --noEmit`.

Verification outcome: the eight targeted suites, TypeScript, and lint passed. The full run passed 50 of 51 suites; the existing `archive-cache` check fails because a cold document includes `agendaOutline: undefined` while its JSON-cached version omits that property. The category changes do not touch that document-detail serialization path.
