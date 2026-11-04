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

## Attendance and Drive-owner follow-up (2026-11-03)

- Attendance column headings now carry into table rows; nested Excused labels override Absent without splitting full names. Empty cells retain their column position.
- Numbered and paragraph-separated attendance rolls are read in minutes, stopping at the next section. Single names still require the existing identity resolver.
- Lead/Assist entries in initiative tables become known-person mentions.
- Confirmed opaque Drive handles are configured in `config/drive-accounts.ts`; account matching also accepts exact display names when no email is supplied.
- `npx tsx scripts/refresh-contributors.ts <document-id> ...` previews a scoped repair; add `--apply` to replace derived contributors and Drive links only for those documents. Existing manual contributor rows are preserved by the normal contributor writer. The command uses the configured database and existing name-resolution behavior; it does not retrieve Drive revisions.

Regression coverage includes the reported finance table, executive numbered roll, AA paragraph roll, initiative assignments, empty attendance cells, and confirmed/missing/ambiguous Drive accounts.

## Cross-branch speakers and informal attributions (2026-11-03)

- Short-name speaker matches may use officers from any SGA branch when the meeting has a dated or current-session context. Loose attendance tokens retain the meeting-body restriction, and undated historical minutes do not acquire current officers.
- Minutes accept a semicolon in place of a speaker-label colon and a `[video]` marker before the colon, including long recorded reports. These forms still require a known-person match and do not apply to bills.
- Regression checks cover executive and judicial speakers, Nora's nickname, attendance and historical safeguards, semicolon labels, and video reports.

The scoped contributor refresh was run against the configured database for document `58442442-9ef8-486e-897b-4d0ca731310a`. Source text was not changed. The user subsequently confirmed Alex Weiss, Rain (Hayden) Cheng, and Tekeya Peterson. `scripts/correct-november-speakers.ts --apply` records these as document-specific manual speaker links, preserved by subsequent syncs, without global shorthand aliases.
