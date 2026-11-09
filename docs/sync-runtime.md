# Sync runtime and summary failures

The manual sync includes News-Letter crawling. The scheduled Drive sync does not;
News-Letter has its own cron. All sync, newsletter, and summary API routes declare a 60-second maxDuration
to match the deployed Hobby plan limit. Newsletter and summary cron work budgets
are capped at 40 seconds; the CLI newsletter default remains four minutes.

## Runs are worked in slices

A full Drive pass takes two to three minutes, so no single 60-second invocation
can do it. `lib/sync-run.ts` stores a run as a sequence of steps on its SyncRun
row: the walk, ingesting changed files, following links, each whole-corpus
pass, the search index, then sections, summaries, and pruning. The walk's file
list, each step's cursor, and the running counts live on the row as well,
because the next slice is usually a different process.

Each invocation claims the run with a lease, starts new work for 40 seconds
(`SYNC_SLICE_BUDGET_MS`), checkpoints after every file or pass, and leaves the
rest of its limit for the unit already under way. If work remains it hands the
run on by POSTing to `/api/sync/continue` with `Authorization: Bearer
$CRON_SECRET`; that route answers at once and does its slice after responding.

- `/api/cron/sync` and the Request sync button start a run and return. The
  button then polls `GET /api/sync?run=<id>` for progress.
- A slice the platform kills loses only the unit it was on. Its lease expires
  after 75 seconds and the run resumes from the last checkpoint.
- A run with no live lease and no checkpoint for two minutes has lost its
  hand-off. The next button press or cron resumes it; the button nudges it once
  while polling. A run stalled for three hours is abandoned and a new one starts.
- A file that is started by three slices in a row without finishing is passed
  over so the rest can land; the run still succeeds and names it in `error`.
  Any other step that does the same fails the run.
- Without `CRON_SECRET` (local development) there is nothing to authenticate
  the hand-off with, and no time limit, so slices run back to back in-process.
- `npm run sync` works the same steps in one process with no budget.

Unchanged Drive files refresh metadata with six bounded workers. Changed content
and contributor identity resolution stay sequential. Linked Drive metadata reads
also use bounded workers; directory category, email, and seat lookups are loaded
once per session rather than once per person.

Sections and summaries run in their own slice, with the slice deadline as their
deadline. Each model request, including retries, is aborted at that deadline.
Pending items stay queued for the next run. The manual CLI keeps its existing
unbounded summary deadline.

An OpenAI 429 with insufficient_quota or credit_balance_exhausted is a billing
failure, not request throttling. Section and summary queues stop on that error,
and summary logs include the provider's reason. A failed refresh leaves a prior
nonempty summary stale and visible; documents without a summary remain failed.
Ordinary Drive throttling retains the Drive retry/backoff behavior.

A measured unchanged-source archive pass on October 14, 2026 took about 54 seconds:
ingest 5.1s, linked files 7.0s, directories 3.5s. The preceding user-provided run
had about 131s of archive work (160s including CLI-only work). On November 8 the
walk alone took about 9 seconds for 1,190 files from a local machine. Each slice
logs `sync phase <step>: <ms>`, and the run's `state.summary.timings` sums them.

Newsletter budgets are checked between articles; search requests, crawl delays,
retries, and in-flight work can still exceed the budget. Large ingestion and
backfill jobs should run through the CLI outside the serverless time limit.
