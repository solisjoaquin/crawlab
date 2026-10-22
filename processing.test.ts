import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { cleanMarkdown, processDocument, compareCoverage } from './processing.ts';

const capture = (name: string) => {
  const folder = `results/${name}/`;
  const c = JSON.parse(readFileSync(folder + 'comparison.json', 'utf8'));
  const b = JSON.parse(readFileSync(folder + 'firecrawl-baseline.json', 'utf8'));
  const f = JSON.parse(readFileSync(folder + 'firecrawl-configured.json', 'utf8'));
  return { c, result: processDocument(c.conf.text, { url: c.url, metadata: f.data.metadata, fallbackMetadata: b.data.metadata }), baseline: processDocument(c.base.text, { url: c.url, metadata: b.data.metadata }) };
};

test('numeric links, standalone numbers, literal brackets and code survive; only known citation anchors disappear', () => {
  const input = '[1928](https://example.com/1928), [37%](https://example.com/rate), [v2](https://example.com/version)\n\n[123] is a literal value.\n\n42\n\n[1](https://example.com/#cite_note-1) [Nota 2](https://example.com/#cite_note-2)\n\n[1963][year]\n\n[year]: https://example.com/1963\n\n```js\nconst path = "C:\\\\temp";\n```';
  const cleaned = cleanMarkdown(input, { skipCode: false });
  assert.match(cleaned, /1928, 37%, v2/);
  assert.match(cleaned, /\[123\] is a literal value/);
  assert.match(cleaned, /\n\n42\n\n/);
  assert.match(cleaned, /1963/);
  assert(!cleaned.includes('Nota 2'));
  assert(cleaned.includes('const path = "C:\\\\temp";'));
  assert.equal(cleanMarkdown('The path ends with `C:\\`.', { skipCode: false }), 'The path ends with C:\\.');
  assert.equal(cleanMarkdown('[edit](https://example.com/editing-guide)', { skipCode: false }), 'edit');
  assert(cleanMarkdown(input).includes('(code block omitted)'));
});

