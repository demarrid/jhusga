# Aggregate usage metrics

Set TELEMETRY_ENABLED=true in Vercel and redeploy. The existing vercel-build
command applies the new migration. No deployment or live migration is performed
by editing this repository. Local commands need the same flag to record their
work. DATABASE_URL must point to the intended database.

Run from your computer, using the existing .env credentials:

    npm run metrics
    npm run metrics -- 30
    npm run metrics -- 7 preview
    npm run metrics -- 7 local

The default report covers seven UTC dates including today (partial), production
only. Output is daily totals grouped by metric, source, route and request kind.
It reads the database directly, not Vercel logs. No public reporting endpoint.
scripts/telemetry-report.ts remains a legacy JSON log importer for old exports.

## What the metrics mean

- request: arrivals by broad site section; separates prefetch and RSC from other
  requests. Excludes static assets and auth. These are not page views.
- database: ORM operation counts, failures, summed milliseconds; separates
  application, sync and local work. Not provider-billed SQL counts. Writes and
  reads made by the metrics system itself are excluded, but still cost database
  resources. Concurrent query durations do not equal wall-clock duration.
- daily-browser: an approximate daily count of browser profiles with JavaScript
  and local storage. The browser stores only the last UTC date counted, no
  random ID. The date is never transmitted; the endpoint receives an empty POST.
  Web Locks prevent same-profile tab races when supported. One browser can be
  used by several people; one person can use several browsers. Clearing storage,
  races on browsers without locks, or automated JS clients can overcount;
  blocked JS/storage, privacy signals and network failures can undercount.
  NOT unique people; do not sum into monthly unique visitors.

Bot labels are self-declared and spoofable. Unknown is not a human classification.
Daily-browser is a reach proxy, not verified human traffic. The public endpoint
can be inflated deliberately and is not used for billing or access control.
No cookies, IDs, IPs, accounts, raw user agents, URLs, document IDs, search terms,
referrers, query contents or browsing histories are stored. No fingerprinting.
DNT and GPC suppress audience counters (server headers and browser signals).
Database health counters remain on without any per-request/visitor identifiers.

## Storage, batching, reliability

TelemetryHour holds only hourly aggregate rows with bounded categories.
TelemetryBatch holds random server batch IDs solely for idempotent retries;
they do not identify clients. One parameterized SQL statement atomically records
a batch receipt and increments all its counters. Duplicate batch retries do not
increment again. Parallel instances add atomically rather than overwriting.

Each instance accumulates counters, flushing after a response, at 100 operations,
every 60 seconds in active processes, and on clean local exit. Serverless
instances cannot reliably sleep until a future flush: low-traffic invocations
may each need one write. This is not one write per database query. Proxy and
application runtimes may flush separately.

Pending failures are retained for up to 10 minutes while the process survives.
Buffers are capped at 500 aggregate keys plus one in-flight batch. Crashes,
timeouts and long outages may lose counts; this is not a billing ledger.
Local applications that force process.exit must explicitly await flushMetrics.
The daily-browser endpoint acknowledges the database write; no identifiers or
client event log are retained.

Existing sync work prunes aggregates older than 90 days and batch receipts older
than 2 days, at most once daily per process. If sync stops, cleanup is delayed.
Keep the sync cron running. Reports are restricted to the last 90 dates.
Database backups and provider/security logs have separate retention controls.
These metrics are for capacity planning and coarse reach, never advertising,
personalization, user scoring, identity reconstruction, or access restrictions.
