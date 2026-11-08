# Version-bound document images

Google Docs imports now capture embedded PNG, JPEG, GIF, and WebP images before
stripping image markers and payloads from the text. The image bytes, dimensions,
alt text, and original positions are stored in Postgres, not Git or a separate
storage service. There is no per-document manifest in the repository.

`DocumentMedia` belongs to one `DocumentVersion`; `DocumentImage` stores its
ordered image records and bytes. The media snapshot includes the exact text hash
used for placement. Repeated imports cannot overwrite an existing snapshot.
Image-only changes create new version occurrences even when text is unchanged.
The source modification time is rechecked after export before recording media.

The text sanitizer maps image positions through cleanup, keeping the stored text
and citation offsets unchanged. The viewer supports images between blocks and
inside paragraphs or table cells. Google Docs HTML is still used to restore cell
breaks before image capture. Source layout is not a pixel-for-pixel PDF renderer.

The document page loads image metadata only. `/api/document-images/[imageId]`
serves bytes after checking that the associated version is published. Missing,
held, and rejected versions are not served. Responses use the validated raster
MIME type, `nosniff`, and `no-store` so publication changes are respected.

Only embedded raster assets are captured: SVG and external image URLs are not
fetched or served. Limits are 10 MB per image, 30 MB and 100 images per export,
and 40 million pixels per image. Existing unsupported formats such as DOCX/PDF
retain their current text-only ingestion behavior.

## Deployment and existing documents

The additive migration is `20261108010000_document_media`; the existing Vercel
build runs `prisma migrate deploy`. Apply it before running the new application.
The migration and the report backfill were applied to the configured database on
November 8, 2026. Application changes have not been deployed.

The IEGS report (`95334d93-b961-47cd-9dce-958fc95114dc`) has nine stored images
(logo plus eight charts, 204,146 bytes) associated with its November 5 source
occurrence. Its exact exported text and source timestamp were verified against
the saved version before writing. All images and the summary were read back.

Unchanged files retain the inexpensive sync skip; existing documents can be
backfilled individually. Preview first:

```
node --env-file=.env --import tsx scripts/backfill-document-media.ts DOCUMENT_ID
node --env-file=.env --import tsx scripts/backfill-document-media.ts DOCUMENT_ID --apply
```

The command requires a native Google Doc, an unchanged source timestamp, exact
current-text agreement, and a matching published occurrence. It does not rewrite
text, summaries, citations, publication status, or older snapshots. If the source
has changed, sync it first. Historical images whose original version is no longer
available cannot be inferred from the current source.

Checks: `npm run check -- document-media document-media-sync document-versions render drive sync-batching`.
