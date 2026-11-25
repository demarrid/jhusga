# Archive people extraction

Apply migrations before running the updated app or archive scripts:

```sh
npx prisma migrate deploy
npm run people -- --limit 20
```

`npm run people` processes all documents lacking a successfully applied current people extraction. It is independent of summary status. `--session 114` or `--document <id>` narrows the scope. `--limit` counts attempted documents, not model calls; long documents require multiple calls, and candidate validation and identity resolution can make additional calls. Failed documents are reported, remain retryable, and cause a nonzero exit status without stopping the rest of the batch.

The model reads every chunk of the document, including prose, with overlap at chunk boundaries. Each person needs an exact source quote containing the supplied name. Invalid individual entries are skipped while valid people from the same document continue. Rejections append to the ignored local `.archive-local/people-rejections.jsonl` file with document ID/title, model, chunk, candidate, and reason; rejected entries are never saved to the database. A malformed response envelope or model request failure still fails the document and remains retryable. If the local filesystem cannot accept the log, a count-only warning is printed and processing continues. Documents with skipped entries count as processed; the local log is the review queue. First names and nicknames use the existing conservative identity resolver. Mentions do not establish attendance or authorship. Author, introducer and sponsor credit remains with the source-line parser; the model is instructed to exclude names appearing solely in credit lines or enactment/ceremony signatures.

Sync and `npm run reprocess` also use this extraction. Successful extractions are cached independently of summaries using the text, title, kind, prompt version and configured AI provider/model. Linking failures reuse valid extraction output on retry. Completion is recorded only after linking succeeds. Changes to the extraction prompt invalidate the cache. Changing identity-resolution rules alone does not invalidate extraction: use `npm run reprocess` to relink cached names against updated rules and the current archive roster.

AI extraction uses the existing `AI_API_KEY`, `AI_PROVIDER` and `AI_MODEL` configuration. This is a text extraction pass; improving missing OCR text still requires re-importing the document. A verified quote grounds the name but does not guarantee the model found every person or interpreted every role correctly.
