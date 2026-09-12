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
   Linked-in files that name a session (`S.B.26-27`) are tagged from that
   caption, not from Drive createdTime or the oldest agenda that pointed at
   them. SharePoint files need Graph credentials when the share is not public
   (see `.env.example`).
3. **Sync** (`lib/sync.ts`). Compares each export's hash against the stored
   copy. Unchanged documents are skipped; changed ones get a new
   `DocumentRevision` and their citations are re-anchored.
4. **Generate** (`lib/generate.ts`). Asks a model to answer a fixed question
   from the documents and to quote its evidence. Every quote is checked to
   appear verbatim in the source before the answer is stored; quotes that do not
   are discarded. Only current-session documents are eligible, so repealed
   language is never described as current law.
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
outsider can actually do, not what the SGA meant to allow.

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

### Layout

| Path | What lives there |
| --- | --- |
| `config/sga.ts` | **The yearly change surface.** Master folder ID, session number, folder exclusions, walk limits. |
| `schema.prisma` | Documents, revisions, annotations, generated sections, citations, sync runs, affiliates. |
| `lib/` | The pipeline: `drive`, `sync`, `generate`, `ai`, `anchor`, `kinds`, `lineage`, `diff`, `sections`, `passages`, `search`, `integrity`. |
| `lib/` (forum) | `login`, `ratelimit`, `moderate`, `resend`, `prune` -- the only modules that touch identity, and the reason each keeps so little. |
| `config/` | Everything meant to be edited: `sga`, `search`, `office-hours`, `forum` (categories, limits), `integrity` (hold thresholds). |
| `api/` | Server actions the pages read: `documents`, `sections`, `archive`, `search`, `community`, `auth`, `forum`. |
| `app/(components)/` | `SourceChip`, `DocumentViewer`, `DocumentDiff`, `CitedProse`, `NaturalLanguageSearch`, `SignIn`, `NewPostForm`, `ReplyForm`, `ModerationControls`. |
| `app/api/cron/sync/` | The daily job, guarded by `CRON_SECRET`. Scheduled in `vercel.json`. |
| `scripts/` | `sync` (manual run, supports `--dry-run`), `review`, `prune`, `seed.demo`, and the `*.check.ts` suites. |

### Historical documents

Past sessions' folders are ingested and kept, but excluded from generation.
`lib/lineage.ts` derives a key that collapses the same document across sessions
("SGA Constitution" and "113th SGA Constitution 2025-2026" share one), which is
what makes `/documents/<id>/compare` able to diff them.

### Commands

```sh
npm run dev          # develop
npm run sync         # sync Drive now; --dry-run to walk without writing
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

## Contributions

## Guideliens to Adhere To

Automatic removal of Director of Communications if website maintenance fails on 4 instances.

