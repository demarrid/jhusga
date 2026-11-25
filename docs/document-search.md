# Document search and minutes titles

The document finder supports case-insensitive literal text searches:

- `public safety`: both terms must occur, possibly in different fields.
- `"public safety"`: the contiguous phrase must occur exactly, ignoring case.
- `safety AND training`, `safety +training`, or `safety + training`: require both.
- `safety OR policing`: either alternative can match. AND binds before OR.
- `safety -draft` or `safety -"student fees"`: exclude matching documents.

Search covers titles, descriptions, document text, and linked people's names. Operators are recognized outside quotes. Parenthetical grouping and Google's other operators are not supported. Results carry the query and return-to-search URL into the viewer. Matching positive terms/phrases are highlighted across inline formatting using the browser's CSS Highlight API, and the first match is scrolled into view unless a citation anchor is present. A match solely in metadata or a person's expanded name may have no literal match in the document body. Browsers without CSS Highlight support still display the document normally.

Preview title standardization for every stored `minutes.*` category (including agenda records within those categories):

```sh
npm run titles:minutes
npm run titles:minutes -- --apply
```

This reuses the existing source-based title formatter rather than asking AI to invent titles or dates. Already standardized documents are skipped. Ambiguous titles and collisions are deferred in `.archive-local/historical-meeting-title-preview.json`. Applying writes a local backup and updates only display titles, preserving original titles and content. The command does not modify source files in Drive. Existing historical-only script usage remains available without `--all-minutes`.

## AI normalization

Apply the migration before running the updated app or normalizers:

```sh
npx prisma migrate deploy
npm run titles:minutes:ai -- --limit 20
npm run titles:minutes:ai -- --cached-only --apply
```

The AI pass considers every minutes-category record without a current applied AI title, including cases the deterministic formatter could not resolve. `--document <id>` narrows the scope. `--limit` caps new document generation requests, not cached proposals or provider retries. Preview is the default; `--apply` also saves accepted titles. Use `--cached-only --apply` to apply cached proposals without making new AI requests. Rerunning can reuse previews and proceed to additional uncached documents within the limit.

Proposals and uncertainty decisions are cached locally under ignored `.archive-local/minute-titles/`, keyed by source, prompt, provider and model. Invalid responses and API failures are logged locally and retried on later runs. Preview reports include evidence and reasons; timestamped backups precede updates. Original source titles and content are preserved. Duplicate titles and stale records are skipped. Oversized inputs are not silently truncated.

Only applied titles and their source fingerprints are stored in the database. Sync honors them while the source title, content, kind and folder remain unchanged; changed sources become eligible for AI normalization again. No AI calls occur during ordinary sync. Evidence validation rejects invented quotations and unsupported numeric dates/numbers, but cannot guarantee every semantic interpretation is correct; preview before applying when reviewing ambiguous records. Ambiguous dates retain source notation rather than having a year or date order guessed.

## AI document dates

Apply the date migration before running the date command:

```sh
npx prisma migrate deploy
npm run dates:ai -- --limit 20
npm run dates:ai -- --document <id>
npm run dates:ai -- --cached-only --apply
```

The pass reads undated non-newsletter documents. A document that already has a date is skipped. `--limit` caps new model requests, not cached proposals. Preview is the default. `--apply` stores the value and a source fingerprint, and sets `datedAt` to a sort anchor: the exact day, the first of a month, January 1 of a year, or June 1 of a session range. Readers see the precision itself — `May 4, 2015`, `May 2015`, `2015`, or `2024–2025 session` — rather than the anchor day.

The model receives the session-to-years map and returns its estimate: a day, a month, a year, or that session's academic-year range. A response with no estimate is left undated. The stored value is the model's date; quotations are not rechecked.

Proposals are cached under ignored `.archive-local/document-dates/`. Invalid responses and API failures are logged there and retried. Sync keeps an applied date while the source is unchanged and does not call the model. A changed source drops the AI date and becomes eligible again. Newsletter articles keep the byline assigned at ingest.
