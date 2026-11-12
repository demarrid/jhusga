# Historical archive ingestion

The archive now includes the complete photographed collection and the owner's uploaded past-document folders. Individual HEIC photographs are parts of documents, never separate published records.

## Sources and exclusions

- Photo root: Drive `1y9Pae1O56ZPaSnTMQPTxgABaqD66kzQq`; local `C:\Real\College\2026-2027\SGA\Selections of JHU Student Council Archives-1-001\Selections of JHU Student Council Archives`.
- Past documents root: Drive `154WPl9-3wRYzhjqep7eOEP6BUS9L30_1`; local `C:\Real\College\2026-2027\SGA\JHU SGA Past Documents`.
- Local **Historical Documents** maps to Drive **morris**; **JHU SGA (2015-2016)** to **2015-2016**; **JHU SGA (2019-2020)** to **2019-2020**.
- Exclude **Personal Trainers' Feedback / trainer feedback**. It was intentionally not uploaded. Do not inspect its contents or publish it.
- The root photo ZIP duplicates the photographed collection. Preserve it in the inventory, but do not duplicate its documents.

The archive report's starting-image table defines 86 photo chains, containing 356 images (IMG_2369–IMG_2727, with a numbering gap at IMG_2483–2485). IMG_2368 was visually checked: it shows the archival storage box, not a document, and is retained as collection-overview media. Numbering gaps do not prove missing document pages. Titles and date labels come from the report; dates visible in the transcription may differ and must not be silently reconciled.

Local file matching first uses normalized paths/names and file types. Renamed files are confirmed by MD5 against Drive metadata; ZIP members are materialized only when their bytes match an uploaded source. Source auditing covers every matched past-document file. Keep ambiguous or unmatched files out of publication until resolved.

## Local extraction and approved AI review

Artifacts live in `.archive-local/`, outside Git: originals, raw OCR, source hashes, embedded-text extraction, image-model responses, token usage, uncertainties, review reports, backups, and progress. Never commit these or API keys.

`archive-native.py` extracts Word XML, spreadsheet values, slide text, HTML/CSV and PDF text locally. Scanned pages and image-only sources become vision tasks. Zero/false spreadsheet values are retained. Empty files, theme-only corrupt Office files, and preview-only Apple Pages extraction are explicitly recorded. Full-page image layers are reviewed even if a PDF already contains OCR text. Uploaded form-export ZIPs are read through their CSV contents and flagged for personal/free-text responses; feedback ZIPs remain excluded. Legacy Word reading uses a local `antiword` installation under `.archive-local/tools/antiword`.

The owner explicitly authorized sending archive images, handwriting and OCR—including potentially sensitive material—to **OpenAI's API** using the configured project key/model. `archive-vision.py` uses that connection; `ARCHIVE_VISION_MODEL` may override `AI_MODEL`. Images are supplied at high detail using the [official image-input format](https://developers.openai.com/api/docs/guides/images-vision?api-mode=chat). The prompt treats images as evidence and OCR as an unreliable hint. It requires faithful complete transcription, preserves original wording and edits, excludes background sheets, and marks unreadable or uncertain words rather than inventing plausible text. It does not infer credits, authorship, legislative passage, or dates. No Drive revision-history requests are made.

Vision outputs are cached by original image hash, model, title, orientation and prompt version. Truncated/invalid outputs remain errors, not accepted transcriptions. Duplicate page images with matching titles are reviewed once. Raw local OCR remains intact. Do not run the old raw-OCR reflow script over image-reviewed documents.

## Workflow (WSL, project directory)

```sh
python3 -m pip install --target .archive-local/python -r scripts/archive-ocr-requirements.txt
node_modules/.bin/tsx scripts/archive-inventory.ts
node_modules/.bin/tsx scripts/archive-inventory.ts 154WPl9-3wRYzhjqep7eOEP6BUS9L30_1 .archive-local/past-drive-inventory.json
python3 scripts/archive-chains-prepare.py
python3 scripts/archive-ocr.py --workers 12 --offline --inventory chains-inventory.json
python3 scripts/archive-vision.py --workers 6
python3 scripts/archive-match-local.py
# Resolve/audit renamed files with archive-match-checksums.py,
# archive-match-zips.py, and archive-audit-sources.ts before publication.
python3 scripts/archive-native.py --workers 4
python3 scripts/archive-dedupe-pages.py
python3 scripts/archive-vision.py --tasks .archive-local/native-vision-unique.json --workers 12
node_modules/.bin/tsx scripts/archive-publish.ts
node_modules/.bin/tsx scripts/archive-publish.ts --apply
```

Publication waits for every page of a document to finish. Explicit numbered PDF parts are combined only when all parts are ready. Other similarly named files are not merged by guesswork. The same archive URLs are updated with revision snapshots; citations and search passages are refreshed. Existing non-archive site records are preserved. Original-image/source links are kept under Sources, separate from readable document prose. Historical dates/sessions are assigned only where directly supported; no adoption/current-law status is inferred.

`publication-report.json` lists published/updated/unchanged records and source IDs. `publication-pending.json` accounts for pending tasks and media/container assets. `ALL-REVIEW.md` links documents with sensitivity or text/source issues. Flags are review leads, not privacy clearance, and do not automatically hide content. `source-checksum-audit.json` verifies local-to-Drive identity. `publish-backups/` and database revisions preserve prior text.

Checks:

```sh
python3 scripts/archive-ocr-check.py
python3 scripts/archive-pipeline-check.py
node_modules/.bin/tsx scripts/archive-transcription.check.ts
node_modules/.bin/tsc --noEmit
```

## Manual-only archive policy (November 12, 2026)

Historical Documents (`154WPl9-3wRYzhjqep7eOEP6BUS9L30_1`) and the photograph collection are excluded from automated walks and linked imports. The original inventory IDs are recorded in `config/manual-archive-ids.json`; linked new files are checked through their parent folders. Manual imports require an explicit chat request. Trainer feedback remains excluded.

Imported `discoveredVia: archive` documents expose only current corrected text, including requests carrying old version IDs. Internal revisions remain stored but are not offered by the viewer. Summaries remain source-cited; unreadable sources cannot receive invented summaries.
