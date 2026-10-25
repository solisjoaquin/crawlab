import http from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import { pathToFileURL } from 'node:url';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { processDocument, compareCoverage } from './processing.ts';
export { cleanMarkdown } from './processing.ts';

if (existsSync('.env')) process.loadEnvFile('.env');

type Node = { type: string; value?: string; depth?: number; lang?: string; children?: Node[] };
const parser = unified().use(remarkParse).use(remarkGfm);
const noiseRe = /skip to (main )?(content|navigation)|link for this heading|^\s*(copy|copy page|hide|download|reload|clear|fork|sitemap|open in app|sign in|sign up|search|buscar|view image in fullscreen|press enter or click to view image in full size|remember me for faster sign in)\s*$|A clap icon|A response icon|Repost icon|Wiki Ama la Paz|Read more|Most viewed|reCAPTCHA|\[\]\(/gim;
export const stats = (t: string) => {
  let links = 0, images = 0;
  const visit = (node: Node) => {
    if (node.type === 'link' || node.type === 'linkReference') links++;
    if (node.type === 'image' || node.type === 'imageReference') images++;
    node.children?.forEach(visit);
  };
  visit(parser.parse(t) as Node);
  return { chars: t.length, tokens: Math.round(t.length / 4), links, images, noise: (t.match(noiseRe) || []).length };
};

export function buildScrapeBody(url: string, o: any) {
  const body: any = { url, formats: [o.summary ? 'summary' : 'markdown'], onlyMainContent: true };
  if (o.excludeTags?.length) body.excludeTags = o.excludeTags;
  if (o.includeTags?.length) body.includeTags = o.includeTags;
  return body;
}

async function scrape(url: string, o: any, original = false) {
  const body = buildScrapeBody(url, o);
  if (original) body.onlyMainContent = false;
  const t0 = Date.now();
  const r = await fetch('https://api.firecrawl.dev/v2/scrape', {
    method: 'POST', headers: { Authorization: `Bearer ${process.env.FIRECRAWL_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body), signal: AbortSignal.timeout(65000),
  });
  const j: any = await r.json();
  if (!r.ok || !j.success) throw new Error(j.error || `HTTP ${r.status}`);
  const text = j.data?.[o.summary ? 'summary' : 'markdown'];
  if (typeof text !== 'string') throw new Error(`Firecrawl did not return the requested ${o.summary ? 'summary' : 'markdown'} output.`);
  return { text, response: j, request: body, warning: j.data.warning, status: j.data.metadata?.statusCode, ms: Date.now() - t0 };
}

export const createAppServer = (resultsRoot = resolve('results')) => {
 const comparisons = new Map<string, any>();
 return http.createServer(async (req, res) => {
  if (req.method === 'GET') {
    const pathname = new URL(req.url || '/', 'http://localhost').pathname;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.end(readFileSync(pathname === '/how-it-works' || pathname === '/how-it-works/' ? 'how-it-works.html' : 'index.html'));
  }
  try {
    let raw = ''; for await (const c of req) raw += c;
    if (req.method === 'POST' && req.url === '/save') {
      const { comparisonId } = JSON.parse(raw);
      const comparison = comparisons.get(comparisonId);
      if (!comparison) { res.statusCode = 404; return res.end(JSON.stringify({ error: 'Comparison expired. Run it again before saving.' })); }
      if (!comparison.savedPath) {
        const folder = join(resultsRoot, comparisonId);
        await mkdir(folder, { recursive: true });
        const json = (data: unknown) => JSON.stringify(data, null, 2) + '\n';
        await Promise.all([
          writeFile(join(folder, 'firecrawl-baseline.json'), json(comparison.responses.baseline)),
          writeFile(join(folder, 'firecrawl-configured.json'), json(comparison.responses.configured)),
          writeFile(join(folder, 'baseline.md'), (comparison.result.original || comparison.result.base).text),
          writeFile(join(folder, 'configured.md'), comparison.result.conf.text),
          writeFile(join(folder, comparison.result.cleaned.localCleanup ? 'improved.txt' : 'improved.md'), comparison.result.cleaned.text),
          writeFile(join(folder, 'comparison.json'), json(comparison.result)),
          writeFile(join(folder, 'structured.json'), json(comparison.result.structured)),
          writeFile(join(folder, 'narration.txt'), comparison.result.structured.narration),
          writeFile(join(folder, 'article.md'), comparison.result.structured.bodyMarkdown),
          writeFile(join(folder, 'sources.json'), json({ metadata: comparison.result.structured.metadata, links: comparison.result.structured.links, supplements: comparison.result.structured.supplements })),
          writeFile(join(folder, 'collection.json'), json({ items: comparison.result.structured.items, coverage: comparison.result.coverage })),
          writeFile(join(folder, 'processing-log.json'), json({ appliedToDisplayedOutput: comparison.result.cleaned.localCleanup, omissions: comparison.result.structured.omissions, warnings: comparison.result.structured.warnings, checks: comparison.result.structured.checks })),
        ]);
        comparison.savedPath = folder;
      }
      res.setHeader('Content-Type', 'application/json');
      return res.end(JSON.stringify({ path: comparison.savedPath }));
    }
    if (req.method !== 'POST' || req.url !== '/') { res.statusCode = 404; return res.end(JSON.stringify({ error: 'Not found' })); }
    const { url, options, skipCode, localCleanup = false, pageType = 'auto', originalResponse = false } = JSON.parse(raw);
    if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) throw new Error('Enter an HTTP or HTTPS URL.');
    if (!options || typeof options.summary !== 'boolean') throw new Error('Invalid scrape options.');
    if (typeof originalResponse !== 'boolean') throw new Error('Invalid original response option.');
    if (!['auto', 'article', 'collection'].includes(pageType)) throw new Error('Invalid page type.');
    for (const key of ['excludeTags', 'includeTags']) {
      if (options[key] !== undefined && (!Array.isArray(options[key]) || !options[key].every((v: unknown) => typeof v === 'string'))) throw new Error(`Invalid ${key}.`);
    }
    const [conf, original] = await Promise.all([
      scrape(url, options),
      originalResponse ? scrape(url, { summary: false }, true) : Promise.resolve(null),
    ]);
    const base = conf; // Compatibility aliases reference the same single capture.
    const capturedAt = new Date().toISOString();
    const structured = processDocument(conf.text, { url, metadata: conf.response.data.metadata, kind: pageType, skipCode: !!localCleanup && !!skipCode, format: options.summary ? 'summary' : 'markdown', capturedAt });
    const coverage = original
      ? compareCoverage(processDocument(original.text, { url, metadata: original.response.data.metadata, kind: pageType, capturedAt }), structured)
      : { comparable: false, baselineArticles: structured.items.length, configuredArticles: structured.items.length, missingArticles: [], addedArticles: [], note: 'Single capture; independent collection coverage comparison is unavailable.' };
    if (coverage.missingArticles.length) structured.warnings.push(`${coverage.missingArticles.length} article URLs from the original capture are missing in the configured capture. Independent captures may differ.`);
    const cleaned = localCleanup ? structured.displayText : conf.text;
    const out = (t: string, extra: object = {}) => ({ text: t, stats: stats(t), ...extra });
    res.setHeader('Content-Type', 'application/json');
    const comparisonId = new Date().toISOString().replace(/[:.]/g, '-') + '-' + randomUUID();
    const result = { comparisonId, createdAt: capturedAt, url, captureMode: original ? 'dual' : 'single', structured, coverage,
      ...(original ? { original: out(original.text, { ms: original.ms, status: original.status, request: original.request, warning: original.warning }) } : {}),
      implementationSha256: createHash('sha256').update(readFileSync(new URL('./server.ts', import.meta.url))).update(readFileSync(new URL('./processing.ts', import.meta.url))).digest('hex'),
      notes: 'Left: API text with onlyMainContent true and selected filters and format. Right: local processing of the same text. Optional third column: independent Markdown capture with onlyMainContent false and no tag filters. Base and conf alias the configured capture. Tokens are characters / 4 estimates. Less text does not prove higher quality.',
      base: out(base.text, { ms: base.ms, status: base.status, request: base.request, warning: base.warning }), conf: out(conf.text, { ms: conf.ms, status: conf.status }), cleaned: out(cleaned, { request: conf.request, warning: conf.warning, localCleanup: !!localCleanup, skipCode: !!localCleanup && !!skipCode }) };
    comparisons.set(comparisonId, { result, responses: { baseline: original?.response || base.response, configured: conf.response } });
    if (comparisons.size > 20) comparisons.delete(comparisons.keys().next().value!);
    res.end(JSON.stringify(result));
  } catch (e: any) { res.statusCode = 500; res.end(JSON.stringify({ error: e.message })); }
});
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (!process.env.FIRECRAWL_API_KEY?.trim()) throw new Error('Missing FIRECRAWL_API_KEY. Set it in the .env file and restart the server.');
  createAppServer().listen(3000, () => console.log('http://localhost:3000'));
}
