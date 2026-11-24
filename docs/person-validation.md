# Contextual person validation

Automatic contributor ingestion now calls `validatePersonMentions` before resolving names or changing people/credit rows. The model sees each extracted candidate, its evidence, nearby source text, and the document title. It decides only whether the candidate refers to a human; the existing source parser remains responsible for credit labels, and identity resolution remains separate. This does not request Drive revisions or ask AI to assign bill authorship, sponsors, or passage status.

Only `person` decisions proceed. `not_person` and `uncertain` candidates are withheld. An unavailable API/cache or an incomplete, duplicate, invalid, or invented decision set fails the import before identity writes or replacement of existing credits. A failed review does not retroactively certify old credits. Manually curated corrections and verified account provenance are separate from this automatic extraction path.

Reviews run in batches of 32 and are cached by the prompt, configured model/provider, candidates, title, and supplied evidence context. `PersonMentionReview` retains the input, decisions, explanations, model, and time for review. Context changes trigger a new review. Existing unchanged documents need an explicit contributor refresh to be rechecked; this change does not silently reprocess the entire archive.

Deploy migration `20261124010000_person_mention_review` with the application. The configured AI credentials must be available to contributor refresh jobs. No switch allows automatic ingestion to silently skip validation.

Checks:

```sh
node --import tsx scripts/person-validation.check.ts
node --import tsx scripts/person-validation-sync.check.ts
node --import tsx scripts/contributors.check.ts
node --import tsx scripts/university-names.check.ts
```

The user confirmed Nifemi Ajayi and Oluwanifemi Ajayi are the same person. The manual canonical-name mapping prevents re-creation of the alternate full-name row. `scripts/correct-nifemi-ajayi.ts` moves the existing credits without replacing their evidence or IDs and records a manual alias, with a local backup and conflict checks.
