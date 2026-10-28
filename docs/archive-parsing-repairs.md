# Archive parsing repairs

The fixes apply shared evidence rules; no document IDs or person-name exceptions were added.

- Minutes show direct document links at their authored section offsets. Agenda-only links require a validated passage match in the minutes.
- Explicit full-name introductions in a document take precedence over archive-wide shorthand. Inferred single-name matches are no longer saved or merged globally. Loose attendance tokens require corroboration.
- Elections committee roles inherit the complete roster ancestry rather than falling through to Justice.
- Word imports retain paragraphs, emphasis, headings, numbered/bulleted lists, links, and tables.
- A copied weekly date is reconciled only when an independent record of the earlier meeting exists in the same session/body and was created around that date, and the newer file was created within one day of a later weekly occurrence (up to six weeks). Original source text is preserved. Passage dates earlier than the legislation's own stated date are withheld.
- The separately scheduled summary worker runs daily at 08:15 UTC, with at most 25 documents and a 260-second deadline. It uses the existing cron authorization and citation verification.

## Existing data

Deploy the application changes, then run against the intended archive database:

1. `npm exec tsx scripts/refresh-docx.ts` — preview formatting repairs for published Drive Word imports.
2. `npm exec tsx scripts/refresh-docx.ts -- --apply` — apply eligible repairs. Changed source text and citation conflicts are skipped for review. Both text versions are retained; citations and search passages are re-anchored.
3. `npm run reprocess` — rebuild derived contributors, directory memberships, dates, titles, and references.
4. `npm run summarize -- --session 114 --limit 25` — backfill a bounded batch immediately; the daily worker continues the queue.

The reprocess command retains its existing model-assisted nickname resolution behavior. No bill/resolution credit generation or revision-history requests were introduced. CLI repairs are picked up by the existing cache expiry, or immediately by the normal sync cache invalidation.

## Verification

Sixteen targeted suites passed, including new regression cases for explicit local names versus old aliases, prose in attendance rolls, nested elections roles, link offsets, weekly date collisions, and contradictory passage chronology. TypeScript, lint on changed code, and a production Next.js build also passed.

The database available in this workspace predates four of the reported live documents. Published pages and current source exports were inspected separately. Production data was not changed by these checks.
