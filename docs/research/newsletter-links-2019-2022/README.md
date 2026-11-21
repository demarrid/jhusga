# News-Letter document-link scan, 2019–2022

Research date: November 20, 2026.

Scanned 591 candidate articles. 284 contained a search phrase in the article body; 106 linked to candidate documents, forms, folders, or attachments. Found 196 distinct targets across 240 link occurrences.

## Files

- `inventory.html`: standalone searchable browser page; no server or dependencies required.

- `documents.csv` and `documents.json`: deduplicated target inventory with original URLs, article headings where available, source articles, and archive identity matches. Article headings are context, not verified document titles.
- `link-occurrences.csv`: every extracted link occurrence, including repeated mentions.
- `articles.csv`: every candidate article, including those with no matching phrase or no document links.
- `searches.json`: all year/phrase search pages, reported counts, and empty terminating pages.
- `summary.json`: coverage and counts.
- `date-filter-verification.json`: observed date-filter regression evidence.
- `additional-link-audit.json`: check for embedded/bare target URLs and title-only phrase matches; none were additional.

## Search date correction

The initial unpadded month query (`ts_month=1`) silently omitted January–March. The verified form contract is two-digit months (`01`) and unpadded days (`1`). Correcting this expanded the four-year candidate set from 370 to 591 articles. For the 2021 SGA query alone, the reported count increased from 33 to 61, including multimedia; article results increased from 23 to 44. Both initial and corrected query evidence are retained locally. The repository search URL builder and regression checks were corrected as part of this research.

## Method and limits

Searched the newspaper’s own search engine for `sga`, `student council`, and `student government`, separately for each calendar year. Read pages until each query returned no article results; no query reached the 1,000-result cap. Cross-checked candidates against existing archive newspaper URLs for the same period; none were missing. Fetched every candidate at a ten-second minimum request interval, retaining local HTML for verification.

Extracted anchors only from the article-content container (one legacy article used its intro-graf through social-share body boundary, recorded in articles.csv) after confirming a whole-word SGA / student council / student government match in that body. Kept Google Docs/Drive, SharePoint, OneDrive, and direct PDF/Word/Excel/PowerPoint attachment URLs. Navigation, related stories, and footer links were excluded. Google file IDs and SharePoint sharing tokens were deduplicated; original URL variants remain in JSON.

This is exhaustive for the enumerated search candidates, not proof that the newspaper’s index includes every historical article. Reported search-result totals can include non-article results; articles.csv contains only article URLs in the requested years.

A linked item is a recovery lead, not necessarily an SGA-authored record. Forms, folders, outside organizations’ documents, drafts, and unrelated attachments remain visible for review. Linked document contents, current access, authorship, and adoption were not verified. No passage status was inferred and no production records were modified.

Archive matches use file IDs or normalized source URLs. An unmatched ID can still be a duplicate of an archived PDF or another copy, so “No matching archive ID or URL” does not establish that its contents are absent.

One concrete version caveat: a constitution linked by a 2020 article matches an archive record currently titled “CSE Constitution Feb. 2024.” The file identity matches, but this does not establish the contents that readers saw in 2020.

## Coverage by year

- 2019: 201 candidates scanned; 84 body matches; 19 articles with links; 38 distinct targets (targets may recur across years).
- 2020: 181 candidates scanned; 84 body matches; 39 articles with links; 67 distinct targets (targets may recur across years).
- 2021: 125 candidates scanned; 67 body matches; 24 articles with links; 54 distinct targets (targets may recur across years).
- 2022: 84 candidates scanned; 49 body matches; 24 articles with links; 50 distinct targets (targets may recur across years).
