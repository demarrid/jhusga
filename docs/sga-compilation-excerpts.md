# SGA compilation digital excerpts

The SGA PDF (`9933ad79-8df2-4cc2-ad5c-ed268ca59e7c`, Drive `1W2ZThJXJHOrlZ9_2biao3lqAGrbvD2S_`) contains multiple historical documents. Keep the original PDF, full transcription, URL, and annotations. It is a collection, not a meeting dated by its first page.

`config/sga-compilation-excerpts.ts` records 42 reviewed ranges in the existing image-reviewed transcription. Line numbers refer to the pinned SHA-256 text, not PDF pages. Multi-page documents and briefing appendices remain together. Differing copies of retreat agendas, ceremony programs, and bills remain distinct. Undated or partially dated records receive no invented exact date. Committee recommendations and blank enactment blocks are not evidence of passage.

`split-sga-compilation.ts` creates digital records with synthetic archive identities and the same original source URL. Each gets a published revision, search passages, a full-compilation link, and reciprocal document references. Named-person credits are limited to established compilation identities independently supported by the excerpt parser. It does not make AI or Drive revision-history calls. Uncertain handwritten fragments remain in the full compilation; the local report lists uncovered nonblank lines so they are not mistaken for reviewed individual documents.

```sh
node --env-file=.env --import tsx scripts/split-sga-compilation.ts
node --env-file=.env --import tsx scripts/split-sga-compilation.ts --apply
```

The preview rejects source drift, overlapping ranges, and exact existing duplicate bodies. Publication is transactional, refuses to overwrite changed excerpts, and is repeatable without creating new revisions or duplicate records. A local backup and verified result are saved under ignored `.archive-local/`.

The same correction removes parsed contributions for the false identity “To Be Announced,” deleting its affiliate row only if it has no remaining relationships or account metadata. The contributor parser rejects this and related unfilled-position labels while retaining real names.
