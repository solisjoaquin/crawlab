# Crawlab

## Usar los filtros en otra aplicación

Copiá únicamente `firecrawl-filters.mjs` a tu aplicación. Es un módulo ESM de
JavaScript con las dependencias incluidas: no requiere instalar paquetes, acceder
a este proyecto ni configurar una API key. Procesa respuestas ya obtenidas; no hace
consultas a Firecrawl. Requiere un entorno moderno con soporte de ES2022 y `URL`.

```js
import { filterFirecrawlResponse } from './firecrawl-filters.mjs';

// respuestaFirecrawl: JSON REST { success, data } o el objeto de datos del SDK.
const resultado = filterFirecrawlResponse(respuestaFirecrawl, {
  url: 'https://example.com/articulo', // Opcional si metadata.sourceURL está presente.
  kind: 'auto', // 'auto', 'article' o 'collection'.
  skipCode: true, // Omitir código en el texto de salida. Por defecto: false.
  format: 'markdown', // Usar 'summary' solo si pediste ese formato a la API.
});

console.log(resultado.displayText); // Texto limpio; incluye URLs en colecciones.
console.log(resultado.narration); // Texto para narración.
console.log(resultado.metadata); // Valores con procedencia.
console.log(resultado.omissions, resultado.warnings); // Exclusiones y advertencias.
```

También exporta `processDocument(markdown, { url, ...opciones })`,
`cleanMarkdown(markdown, { skipCode: true })` y `compareCoverage(original, configurado)`.
`cleanMarkdown` convierte Markdown a texto; `processDocument` aplica además las
reglas por sitio y devuelve la estructura completa. El archivo no modifica la
respuesta original. Los filtros `includeTags`, `excludeTags` y `onlyMainContent`
se envían a Firecrawl al consultar: no se pueden reaplicar sobre una respuesta.

El código fuente del adaptador está en `portable-entry.ts` y las reglas en
`processing.ts`. Para regenerar el archivo después de cambiar las reglas:
`node build-portable.mjs` (usa esbuild, incluido actualmente mediante tsx).
Verificación de equivalencia: `node --experimental-strip-types --test portable.test.ts`.

1. `npm install`
2. Create a `.env` file in the project root containing `FIRECRAWL_API_KEY=fc-your-key`.
3. Run `npm start` and open http://localhost:3000.

Requires Node.js 22 or later. Restart the server whenever you change `.env`.
Environment variables take precedence over `.env`. If you previously set a key
in PowerShell, run `Remove-Item Env:FIRECRAWL_API_KEY -ErrorAction SilentlyContinue`
before starting to use the key from the file.

The key stays on the server; never put it in the browser.
Each comparison makes one Firecrawl scrape with `onlyMainContent: true` by default.
Enable **original response** before comparing to make a second independent request
in Markdown with `onlyMainContent: false` and no tag filters. Its unchanged text
appears in a third column. The first two columns still share the configured capture.

## Comparison behavior

The left column shows the exact API text with `onlyMainContent: true`, selected
`excludeTags`, `includeTags`, and either Markdown or summary format. The right
column applies optional local cleanup to that same capture. There is no
onlyMainContent checkbox; the server always enables main-content extraction.

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
With local processing off, both columns are identical. API filters affect the
single shared input; they do not describe differences between the columns.

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
absolute dates. Metadata comes from the single capture. Metadata does not prove factual accuracy.

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

The preservation panel shows metadata, warnings and captured collection cards.
Independent collection coverage comparison is available only with original response
enabled and full Markdown collection inputs. Checks
include numeric retention in selected blocks, available metadata and archived links;
they do not assert semantic equivalence or guarantee the absence of noise.

## Save comparisons locally

After a comparison, click **Save comparison locally**. Files are written by the
local server to `results/<timestamp>-<unique-id>/` inside the project:

- `firecrawl-baseline.json` and `firecrawl-configured.json`: compatibility copies
  of the same single API response, before local cleanup.
- `baseline.md` and `configured.md`: identical text from that response.
- `improved.txt`: the locally cleaned text (`improved.md` when cleanup is off).
- `comparison.json`: displayed results, stats, URL, time, exact request parameters,
  local processing flags, structured analysis, coverage and an implementation hash.
- `structured.json`: extracted document with metadata provenance and sections.
- `article.md`: selected body Markdown (empty for a collection; use collection.json).
- `narration.txt`: narration, separate from the API text and the collection display.
- `sources.json`: metadata, all captured links and supplementary notes/references.
- `collection.json`: captured article cards; independent coverage is unavailable.
- `processing-log.json`: exact exclusions, warnings, preservation checks and whether
  local processing was applied to the displayed output.

Saving does not repeat scrapes or send files to an AI service. The API key and
authorization headers are not included. The last 20 comparisons remain available
to save until server restart; saved files persist and are excluded from Git.
Compare `configured.md` with `improved.txt` to isolate local cleanup. Compare
`baseline.md` with `configured.md` will show identical input in single-capture mode.
Older saved comparisons retain their original two-capture data.
Smaller output alone is not evidence of better quality.

When **original response** is enabled, `firecrawl-baseline.json` and `baseline.md`
instead contain the independent original capture. `comparison.json` includes the
third column under `original` and records `captureMode: "dual"`; otherwise it
records `captureMode: "single"`. Configured text always feeds local processing.

Reprocess saved captures offline without replacing their originals:

```powershell
npm run reprocess -- results/wiki-result-short results/medium-by-category results/medium-article
```

New files go in each folder's `reprocessed/` subdirectory. Re-running replaces only
those derived files. No API requests are made.