test('Wikipedia regression preserves election years, removes campaigns and archives notes and references', () => {
  const { result } = capture('wiki-result-short');
  assert.match(result.narration, /En las elecciones presidenciales de 1928, 1937, 1958 y 1963/);
  assert(result.metadata.title.value?.startsWith('Radicalismo en Argentina'));
  assert(!/Wiki Ama la Paz|Ayúdanos con las traducciones|\[Nota \d|Buscar|Control de autoridades|Obtenido de/.test(result.narration));
  assert(result.supplements.some(s => s.title === 'Notas' && s.markdown.includes('José María Guido')));
  assert(result.supplements.some(s => s.title === 'Referencias' && s.markdown.includes('berissociudad')));
  assert(result.links.some(l => l.url.includes('Elecciones_presidenciales_de_Argentina_de_1928')));
  assert.deepEqual(result.checks.missingNumbersInRetainedBlocks, []);
  assert(result.sections.some(s => s.depth === 2 && s.text === 'Historia'));
});

test('Medium category preserves all 15 configured cards and reports the 10 missing baseline cards', () => {
  const { result, baseline } = capture('medium-by-category');
  assert.equal(result.kind, 'collection');
  assert.equal(result.items.length, 15);
  assert.equal(baseline.items.length, 25);
  const coverage = compareCoverage(baseline, result);
  assert.equal(coverage.missingArticles.length, 10);
  assert.equal(result.items[0].author, 'Matt Bentley');
  assert.equal(result.items[0].excerptSource, 'publisher-ai-summary');
  assert(result.items[0].originalUrl.includes('?source='));
  assert(!result.items[0].url.includes('?source='));
  for (const item of result.items) { assert(result.narration.includes(item.title)); assert(result.displayText.includes(item.url)); }
  assert(!result.narration.includes('https://'));
  assert(!/A clap icon|reCAPTCHA|Sign in|Sitemap/.test(result.narration));
  assert.equal(result.items.at(-1).relativeDate, 'Just now');
  assert.equal(result.items.at(-1).publishedAt, null);
  assert(result.cache.cachedAt);
});

test('Medium article retains sources, absolute date, numerical claims and section hierarchy without signup modules', () => {
  const { result } = capture('medium-article');
  assert.equal(result.kind, 'article');
  assert.equal(result.metadata.author.value, 'Infinite Compute');
  assert.equal(result.metadata.publishedAt.value, '2026-10-22T00:27:26.191Z');
  assert(result.bodyLinks.some(l => l.label === 'CBRE, H2 2025' && l.url.includes('cbre.com')));
  assert(!/Press enter or click|Remember me|Join Medium|stories in\s+your\s+inbox|Sitemap|Text to speech/.test(result.narration));
  for (const value of ['1.4%', '$196', '6.6%', '81%', '130+', '10,000+']) assert(result.narration.includes(value), value);
  assert(result.narration.includes('Talk to the Infinite Compute team'));
  assert(result.sections.some(s => s.type === 'list' && s.markdown.includes('Hardware root of trust')));
  assert.equal(result.checks.missingNumbersInRetainedBlocks.length, 0);
  assert(result.omissions.some(o => o.reason === 'newsletter-heading'));
});

test('Guardian retains author, both dates, all 38 body paragraphs and 12 sections; excludes campaign and recommendations', () => {
  const input = readFileSync('test/news-article/result-fc.txt', 'utf8');
  const result = processDocument(input, { url: 'https://www.theguardian.com/wellness/ng-interactive/2026/oct/21/lessons-from-hospice-workers-life-death' });
  assert.equal(result.metadata.author.value, 'Madeleine Aggeler');
  assert.equal(result.metadata.publishedAt.value, 'Wed 21 Oct 2026 12.00 EDT');
  assert.equal(result.metadata.updatedAt.value, 'Wed 21 Oct 2026 13.00 EDT');
  assert.equal(result.sections.filter(s => s.type === 'paragraph').length, 38);
  assert.equal(result.sections.filter(s => s.type === 'heading').length, 12);
  assert(!/At this dangerous time|Read more|Most viewed|We hope you appreciated|single woman/.test(result.narration));
  assert(result.narration.includes('what we’re remembered for'));
  assert(result.omissions.some(o => o.reason === 'related-story-card'));
  assert(result.links.some(l => l.url.includes('/how-to-get-comfortable-with-death')));
});

test('site-specific cutoffs require context, generic prose with images and absent metadata are preserved safely', () => {
  const input = '# Example\n\n## At this dangerous time\n\nA genuine paragraph with [1928](https://example.com/year) and ![a chart](chart.png).\n\n## References\n\nA legitimate discussion of references.';
  const result = processDocument(input, { url: 'https://example.com/article' });
  assert(result.narration.includes('A genuine paragraph with 1928'));
  assert(result.narration.includes('A legitimate discussion'));
  assert.equal(result.metadata.author.value, null);
  assert.equal(result.metadata.publishedAt.value, null);
  const guardian = processDocument(input, { url: 'https://www.theguardian.com/example' });
  assert(guardian.narration.includes('A genuine paragraph'));
});

test('summary inputs are labeled and never parsed as full article modules', () => {
  const result = processDocument('A summary of 1928.', { url: 'https://medium.com/tag/artificial-intelligence', format: 'summary' });
  assert.equal(result.items.length, 0);
  assert(result.narration.includes('A summary of 1928.'));
  assert(result.warnings.some(w => w.includes('API summary')));
  const { baseline } = capture('medium-by-category');
  const coverage = compareCoverage(baseline, result);
  assert.equal(coverage.comparable, false);
  assert.equal(coverage.missingArticles.length, 0);
});

test('missing configured metadata can be recovered from baseline with explicit provenance', () => {
  const original = processDocument('# Story\n\nBody.', { url: 'https://example.com/story', metadata: { author: 'Reporter', 'article:published_time': '2026-10-21T12:00:00Z' } });
  const result = processDocument('Body.', { url: 'https://example.com/story', fallbackFields: original.metadata });
  assert.equal(result.metadata.title.value, 'Story');
  assert.equal(result.metadata.title.source, 'baseline.markdown.heading');
  assert.equal(result.metadata.author.value, 'Reporter');
  assert.equal(result.metadata.author.source, 'baseline.metadata.author');
  assert.equal(result.metadata.publishedAt.value, '2026-10-21T12:00:00Z');
});
