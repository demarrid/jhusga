# Operating history timelines

The site only reads stored events. `npm run history` performs extraction and
merging offline using the configured AI provider and database in `.env`.
Run one history generator at a time; concurrent publication is not coordinated.

## First deployment and review

1. Deploy the migration through `vercel-build` (`prisma migrate deploy`).
   The history tables must exist before generation or production page reads.
   Do not run `prisma migrate dev` against the hosted production database.
2. Inspect candidates without model calls or database writes:
   `npm run history -- sexual-violence --dry-run`.
   Excerpt character counts are an estimate of input volume, not a price quote.
3. Generate the agreed sample:
   `npm run history -- sexual-violence --limit 25`.
   This extracts at most 25 pending documents, then merges current findings.
   The limit applies to extraction, not merge calls or total token usage.
   On an empty topic, the sample is published with a stale status while
   documents remain pending. It is visible on the site immediately.
4. Review `/history/sexual-violence`: check dates against source text, follow
   citations, check grouping, and ensure no survivors, complainants, or accused
   people are identified in titles, prose, or quoted evidence. Prompts request
   this privacy protection; code does not independently detect identities.
   Verify passage against Bill Voting Records, with Senate minutes as fallback.
   Conflicting results must remain inconclusive. Committee votes are not adoption.
   A file listed in `CONFIRMED_HISTORY_PASSAGE` is passed; that review overrides
   a conflicting later row in the register.
5. After review, run `npm run history -- sexual-violence` and review again.
   Successful extraction caches from the sample are reused.

Use `JHUSGA_DATA_MODE=demo npm run dev` for a local synthetic timeline without
applying the migration or running the model. Demo data is not archive evidence.

## Timeline flags and short labels

The interactive timeline draws each event as a flag (title and the first
paragraph of its prose) on a pole down to its date. Where flags would collide it
falls back, stretch by stretch, to one box listing nearby events' titles, then
their short labels, then a count to zoom into (`app/history/[slug]/flags.ts`).

Short labels (at most four words, e.g. "New SBP") are written by the merge pass
into `HistoryEvent.label`. Events merged before that column existed have an
empty label, and the page shortens their title instead. Merge caches are keyed
on `merge-v2` in `batchHash`, not on the prompt text, so existing batches keep
their empty labels until they re-merge. Changing that key to `merge-v3` re-merges
every batch on the next run (merge calls only; extraction caches are reused).

## Refreshes and recovery

Rerun manually after an archive sync changes relevant documents, dates, kinds,
or titles, after voting register corrections, or after editing the topic registry.
There is deliberately no cron or sync-triggered paid generation. Check the dry
run first when the scope or candidate count changes materially.

Extraction caches include prompt version, topic configuration, document content,
and metadata. A topic's `mergeRules` are left out of the extraction cache, so
editing only those re-merges without re-extracting. Merge caches also include all findings and parsed voting records.
A voting record change currently re-merges affected cached batches broadly;
it can require model calls even when no document needs extraction.
Changing `AI_MODEL` alone does not invalidate caches; use `--force` for that.

- `--extract-only` fills extraction caches without publishing events. An existing
  timeline is marked stale until a publishing run completes.
- `--limit N` caps pending extraction (or forced extraction with `--force`).
  If the topic already has events, an incomplete extraction run preserves them
  all and marks the topic stale. Rerun without the limit to publish the refresh.
- `--force` re-extracts and re-merges, including successful caches, and incurs
  model usage. It is not normally needed for archive or topic changes.
- Failed or malformed extraction results are retryable and do not publish.
  A response with invalid or unanchored quotes gets one correction attempt
  listing each rejected quote; a quote that appears more than once must be
  lengthened until it is unique. A document that still fails blocks publication.
- To withdraw a finding that fails privacy review, remove it from that
  document's `HistoryFinding.findings` and rerun; only affected batches
  re-merge. A changed document or `--force` re-extracts it, so review again.
  Unknown or repeated merge member IDs fail the merge instead of silently
  shifting citations onto different evidence. A citation marker past an
  event's findings list is dropped when the event keeps at least one valid
  marker (it attributes nothing wrongly); an event with none fails the merge.
  Merge calls use short batch-local source IDs. Invalid responses receive
  validation feedback and up to two correction attempts before the run fails;
  these attempts incur additional model usage without re-extracting documents.
- All merges finish before a transaction replaces events, writes annotations
  and citations, removes obsolete batches, and updates the generation timestamp.
  Any merge failure leaves the published events intact. A database write failure
  rolls the publication transaction back. Rerun to retry; prepared merge results
  are held in memory and may need to be generated again after failure.
- Quota exhaustion stops subsequent merge calls. Up to six extraction requests
  may already be in flight. Extraction and merge failures produce a nonzero CLI
  exit status; intentionally limited successful samples do not.

Publication is atomic, but there is no editorial staging area or concurrency
lock. A run reads an archive snapshot into memory: avoid running alongside an
archive sync, and rerun after any concurrent source changes. A successful refresh
can replace event IDs, so previously copied `?event=` links may no longer select
an event. Zero-event batches are not persisted as cache entries and can re-merge.

## Checks and remaining verification

`npm run check -- history history-generation cite bill-votes` runs fixture-only
checks without a database or paid calls. The generation suite exercises cache
reuse and invalidation, partial refresh preservation, malformed responses,
quota exhaustion, citation ordinals, and publication rollback with a database
substitute. It does not verify real Prisma transaction behavior or model quality.

The first real sample and its citation writes still require verification after
deployment. Device testing of trackpad zoom and two-finger pinch, camera/layout
unit tests, duplicate page prose, narrow-screen hydration layout, and graceful
handling before the migration remain separate follow-up work.
