# Sync runtime and summary failures

The manual sync includes News-Letter crawling. The scheduled Drive sync does not;
News-Letter has its own cron. Both scheduled routes currently declare a 300-second
maxDuration; the deployed Vercel plan and runtime determine the effective limit.

Unchanged Drive files refresh metadata with six bounded workers. Changed content
and contributor identity resolution stay sequential. Linked Drive metadata reads
also use bounded workers; directory category, email, and seat lookups are loaded
once per session rather than once per person. Dependent archive passes retain
their order.

Scheduled sections and summaries share an absolute deadline 105 seconds after
sync starts. Each model request, including retries, is aborted at that deadline.
Pending items stay queued for the next run. This leaves room for persistence and
cleanup within a two-minute target; it does not bound a large Drive ingestion,
network delay, or database outage. The manual CLI keeps its existing unbounded
summary deadline.

An OpenAI 429 with insufficient_quota or credit_balance_exhausted is a billing
failure, not request throttling. Section and summary queues stop on that error,
and summary logs include the provider's reason. A failed refresh leaves a prior
nonempty summary stale and visible; documents without a summary remain failed.
Ordinary Drive throttling retains the Drive retry/backoff behavior.

A measured unchanged-source archive pass on October 14, 2026 took about 54 seconds:
ingest 5.1s, linked files 7.0s, directories 3.5s. The preceding user-provided run
had about 131s of archive work (160s including CLI-only work). Different source
changes and database/network conditions make this a measurement, not a guarantee.
