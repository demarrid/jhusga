# SGA Meeting Agendas digital excerpts

The original record `132a69b0-28b9-4901-a5d4-75c6c919419a` and Drive PDF `1QHe93kq3tB5iLS5SFVPuIyvbeIOdKkdh` remain intact, including the full transcription and all annotations.

`config/sga-meeting-agendas-excerpts.ts` defines 33 reviewed, nonoverlapping ranges of the hash-pinned transcription. These cover every nonblank body line. Agendas retain their handwritten notes; the bylaws presentation and presidential briefing (including appendices A–H) remain whole. The April 2017 bylaws are explicitly tentative. Month-only and undated items receive no invented exact date. Agenda check marks do not establish passage.

```sh
node --env-file=.env --import tsx scripts/split-sga-meeting-agendas.ts
node --env-file=.env --import tsx scripts/split-sga-meeting-agendas.ts --apply
```

The script follows the earlier SGA compilation split: synthetic archive identities, a shared source PDF URL, individual published revisions and search passages, and reciprocal links to the collection. It checks source drift, overlaps, coverage, and existing duplicate bodies before writing transactionally. Existing excerpts are never overwritten. Only full-name identities independently supported by the excerpt parser and matching a parent credit can be retained; no AI or Drive history requests are made.

Timestamped backups and a result report are stored in ignored `.archive-local/`. Post-publication checks verify all excerpts have revisions and search passages, share the original source URL, and leave the original transcription and annotations unchanged. The parent is classified as a collection with no single meeting date.
