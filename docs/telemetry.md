# Minimal first-party telemetry

Enable with TELEMETRY_ENABLED=true in the deployment environment and redeploy.
Use the same variable for local maintenance commands to account for their database
work. Setting it to false (or leaving it unset) disables all added logging.
No database migration, tracking cookie, analytics service, or network exporter.

## Collected data

- sga.request.v1: broad route group, request/prefetch/RSC classification,
  unknown or self-declared-automation category, count. Proxy counts arrivals,
  not completed responses or page views. Static assets and auth are excluded.
- sga.database.v1: ORM operation count, failed operations, summed elapsed
  milliseconds, deployment environment, application/sync/local category.
  Includes raw Prisma operations; nested SQL and transaction overhead are not
  separate operations. These are NOT exact provider billing units.
- Sync slices (including summary recovery) and newsletter cron work get the sync
  category. Other operations run by CLI scripts are local; other server work is
  application. These categories describe execution, not the initiating person.

No IPs, IDs, raw URLs, query strings, SQL, query arguments, error messages,
referrers, accounts, cookies, raw user agents, session tracking, or fingerprinting.
User-agent classification is heuristic and spoofable, never called verified.
Browser DNT: 1 and Sec-GPC: 1 suppress request metrics. Operational database
totals remain; they have no per-request identifiers. Production owner browsing
cannot be distinguished from other unknown requests. That is deliberate.

## Reading the counters

Filter hosting runtime logs for sga.request.v1 and sga.database.v1.
Export the message field as newline-delimited JSON, using the same time window
and environment. Then run:

    npx tsx scripts/telemetry-report.ts < metrics.jsonl

The report groups request counts and database work separately. Do not multiply
request bot share by database operations: these metrics cannot establish that
attribution. There are no unique visitor estimates or human conversion funnels.
Request logs are one compact row per eligible request. Database rows flush at
100 operations, after responses, every 60 seconds, or clean CLI exit. Process
termination can lose pending counters; dropped/truncated/duplicated provider logs
also affect totals. Totals are observed work, not an accounting ledger.
Summed operation time is not wall-clock time when operations overlap.
The request counter does not report downstream HTTP status or response latency.

## Retention and use

Use private operator logs only. Configure the hosting provider or log drain to
expire raw metric messages within 7 days; this repository cannot enforce external
log retention. Do not enable long-lived exports by default. Delete temporary
exports after investigation; retain only coarse daily totals when necessary.
The hosting platform may independently attach request metadata or retain security
logs. These are outside this telemetry's payload and opt-out controls; review the
provider configuration before enabling collection.

Do not use these counters for advertising, user scoring, identifying anonymous
participants, personalization, or access restrictions. No public analytics endpoint
is added. Existing authentication and abuse prevention are unchanged.
