import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { processDocument, compareCoverage } from './processing.ts';

// Reprocess saved captures offline; never replace the original responses/results.
const folders = process.argv.slice(2);
if (!folders.length) throw new Error('Pass one or more saved result folders, e.g. results/wiki-result-short');
for (const folder of folders) {
  const root = resolve(folder);
  const comparison = JSON.parse(await readFile(join(root, 'comparison.json'), 'utf8'));
  const baseline = JSON.parse(await readFile(join(root, 'firecrawl-baseline.json'), 'utf8'));
  const configured = JSON.parse(await readFile(join(root, 'firecrawl-configured.json'), 'utf8'));
  const original = processDocument(baseline.data.markdown, { url: comparison.url, metadata: baseline.data.metadata, capturedAt: comparison.createdAt });
  const structured = processDocument(configured.data.markdown ?? configured.data.summary, {
    url: comparison.url, metadata: configured.data.metadata, fallbackMetadata: baseline.data.metadata, fallbackFields: original.metadata,
    format: comparison.cleaned.request.formats[0], capturedAt: comparison.createdAt, skipCode: comparison.cleaned.skipCode, kind: comparison.structured?.kind || 'auto',
  });
  const coverage = comparison.captureMode === 'single'
    ? { comparable: false, baselineArticles: structured.items.length, configuredArticles: structured.items.length, missingArticles: [], addedArticles: [], note: 'Single capture; independent collection coverage comparison is unavailable.' }
    : compareCoverage(original, structured);
  if (coverage.missingArticles.length) structured.warnings.push(`${coverage.missingArticles.length} baseline article URLs are absent from configured capture.`);
  const output = join(root, 'reprocessed');
  await mkdir(output, { recursive: true });
  const json = (v: unknown) => JSON.stringify(v, null, 2) + '\n';
  await Promise.all([
    writeFile(join(output, 'structured.json'), json(structured)),
    writeFile(join(output, 'narration.txt'), structured.narration),
    writeFile(join(output, 'display.txt'), structured.displayText),
    writeFile(join(output, 'article.md'), structured.bodyMarkdown),
    writeFile(join(output, 'sources.json'), json({ metadata: structured.metadata, links: structured.links, supplements: structured.supplements })),
    writeFile(join(output, 'collection.json'), json({ items: structured.items, coverage })),
    writeFile(join(output, 'processing-log.json'), json({ reprocessedAt: new Date().toISOString(), sourceComparisonId: comparison.comparisonId, processorSha256: createHash('sha256').update(await readFile(new URL('./processing.ts', import.meta.url))).digest('hex'), omissions: structured.omissions, warnings: structured.warnings, checks: structured.checks })),
  ]);
  console.log(JSON.stringify({ output, kind: structured.kind, characters: structured.displayText.length, cards: structured.items.length, missingCards: coverage.missingArticles.length, warnings: structured.warnings }));
}
