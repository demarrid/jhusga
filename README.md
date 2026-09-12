# jhusga.org

This repository contains the code for the unofficial website of the Student Government Association at the Johns Hopkins University. The open-source nature of this project is a commitment to transparency regarding informational flow as well as security and privacy. 

The official website, hosted on CampusGroups, is available here: [https://jhu.campusgroups.com/sga](jhu.campusgroups.com/sga). While it (usually) serves the main necessary functions an SGA website should have, CampusGroups is less corrigible than something self-hosted; hence, this repository.

The content below, as well as the vast majority of this repository's backend, was generated using Opus 5.

## Architecture

SGA governing documents live in Google Docs, inside a master folder that changes
every year. Because legislation mutates by amendment, any claim this site makes
about how the SGA works has to be traceable to a specific passage of a specific
document, and has to stop being trusted the moment that passage changes.

The pipeline that enforces this runs once a day:

1. **Walk the Drive folder** (`lib/drive.ts`). Recurses the master folder and
   exports each Google Doc as markdown. Nested `Nth SGA Master Folder` folders
   are recognised as archives and tagged with their session number, including
   the ones filed as shortcuts rather than as folders -- the 112th holds the
   111th that way, and following shortcuts is the difference between having that
   session and not.
2. **Follow links** (`lib/sync.ts`, `lib/links.ts`). Agendas mostly list Drive
   and SharePoint URLs. Those targets are ingested if they can be read.
   A linked-in file is dated and placed by what it says about itself
   (`lib/identity.ts`): the caption first (`S.B.26-27`, `S-B.114.09.08.2026-1`),
   then the date it states. The folder of whichever agenda linked it is the last
   resort, so a report on the 2018/2019 referendum stays the 106th's work rather
   than becoming the 113th's for having been cited. SharePoint files need Graph
   credentials when the share is not public (see `.env.example`).
3. **Sync** (`lib/sync.ts`). Compares each export's hash against the stored
   copy. Unchanged documents are skipped; changed ones get a new
   `DocumentRevision` and their citations are re-anchored.
4. **Generate** (`lib/generate.ts`). Asks a model to answer a fixed question
   from the documents and to quote its evidence. Every quote is checked to
   appear verbatim in the source before the answer is stored; quotes that do not
   are discarded. Only current-session documents are eligible, so repealed
   language is never described as current law.
   The same step restates each document on its own (`lib/summarize.ts`) for the
   summary shown beside it, under the same verification and a per-run budget,
   so a new document is summarised by the run that ingests it rather than
   whenever somebody remembers to ask for one.
5. **Index** (`lib/passages.ts`, `lib/search.ts`). Splits each document at its
   own headings into passages and indexes them for full-text search, which is
   what lets a question find the clause that answers it rather than the file
   that mentions the word.
6. **Render**. Pages read cached sections and never call a model on request.
   The one exception is a question nobody has asked before; see below.

### Asking the archive a question

`/documents` takes a question in the reader's own words. Postgres full-text
search over passages picks the evidence, and a model is asked to answer from
that evidence alone. The answer goes through the same verification gate as
everything else: quotes that are not in the document are dropped, and an
answer with no surviving quotes is never shown.

The retrieval half is deterministic and costs nothing, so the documents that
matched are shown whether or not the model produced anything -- a deployment
with no `AI_API_KEY` still has a working search. Answers are cached against a
normalised question and the content hashes behind them, so the same question
is answered once, and an amendment expires it rather than leaving it wrong.

### Documents anyone can edit

Some files in the master folder are shared as "anyone with the link can edit".
That is usually an accident, and it means the text this site republishes can be
rewritten by a stranger. The sync asks Drive, unauthenticated, whether it could
edit each file, and stores the answer -- so the signal is what an anonymous
outsider can actually do, not what the SGA meant to allow. The answer is
rewritten on every run, including for files whose text has not changed:
tightening a share to suggestions-only does not touch the file's modifiedTime,
and the warning has to come down when the hole is closed or it stops meaning
anything.

Where a file is world-editable, `lib/integrity.ts` applies a much lower bar
before it will publish a change: a revision that deletes most of a document, or
leaves a fraction of it behind, is stored but **not** published. The site keeps
serving the text it last checked, the document page says a change is waiting,
and `npm run review` shows the diff to a person. Rejecting records the hash, so
the next sync recognises the same change rather than queueing it again.

The judgement being made is deliberately not "is this vandalism" -- nothing can
decide that from the text. It is "is this large enough that somebody should
look", which is answerable, and the thresholds in `config/integrity.ts` are set
per document kind: strictest for the constitution and the bylaws, strictest of
all for anything the world can edit.

### The forum, and what it does not keep

`/discussion` is anonymous, and anonymous against whoever holds the database
rather than merely against other readers. Posting needs a Hopkins address,
which is mailed a code through Resend, checked against an HMAC, and then gone:
what persists is a session row saying somebody at Hopkins signed in, with no
record of which address, and an anonymous post has no author column at all.
Officers are the exception, opt-in per post, because a senator posting as a
senator is on the record.

Rate limiting works without identity for the same reason. `lib/ratelimit.ts`
keys a counter on an HMAC of the action, the caller's network coarsened to a
/24, and the window, under a salt mixed with the UTC date. No address is
written down, the key stops being computable at midnight, and `RateBucket` has
no column pointing at a post -- so "which posts came from this address" is not
a query anyone can write. It is imprecise on purpose: it exists to stop
somebody posting every ten seconds, not to make evasion impossible.

Screening (`lib/moderate.ts`) holds a flagged submission back instead of
publishing it, and announces the hold in the same request: a row goes into
`ModerationAction` naming what was held and why. So the text waits and the fact
that it is waiting does not. `/discussion/moderation` carries both the held
queue -- readable, so the hold can be checked against what was written -- and
every decision since. A moderator ends a hold by publishing it or upholding it
under their own name; either way it leaves the queue and enters the log.

Two things withhold content and they are kept distinct by `hiddenBy`. A
screening hold is a model's guess nobody has checked, so it stays out of the
listing entirely. A moderator's decision has a person behind it, so it stays
listed and readable behind a click, where it can be argued with. Every failure
path in screening -- no key, model down, malformed reply -- posts unscreened,
because screening that breaks must not become screening that blocks everything.

There is no author-side delete, which is a rule and not a gap. Where nobody is
named, withdrawing your own words means being able to say something about
somebody, let it be read, and then remove every trace that it was said. Posts
come down only through a moderator, so every removal is one somebody signed
their name to.

### Why the citations survive amendments

A citation is a byte range into a document's stored text, not a copy of it. When
a document changes, `lib/anchor.ts` searches the new text for the quote and
moves the range. If the quote is gone -- the clause was amended away -- the
annotation is marked orphaned and every section citing it is marked `stale`, so
the site can say "this is being rechecked" instead of quietly asserting
something no longer true.

Normalisation lets a quote survive reformatting (whitespace, smart quotes,
markdown emphasis) while still refusing to guess: a short quote appearing more
than once anchors to nothing rather than to the wrong place.

The same constraint is why spreadsheets are turned into tables at render time
rather than at ingest. `lib/render.ts` parses the stored CSV into cells that
each remember the range of the original text they came from, so a roster reads
as a table while a citation still indexes into the export exactly as Drive
produced it. Rewriting the stored text into a markdown table would have been
easier and would have moved every offset in the document.

### How a document is dated

Drive's `createdTime` is the day somebody copied a template, so it is the answer
of last resort. `lib/identity.ts` reads the date the document states about
itself, in this order: the clause it was written to be quoted on ("presented for
first reading this 8th day of September in the year 2026", "enacted this 22nd
day of April"), the date in its own caption (`S-B.114.09.08.2026-1`), the date in
a meeting's filename, and finally the byline under its title. Where a bill
carries several clauses the furthest it got wins, so an enacted bill is filed
under the day it was enacted and a bill that only ever got introduced under the
day it was introduced.

That date is stored on the document (`datedAt`, written by `recordDates` in
`lib/sync.ts`) rather than worked out on read, because the listing and the
date-aware search order by it and neither can afford to load every document's
text to find out.

### The other source: what the newspaper wrote

Everything above is the SGA's own paperwork. It has a gap that no amount of
Drive-walking will close: the SGA keeps almost nothing before about 2019, and
what it kept says only what it decided, never how that landed. The Johns Hopkins
News-Letter has covered the same body since it was called Student Council, and
its online archive reaches back to 2001.

So `lib/newsletter.ts` reads it. Each of three phrases -- "sga", "student
government", "student council" -- is searched a calendar year at a time, and
`lib/coverage.ts` stores what comes back as a document of kind
`newsletter.article`, dated by the paper's own byline and filed to the session
that date falls in.

Two things about that search decide the shape of the code. It caps a query at
1000 hits and reports the cap as though it were a count, so a query spanning the
whole archive cannot be enumerated and every search is fenced to one year. And it
matches loose stemmed words across an entire page, including the navigation that
says "Student Government" on every article the paper has ever published -- so
what it offers is a candidate list and nothing more. Two thirds of what it offers
for one year turns out to use none of the three phrases. The archive re-checks
every article against its own fetched text, keeps only what passes, and writes
the phrases that passed to `matchedPhrases`, which the document page prints. An
article the archive read and refused goes in `NewsletterMiss` so that the next
run does not spend a request rediscovering it.

**An article is a secondary source and the site never presents it as an SGA
record.** It cannot source a claim about how the SGA works (`AUTHORITATIVE_KINDS`
excludes it), it is not diffed against other sessions, its headline is shown
exactly as printed rather than rewritten into the SGA's house style, and it is
never paired with a meeting -- "SGA discusses transportation services" reads as
minutes of that meeting to every rule in `lib/meetings.ts`,
which is why `SECONDARY_KINDS` in `lib/kinds.ts` exists and why those rules
refuse it outright. It does get the plain-language summary every document gets,
under the same verification, but written to its own prompt in
`lib/summary-prompt.ts`: an SGA record is restated as fact, and an article is
attributed to the reporting that carried it ("the News-Letter reported that the
Senate approved ..."), because stated as fact a reporter's sentence becomes the
archive's own claim about what the SGA did. The document page says in as many
words that the paper published it, the SGA did not write or approve it, and which
phrase is why it is here.

`robots.txt` asks for a ten-second crawl delay and `config/newsletter.ts`
honours it, which is the one fact that shapes operating this: a full backfill is
hours of wall clock, so runs are budgeted and resumable rather than exhaustive.
An article already stored is never fetched again, so a settled year costs six
search requests. The nightly job is its own cron route (`app/api/cron/newsletter/`)
rather than a step inside the Drive sync, because a job bounded by somebody
else's crawl delay cannot share a five-minute function with one that has to
finish. The first load is `npm run newsletter -- --backfill`.

### Layout

| Path | What lives there |
| --- | --- |
| `config/sga.ts` | **The yearly change surface.** Master folder ID, session number, folder exclusions, walk limits. |
| `config/newsletter.ts` | The other source: phrases searched for, crawl delay, per-run budget, earliest year. |
| `schema.prisma` | Documents, revisions, annotations, generated sections, citations, sync runs, affiliates. |
| `lib/` | The pipeline: `drive`, `sync`, `generate`, `ai`, `anchor`, `kinds`, `lineage`, `diff`, `sections`, `passages`, `search`, `integrity`. |
| `lib/` (the paper) | `newsletter` (reads jhunewsletter.com, no database) and `coverage` (stores what it read). |
| `lib/` (forum) | `login`, `ratelimit`, `moderate`, `resend`, `prune` -- the only modules that touch identity, and the reason each keeps so little. |
| `config/` | Everything meant to be edited: `sga`, `search`, `office-hours`, `forum` (categories, limits), `integrity` (hold thresholds). |
| `api/` | Server actions the pages read: `documents`, `sections`, `archive`, `search`, `community`, `auth`, `forum`. |
| `app/(components)/` | `SourceChip`, `DocumentViewer`, `DocumentDiff`, `CitedProse`, `NaturalLanguageSearch`, `SignIn`, `NewPostForm`, `ReplyForm`, `ModerationControls`. |
| `app/api/cron/sync/` | The daily job, guarded by `CRON_SECRET`. Scheduled in `vercel.json`. |
| `app/api/cron/newsletter/` | The daily News-Letter pass, same guard. Separate because it is budgeted, not finite. |
| `scripts/` | `sync` (manual run, supports `--dry-run`), `newsletter`, `review`, `prune`, `seed.demo`, and the `*.check.ts` suites. |

### Historical documents

Past sessions' folders are ingested and kept, but excluded from generation.
`lib/lineage.ts` derives a key that collapses the same document across sessions
("SGA Constitution" and "113th SGA Constitution 2025-2026" share one), which is
what makes `/documents/<id>/compare` able to diff them.

### Commands

```sh
npm run dev          # develop
npm run sync         # sync Drive now; --dry-run to walk without writing
npm run newsletter   # News-Letter coverage; -- --backfill for every year, --dry to search only
npm run summarize    # restate the documents a sync left over; -- --force to redo
npm run search       # -- --index to build the search index; -- "a question" to try it
npm run review       # changes the sync held back; -- --show/--approve/--reject <id>
npm run prune        # drop expired sessions, sign-in codes, and rate buckets
npm run seed:demo    # plausible fixtures, no API keys needed; -- --clear to remove
npm run check        # anchoring, archive/diff, and database integration checks
npm run db:migrate   # apply schema changes
```

Copy `.env.example` to `.env` before any of these. The database is Postgres: the
app connects through Supabase's transaction pooler, and migrations go through
`DIRECT_URL` on the session pooler.

Node 20.19 or later, and 22.12 or later on the 22 line, as `engines` in
`package.json` says. That is Prisma 7's own floor and not a preference: the
Prisma CLI `require`s an ES module, which earlier releases of Node refuse, so
`prisma generate` and `npm run db:migrate` fail outright on 20.18 while the
app's own code runs fine.

## Contributions

## Guideliens to Adhere To

Automatic removal of Director of Communications if website maintenance fails on 4 instances.

