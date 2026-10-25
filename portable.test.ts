import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { filterFirecrawlResponse, processDocument as portableProcess } from './firecrawl-filters.mjs';
import { processDocument } from './processing.ts';

test('portable bundle matches processing for saved captures', () => {
  let checked = 0;
  for (const folder of readdirSync('results')) {
    const path = `results/${folder}/firecrawl-configured.json`;
    const comparison = `results/${folder}/comparison.json`;
    if (!existsSync(path) || !existsSync(comparison)) continue;
    const response = JSON.parse(readFileSync(path, 'utf8'));
    const { url } = JSON.parse(readFileSync(comparison, 'utf8'));
    if (typeof response.data?.markdown !== 'string') continue;
    const options = { url, metadata: response.data.metadata };
    assert.deepEqual(filterFirecrawlResponse(response, options), processDocument(response.data.markdown, options));
    checked++;
  }
  assert(checked > 0);
});

test('portable response adapter supports SDK data, summaries, errors and does not mutate input', () => {
  const data = { markdown: '# Title\n\nFacts from [1928](https://example.com/year).', summary: 'Summary.', metadata: { sourceURL: 'https://example.com/story' } };
  const before = JSON.stringify(data);
  assert.deepEqual(filterFirecrawlResponse(data), portableProcess(data.markdown, { url: data.metadata.sourceURL, metadata: data.metadata, format: 'markdown' }));
  assert.equal(filterFirecrawlResponse(data, { format: 'summary' }).inputFormat, 'summary');
  assert.equal(JSON.stringify(data), before);
  assert.throws(() => filterFirecrawlResponse({ success: false, error: 'Scrape failed' }), /Scrape failed/);
  assert.throws(() => filterFirecrawlResponse({ summary: 'Only summary' }), /missing markdown/);
  assert.throws(() => filterFirecrawlResponse({ markdown: 'Body' }), /options.url/);
  assert.throws(() => filterFirecrawlResponse(data, { url: 'file:///tmp/input' }), /HTTP/);
});
