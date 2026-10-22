# Crawlab
1. `npm install`
2. Create a `.env` file in the project root containing `FIRECRAWL_API_KEY=fc-your-key`.
3. Run `npm start` and open http://localhost:3000.

Requires Node.js 22 or later. Restart the server whenever you change `.env`.
Environment variables take precedence over `.env`. If you previously set a key
in PowerShell, run `Remove-Item Env:FIRECRAWL_API_KEY -ErrorAction SilentlyContinue`
before starting to use the key from the file.

The key stays on the server; never put it in the browser.
Each comparison makes 2 scrapes (baseline + your configuration).

## Comparison behavior

The baseline explicitly requests markdown with `onlyMainContent: false` and no tag
filters. Configured output sends the selected `onlyMainContent`, `excludeTags`,
`includeTags`, and either `formats: ["markdown"]` or `formats: ["summary"]`.
The API's other defaults still apply; the baseline is not raw HTML.

Local processing is checked by default. It builds article narration or collection
records and archives links, metadata, headings, notes and references separately.
Numeric link text is retained; known citation anchors are omitted only from narration.
Optional code omission affects narration, not the original Markdown or stored sections.
These changes are made by Crawlab. With processing off, the right column remains
the exact configured API text; structured analysis is still available separately.
Summary is generated content and is not a like-for-like markdown comparison.
Each result exposes the request parameters, local processing and API warnings.

Character counts measure output size. Tokens use the rough characters / 4 estimate,
not a model tokenizer. Markdown link/image counts describe the returned text;
known-pattern matches use a small heuristic expression, not a quality score.
Independent scrapes can differ, and filters can produce no change when matching
elements are absent or already removed by main-content filtering.

Contract reference: https://docs.firecrawl.dev/api-reference/endpoint/scrape

Run the offline request/response and UI audit with:
`npm test` (Node.js 22).
These tests mock Firecrawl responses and do not verify filtering on live websites.
Regression tests also use the saved Wikipedia, Medium and Guardian captures.

## Structured extraction and narration

Choose Auto-detect, Article, or Collection / category. Auto-detection recognizes
Medium `/tag/` pages as collections. Other URLs default to articles; generic
collections use labeled links as candidates and require review.

Articles expose title, author, publication/update dates and URL with field-level
provenance. Missing fields are null; relative dates are never converted into invented
absolute dates. Baseline metadata/fields can recover missing configured fields,
and their provenance identifies that source. Metadata does not prove factual accuracy.

The structured version preserves selected body Markdown and heading/list structure,
all input links, captions, supplementary notes/references and exact excluded blocks.
The narration is a separate plain-text projection, suitable for further audio review.
For collections, the displayed version includes article URLs; narration omits URLs
for speech, and `collection.json` retains them with authors, excerpts and sections.
Publisher AI summaries remain labeled as such, not treated as full article text.

Site-scoped Markdown rules address the captured Wikipedia campaign/interface,
Medium signup/image controls and Guardian related-story cards/donation boundary.
They are deterministic heuristics validated against these captures, not universal
DOM extraction or proof that every module is removed. Unknown layouts can require
manual review. The original API responses always remain available for comparison.

The preservation panel shows metadata, warnings and collection coverage. Missing
baseline cards are reported, not silently merged or classified as noise. Checks
include numeric retention in selected blocks, available metadata and archived links;
they do not assert semantic equivalence or guarantee the absence of noise.

## Save comparisons locally

After a comparison, click **Save comparison locally**. Files are written by the
local server to `results/<timestamp>-<unique-id>/` inside the project:

- `firecrawl-baseline.json`: original baseline API response.
- `firecrawl-configured.json`: original configured API response, before local cleanup.
- `baseline.md` and `configured.md`: text from those responses.
- `improved.txt`: the locally cleaned text (`improved.md` when cleanup is off).
- `comparison.json`: displayed results, stats, URL, time, exact request parameters,
  local processing flags, structured analysis, coverage and an implementation hash.
- `structured.json`: extracted document with metadata provenance and sections.
- `article.md`: selected body Markdown (empty for a collection; use collection.json).
- `narration.txt`: narration, separate from the API text and the collection display.
- `sources.json`: metadata, all captured links and supplementary notes/references.
- `collection.json`: article cards plus missing/added URLs versus baseline.
- `processing-log.json`: exact exclusions, warnings, preservation checks and whether
  local processing was applied to the displayed output.

Saving does not repeat scrapes or send files to an AI service. The API key and
authorization headers are not included. The last 20 comparisons remain available
to save until server restart; saved files persist and are excluded from Git.
Compare `configured.md` with `improved.txt` to isolate local cleanup. Compare
`baseline.md` with `configured.md` to assess native options, allowing for changes
between independent scrapes. Smaller output alone is not evidence of better quality.

Reprocess saved captures offline without replacing their originals:

```powershell
npm run reprocess -- results/wiki-result-short results/medium-by-category results/medium-article
```

New files go in each folder's `reprocessed/` subdirectory. Re-running replaces only
those derived files. No API requests are made.
