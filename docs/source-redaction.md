# Personal data in documents and their sources

Some archived files are individual records: contractor agreements and W-9s
with Social Security numbers, sign-up sheets with home addresses and cell
numbers. The site removes those details from the text it shows, and never links
the Drive original that still holds them.

## The text filter

`lib/archive-redaction.ts` finds and replaces, with a labelled placeholder such
as `[REDACTED: home address]`:

- Social Security and taxpayer numbers, labelled or in the 123-45-6789 shape;
- bank account and routing numbers, passwords, dates of birth, driver's
  licence numbers;
- personal phone numbers. University office exchanges (410-516 and the like),
  toll-free lines, fax and office lines, Zoom dial-ins and venue listings stay;
- home and mailing addresses: the value of a home/mailing/permanent address
  field, a W-9's "Address (number, street, and apt. or suite no.)" and "City,
  state, and ZIP code", a bare "Address:" unless it is a campus or office
  address, and any street address with an apartment or unit.

Labels and policy text stay ("protect Social Security numbers", a blank
`SSN:` line). Every rule needs an actual value, so the filter is idempotent.

It runs where text is stored, not where it is shown, because citation offsets
index the stored text:

- `lib/sync.ts` filters every Drive export before hashing it, so an unchanged
  source is still recognised as unchanged. A Google Doc's image positions are
  moved with the text (`redactCapturedDocument`).
- `scripts/archive-publish.ts` and `scripts/refresh-pdf.ts` filter what they
  publish.
- Historical versions shown in a comparison are filtered as they are read.

News-Letter articles are not filtered: the numbers a paper printed are part of
its reporting.

To clean text stored before a rule existed:

```sh
npm run redact:text            # dry run: counts per table
npm run redact:text -- --apply
```

This rewrites document text, quotes, revisions, summaries and generated prose,
then re-anchors citations, moves image positions and rebuilds search passages.
Its report (`.archive-local/purge-progress.json`) holds counts only.

## Source copies

A document whose stored text carries a placeholder gets no Drive link. Its
page says the original is withheld until a redacted copy is approved; then
"view source" opens that copy from `/api/documents/[documentId]/source`. Links
to the same Drive files inside the text (an archive record's `## Sources`
footer) are pointed at the copy, or dropped.

Copies are made offline:

```sh
npm run redact:sources -- --document ID      # build and preview, store nothing
npm run redact:sources -- --flagged          # every document with a placeholder
npm run redact:sources -- --document ID --upload
npm run redact:sources -- --approve ID       # after reviewing every page
npm run redact:sources -- --withdraw ID
```

For each document, `scripts/source-redact.ts`:

1. takes the source file(s) from `.archive-local/originals` or Drive (a Google
   Doc, Sheet or deck is exported as PDF; an archive record made from several
   photographs joins them in order);
2. reads every page with `scripts/source-redact.py`: the text layer, plus local
   OCR (RapidOCR, upright and turned a quarter each way, for margin notes) on
   scanned pages and pages carrying images;
3. places boxes (`lib/source-redaction.ts`):
   - over any word the text filter would remove, and over handwriting OCR
     reads as an SSN or a street;
   - over the field beside and below a form label such as "SSN" or "Address
     (Home address is required...)", read or not, since handwriting is often
     unreadable and often written above the line;
   - over the whole page for a W-9, W-4 or direct deposit form, with a notice
     printed on it;
   - wherever `config/source-redactions.json` says (see below);
4. burns the boxes in with PyMuPDF redaction, which deletes the text, drawing
   and image pixels underneath, then flattens every page to an image, so the
   copy has no text layer, form fields, annotations, attachments or metadata;
5. OCRs the finished copy again, and refuses to store it if that re-read still
   finds personal data, if it still has a text layer, if it is over 4 MB (the
   size a Vercel function can return; rendering steps down to fit), or if the
   stored text needed redacting and no box was placed.

Work files, previews (`preview/page-NNN.png`) and `report.json` stay in
`.archive-local/redacted/<document id>/`, outside Git. Reports hold counts and
page numbers, never values.

**Review before approving.** OCR cannot read every hand, and the re-read check
uses the same OCR. A stored copy is `pending` and is never served until
`--approve`. Look at every preview page with a box and every handwritten page.

### Manual boxes

`config/source-redactions.json`, keyed by document id:

```json
{
  "DOCUMENT-ID": {
    "note": "Phone numbers written up the margin of page 15",
    "pages": [8],
    "boxes": [{ "page": 15, "box": [0.78, 0.05, 1, 0.6] }]
  }
}
```

`pages` withholds whole pages; `boxes` are `[left, top, right, bottom]` as
fractions of the page, pages counted from 1. Rebuild after editing; OCR is
cached while the source is unchanged.

### Limits

- The Drive originals are untouched and still public to anyone who has their
  link. Restricting or replacing them is the file owner's job in Drive.
- Uploaded Word and Excel files are not converted; their documents stay
  withheld until a PDF of them is redacted by hand.
- A copy is made from the source as it was when built. If the Drive file
  changes, `sourceSha256` will no longer match; build it again.
