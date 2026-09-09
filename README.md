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
   are recognised as archives and tagged with their session number.
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
5. **Render**. Pages read cached sections and never call a model on request.

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

### Layout

| Path | What lives there |
| --- | --- |
| `config/sga.ts` | **The yearly change surface.** Master folder ID, session number, folder exclusions, walk limits. |
| `schema.prisma` | Documents, revisions, annotations, generated sections, citations, sync runs, affiliates. |
| `lib/` | The pipeline: `drive`, `sync`, `generate`, `ai`, `anchor`, `kinds`, `lineage`, `diff`, `sections`. |
| `api/` | Server actions the pages read: `documents`, `sections`, `archive`, `community`, `auth`. |
| `app/(components)/` | `SourceChip`, `DocumentViewer`, `DocumentDiff`, `GeneratedProse`. |
| `app/api/cron/sync/` | The daily job, guarded by `CRON_SECRET`. Scheduled in `vercel.json`. |
| `scripts/` | `sync` (manual run, supports `--dry-run`), `seed.demo`, and the `*.check.ts` suites. |

### Historical documents

Past sessions' folders are ingested and kept, but excluded from generation.
`lib/lineage.ts` derives a key that collapses the same document across sessions
("SGA Constitution" and "113th SGA Constitution 2025-2026" share one), which is
what makes `/documents/<id>/compare` able to diff them.

### Commands

```sh
npm run dev          # develop
npm run sync         # sync Drive now; --dry-run to walk without writing
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

