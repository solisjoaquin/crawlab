import { processDocument, type ProcessingOptions } from './processing.ts';
export { cleanMarkdown, processDocument, compareCoverage } from './processing.ts';

type FirecrawlData = { markdown?: string; summary?: string; metadata?: Record<string, unknown> };
type FirecrawlResponse = FirecrawlData | { success?: boolean; error?: string; data?: FirecrawlData };
type FilterOptions = Omit<ProcessingOptions, 'url'> & { url?: string; format?: 'markdown' | 'summary' };

/** Process a scrape response (REST envelope or SDK data) without making requests. */
export function filterFirecrawlResponse(response: FirecrawlResponse, options: FilterOptions = {}) {
  if (!response || typeof response !== 'object') throw new TypeError('Expected a Firecrawl response object.');
  if ('success' in response && response.success === false) throw new Error(response.error || 'Firecrawl scrape failed.');
  const data = ('data' in response ? response.data : response) as FirecrawlData | undefined;
  if (!data || typeof data !== 'object') throw new TypeError('Firecrawl response data is missing.');
  const format = options.format ?? 'markdown';
  if (format !== 'markdown' && format !== 'summary') throw new TypeError('Expected markdown or summary format.');
  const markdown = data[format];
  if (typeof markdown !== 'string') throw new TypeError(`Firecrawl response is missing ${format}.`);
  const metadata = options.metadata ?? data.metadata ?? {};
  const url = options.url ?? metadata.sourceURL ?? metadata.url;
  if (typeof url !== 'string') throw new TypeError('Provide options.url or metadata.sourceURL.');
  let parsed: URL;
  try { parsed = new URL(url); } catch { throw new TypeError('Expected an absolute HTTP or HTTPS URL.'); }
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new TypeError('Expected an absolute HTTP or HTTPS URL.');
  return processDocument(markdown, { ...options, url, metadata, format });
}
