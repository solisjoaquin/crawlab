import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';

type Node = { type: string; value?: string; url?: string; identifier?: string; depth?: number; children?: Node[]; position?: { start: { offset: number; line: number }; end: { offset: number } } };
const parser = unified().use(remarkParse).use(remarkGfm);
const normalize = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
const text = (n: Node): string => n.value ?? (n.children || []).map(text).join('');
const visit = (n: Node, fn: (n: Node) => void) => { fn(n); n.children?.forEach(c => visit(c, fn)); };
const citation = (n: Node) => n.type === 'footnoteReference' || (['link', 'linkReference'].includes(n.type) && /#(?:cite_note(?:-|$)|cite_ref(?:-|$)|fn\d|fnref\d)/i.test(n.url || ''));
const resolveReferences = (tree: Node) => {
  const definitions = new Map<string, string>();
  visit(tree, n => { if (n.type === 'definition' && n.url) definitions.set(n.identifier!, n.url); });
  visit(tree, n => { if (n.type === 'linkReference') n.url = definitions.get(n.identifier!); });
  return tree;
};
const navigation = new Set(['editar', 'editar codigo', 'editar datos', 'edit', 'edit source', 'volver arriba', 'ir al contenido', 'saltar al contenido', 'skip to main content', 'skip to navigation', 'link for this heading', '↑']);
const navigationLink = (n: Node) => navigation.has(normalize(text(n))) && /[?&](?:action=edit|veaction=(?:edit|editsource))|#(?:maincontent|main-content|bodyContent|navigation|content-area|cite_ref)/i.test(n.url || '');
const wikidataControl = (n: Node) => {
  if (n.type !== 'link' || !n.url) return false;
  try {
    const url = new URL(n.url);
    return /(^|\.)wikidata\.org$/.test(url.hostname) && /^(?:editar datos en wikidata|ver y modificar los datos en wikidata|edit on wikidata)$/.test(normalize(text(n)));
  } catch { return false; }
};
// Entity links also occur inside infoboxes and prose: they are never end markers.
const wikiFooterMarker = (n: Node) => {
  const label = normalize(text(n));
  return ['paragraph', 'heading'].includes(n.type) &&
    (/^(?:obtenido de|retrieved from)\s/.test(label) ||
      /^(?:categorias?|categorias ocultas|categories|hidden categories):?$/.test(label));
};

function plain(n: Node, skipCode: boolean): string {
  if (citation(n) || ['image', 'imageReference', 'definition', 'footnoteDefinition', 'html', 'thematicBreak'].includes(n.type)) return '';
  if (n.type === 'code') return skipCode ? '(code block omitted)' : n.value || '';
  if (n.value !== undefined) return n.value;
  if (n.type === 'break') return '\n';
  const parts = (n.children || []).map(c => plain(c, skipCode));
  const label = parts.join('');
  if (['link', 'linkReference'].includes(n.type) && (navigationLink(n) || wikidataControl(n))) return '';
  if (n.type === 'paragraph' && !label.replace(/[\s\[\]·|]/g, '')) return '';
  if (n.type === 'tableRow') return parts.join(' · ');
  if (['root', 'list', 'listItem', 'table', 'blockquote'].includes(n.type)) return parts.filter(Boolean).join('\n');
  return label;
}

// Only standalone escape lines are removed, never slashes inside URLs or code.
const tidy = (s: string) => s.split('\n').filter(l => !/^\s*\\+\s*$/.test(l)).map(l => l.replace(/[ \t]+/g, ' ').trim()).join('\n').trim();
export function cleanMarkdown(markdown: string, options = { skipCode: true }): string {
  return resolveReferences(parser.parse(markdown) as Node).children!.map(n => n.type === 'code' ? plain(n, options.skipCode) : tidy(plain(n, options.skipCode))).filter(Boolean).join('\n\n');
}

const source = (markdown: string, n: Node) => markdown.slice(n.position!.start.offset, n.position!.end.offset);
const linksIn = (n: Node) => { const result: Node[] = []; visit(n, c => { if (c.type === 'link') result.push(c); }); return result; };
const hasImage = (n: Node) => { let result = false; visit(n, c => { if (c.type === 'image') result = true; }); return result; };
const scalar = (v: unknown): string | null => typeof v === 'string' && v.trim() ? v : Array.isArray(v) ? scalar(v[0]) : null;
const isMediumStory = (url = '') => { try { const u = new URL(url); return /(^|\.)medium\.com$/.test(u.hostname) && /-[a-f\d]{12}$/.test(u.pathname); } catch { return false; } };
const canonical = (url: string) => { const u = new URL(url); if (/(^|\.)medium\.com$/.test(u.hostname)) u.searchParams.delete('source'); u.hash = ''; return u.href; };

export type ProcessingOptions = { url: string; metadata?: any; fallbackMetadata?: any; fallbackFields?: Record<string, { value: string | null; source: string | null }>; skipCode?: boolean; kind?: 'auto' | 'article' | 'collection'; format?: string; capturedAt?: string };
export function processDocument(markdown: string, options: ProcessingOptions) {
  const tree = resolveReferences(parser.parse(markdown) as Node), nodes = tree.children!;
  const meta = options.metadata || {}, fallback = options.fallbackMetadata || {};
  const host = new URL(options.url).hostname;
  const medium = /(^|\.)medium\.com$/.test(host), guardian = /(^|\.)theguardian\.com$/.test(host), wiki = /(^|\.)wikipedia\.org$/.test(host);
  const kind = options.kind && options.kind !== 'auto' ? options.kind : medium && /^\/tag\//.test(new URL(options.url).pathname) ? 'collection' : 'article';
  const isSummary = options.format === 'summary';
  const fields: Record<string, { value: string | null; source: string | null }> = {};
  const field = (name: string, keys: string[]) => {
    for (const [data, origin] of [[meta, 'configured.metadata'], [fallback, 'baseline.metadata']] as const) {
      for (const key of keys) if (scalar(data[key])) return fields[name] = { value: scalar(data[key]), source: origin + '.' + key };
    }
    return fields[name] = { value: null, source: null };
  };
  field('title', ['ogTitle', 'og:title', 'title']);
  field('author', ['author']);
  field('publishedAt', ['article:published_time', 'publishedTime']);
  field('updatedAt', ['article:modified_time', 'dc:modified', 'modifiedTime']);
  const h1 = nodes.findIndex(n => n.type === 'heading' && n.depth === 1);
  if (h1 >= 0) fields.title = { value: text(nodes[h1]), source: 'configured.markdown.heading' };
  else if (wiki && fields.title.value) fields.title.value = fields.title.value.replace(/ - Wikipedia.*$/, '');
  fields.url = { value: options.url, source: 'request.url' };
  fields.deck = { value: null, source: null };
  fields.relativeDate = { value: null, source: null };
  const omissions: any[] = [], supplements: any[] = [], captions: any[] = [], kept: Node[] = [];
  const omit = (n: Node, reason: string) => omissions.push({ reason, line: n.position!.start.line, markdown: source(markdown, n) });
  const allLinks: any[] = [];
  const definitions = new Map<string, Node>();
  visit(tree, n => { if (n.type === 'definition') definitions.set(n.identifier!, n); });
  visit(tree, n => {
    const target = n.type === 'linkReference' ? definitions.get(n.identifier!)?.url : n.type === 'link' ? n.url : undefined;
    if (!target) return;
    let url: URL; try { url = new URL(target, options.url); } catch { return; }
    if (!['http:', 'https:'].includes(url.protocol)) return;
    allLinks.push({ label: text(n), originalUrl: target, url: url.href, line: n.position?.start.line, scope: url.hostname === host ? 'same-site' : 'external', role: citation({ ...n, type: 'link', url: url.href }) ? 'citation' : navigationLink({ ...n, url: url.href }) ? 'navigation' : 'link' });
  });
  const warnings: string[] = [];
  let start = h1 >= 0 ? h1 + 1 : 0;
  let end = nodes.length;

  // These boundaries are site-scoped and require observed structural context.
  if (!isSummary && medium && kind === 'article' && h1 >= 0) {
    const firstSection = nodes.findIndex((n, i) => i > h1 && n.type === 'heading' && n.depth === 2);
    if (firstSection >= 0) {
      start = firstSection;
      const prefix = nodes.slice(h1 + 1, start);
      const deck = prefix.filter(n => n.type === 'paragraph' && text(n).length > 90 && !hasImage(n)).at(-1);
      if (deck) fields.deck = { value: text(deck), source: 'configured.markdown.beforeFirstSection' };
      const byline = prefix.flatMap(linksIn).find(n => /medium\.com\/@/.test(n.url || '') && text(n));
      if (!fields.author.value && byline) fields.author = { value: text(byline), source: 'configured.markdown.byline' };
    } else warnings.push('Medium section layout not recognized; prefix is retained for review.');
    const footer = nodes.findIndex((n, i) => i >= start && linksIn(n).some(l => /[?&]source=post_page---footer_tags/.test(l.url || '')));
    if (footer >= 0) end = footer;
  }
  if (!isSummary && guardian && kind === 'article') {
    const dateIndex = nodes.findIndex((n, i) => i > h1 && /(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+\d{1,2}\s+[A-Z][a-z]{2}\s+\d{4}/.test(text(n)));
    if (dateIndex >= 0) {
      const date = text(nodes[dateIndex]).split('Last modified on ');
      fields.publishedAt = { value: date[0].trim(), source: 'configured.markdown.dateline' };
      if (date[1]) fields.updatedAt = { value: date[1].trim(), source: 'configured.markdown.dateline' };
      const author = nodes.slice(Math.max(h1 + 1, 0), dateIndex).flatMap(linksIn).find(n => /theguardian\.com\/profile\//.test(n.url || ''));
      if (author) fields.author = { value: text(author), source: 'configured.markdown.byline' };
      const deck = nodes.slice(Math.max(h1 + 1, 0), dateIndex).filter(n => n.type === 'paragraph' && !hasImage(n) && !linksIn(n).length).at(-1);
      if (deck) fields.deck = { value: text(deck), source: 'configured.markdown.standfirst' };
      start = dateIndex + 1;
    } else warnings.push('Guardian dateline not found; article boundaries need review.');
    const donation = nodes.findIndex((n, i) => i >= start && n.type === 'heading' && normalize(text(n)) === 'at this dangerous time' && /We hope you appreciated this article/.test(text(nodes[i + 1] || { type: 'text' })));
    if (donation >= 0) end = donation;
  }
  const relative = nodes.find(n => /^(Just now|\d+ (?:minutes?|hours?|days?) ago)$/i.test(text(n).trim()));
  if (relative) fields.relativeDate = { value: text(relative), source: 'configured.markdown.relativeDate' };
  for (const [key, value] of Object.entries(options.fallbackFields || {})) {
    if (!fields[key]?.value && value.value) fields[key] = { value: value.value, source: (value.source || 'metadata').replace(/^configured\./, 'baseline.') };
  }
  if (fields.relativeDate.value && !fields.publishedAt.value) warnings.push('Relative date has no absolute publication date; do not infer one from capture time.');

  const items: any[] = [];
  if (!isSummary && kind === 'collection') {
    let section: string[] = [], publisherSummary = false;
    const seen = new Set<string>();
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      if (n.type === 'heading') { section[(n.depth || 1) - 1] = text(n); section.length = n.depth || 1; }
      if (/Suggested reads, summarized by AI/.test(text(n))) publisherSummary = true;
      if (n.type === 'heading' && n.depth === 2 && /Latest stories|Popular this week|Selected by Medium/.test(text(n))) publisherSummary = false;
      for (const link of linksIn(n)) {
        const candidate = medium ? isMediumStory(link.url) : /^https?:\/\//.test(link.url || '') && text(link).length > 20 && !citation(link);
        if (!candidate || !text(link).trim() || /^(A clap icon|A response icon|Repost icon)/.test(text(link))) continue;
        const url = canonical(link.url!); if (seen.has(url)) continue; seen.add(url);
        const rawLabel = text(link).split(/\\+\s*\n/).map(s => s.trim()).filter(Boolean);
        const title = rawLabel[0];
        let next = i + 1;
        while (next < nodes.length && !linksIn(nodes[next]).some(l => isMediumStory(l.url) && text(l) && !/^(A clap icon|A response icon|Repost icon)/.test(text(l))) && nodes[next].type !== 'heading') next++;
        const after = nodes.slice(i + 1, next);
        // Latest-story bylines precede cards; featured-card bylines follow the excerpt.
        const before = nodes.slice(Math.max(0, i - 5), i);
        const authorLinks = (publisherSummary ? after : before).flatMap(linksIn).filter(l => /medium\.com\/@[^/]+(?:\?|$)/.test(l.url || '') && text(l));
        const excerpt = rawLabel.slice(1).join(' ') || (publisherSummary ? after.find(n => n.type === 'paragraph' && text(n).length > 60 && !hasImage(n) && !linksIn(n).length) : null);
        const date = before.find(n => /^(Just now|\d+ (?:minutes?|hours?|days?) ago|[A-Z][a-z]{2} \d{1,2}(?:, \d{4})?)$/.test(text(n).trim()));
        items.push({ title, url, originalUrl: link.url, author: authorLinks.at(-1) ? text(authorLinks.at(-1)!) : null, excerpt: typeof excerpt === 'string' ? excerpt || null : excerpt ? text(excerpt) : null, excerptSource: publisherSummary ? 'publisher-ai-summary' : rawLabel.length > 1 ? 'publisher-card-excerpt' : null, section: section.filter(Boolean), relativeDate: date ? text(date) : null, publishedAt: null, line: link.position?.start.line });
      }
    }
    warnings.push('Collection extraction covers captured cards, not the full topic or linked articles. Publisher summaries are not verified article bodies.');
    if (!medium) warnings.push('Generic collection uses labeled HTTP links as candidates; article classification and bylines need review.');
    // Collection narration is built from cards; full raw input and omissions stay available.
    for (const n of nodes) {
      const label = tidy(text(n));
      const represented = items.some(item => item.line === n.position?.start.line || [item.title, item.author, item.excerpt, item.relativeDate, ...item.section].some(value => value && value === label));
      if (label && !represented) omit(n, 'not-in-collection-records');
    }
  } else {
    let supplemental: { title: string; markdown: string; line: number; depth: number } | null = null;
    let wikiFooter = false;
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i], label = tidy(text(n));
      if (i < start || i >= end) { omit(n, i < start ? 'outside-article-prefix' : 'outside-article-suffix'); continue; }
      if (!isSummary && wiki && wikiFooterMarker(n)) wikiFooter = true;
      if (wikiFooter) { omit(n, 'wiki-footer'); continue; }
      if (!isSummary && wiki && n.type === 'heading' && (!supplemental || (n.depth || 1) <= supplemental.depth)) {
        const name = normalize(text(n));
        supplemental = ['referencias', 'referencias y notas', 'notas y referencias', 'notas', 'bibliografia', 'enlaces externos', 'vease tambien', 'references', 'external links', 'further reading', 'see also', 'notes', 'categories'].includes(name) ? { title: text(n), markdown: '', line: n.position!.start.line, depth: n.depth || 1 } : null;
        if (supplemental) supplements.push(supplemental);
      }
      if (supplemental) { supplemental.markdown += source(markdown, n) + '\n\n'; omit(n, 'supplement-preserved-separately'); continue; }
      if (!isSummary && wiki && linksIn(n).some(l => /meta\.wikimedia\.org\//.test(l.url || ''))) { omit(n, 'wikimedia-campaign'); continue; }
      if (!isSummary && wiki && (/^(De Wikipedia, la enciclopedia libre|Buscar$|1 idioma)/.test(label) || (n.type !== 'table' && /^control de autoridades\b/.test(normalize(label))))) { omit(n, 'wiki-interface'); continue; }
      if (!isSummary && medium && n.type === 'heading' && /^Get .+ stories in\s+your\s+inbox$/.test(label.replace(/\s+/g, ' '))) { omit(n, 'newsletter-heading'); continue; }
      if (!isSummary && medium && (/^Join Medium for free to get updates from\s+this\s+writer\.$/.test(label.replace(/\s+/g, ' ')) || /^Remember me for faster sign in$/.test(label) || /^Press enter or click to view image in full size$/.test(label))) { omit(n, 'medium-interface'); continue; }
      if (!isSummary && guardian && hasImage(n) && /Read more\s*$/.test(label) && linksIn(n).length) { omit(n, 'related-story-card'); continue; }
      if ((medium || guardian || wiki) && n.type !== 'heading' && (/^(Share|View image in fullscreen)$/.test(label) || navigation.has(normalize(label)) || /^\s*\[\s*\]\s*$/.test(tidy(plain(n, false))))) { omit(n, 'interface-control'); continue; }
      if (n.type === 'paragraph' && hasImage(n) && (!label || wiki)) { captions.push({ text: label || null, markdown: source(markdown, n), line: n.position!.start.line }); omit(n, 'image-caption-preserved-separately'); continue; }
      kept.push(n);
    }
  }
  // Compare against the input, not just surviving blocks, to catch destructive cutoffs.
  const inputPlainCharacters = nodes.map(n => tidy(plain(n, !!options.skipCode))).join('\n\n').length;
  const retainedPlainCharacters = kept.map(n => tidy(plain(n, !!options.skipCode))).join('\n\n').length;
  let conservativeFallbackApplied = false;
  if (kind === 'article' && !isSummary && inputPlainCharacters > 1000 && retainedPlainCharacters < inputPlainCharacters * .2) {
    warnings.push('Local cleanup retained less than 20% of input text. Review sources and omissions; short output is not proof of quality.');
    const recoverable = nodes.filter(n => n.type === 'paragraph' && tidy(plain(n, false)).length >= 200 && omissions.some(o => o.line === n.position!.start.line && !['supplement-preserved-separately', 'wikimedia-campaign', 'related-story-card', 'newsletter-heading'].includes(o.reason)));
    if (recoverable.length) {
      kept.push(...recoverable);
      kept.sort((a, b) => a.position!.start.offset - b.position!.start.offset);
      for (const n of recoverable) omissions.splice(omissions.findIndex(o => o.line === n.position!.start.line), 1);
      conservativeFallbackApplied = true;
      warnings.push('Conservative fallback restored long paragraphs excluded by cleanup rules. They may contain interface text; review before use.');
    }
  }
  const sections = kept.map(n => ({ type: n.type, depth: n.depth ?? null, line: n.position!.start.line, markdown: source(markdown, n), text: n.type === 'code' ? plain(n, !!options.skipCode) : tidy(plain(n, !!options.skipCode)) }));
  const bodyMarkdown = kept.map(n => source(markdown, n)).join('\n\n');
  const collectionText = (withUrls: boolean) => [fields.title.value, ...items.map(item => [item.title, item.author ? 'By ' + item.author : null, item.excerptSource === 'publisher-ai-summary' ? 'Publisher AI summary: ' + (item.excerpt || '') : item.excerpt, withUrls ? item.url : null].filter(Boolean).join('\n'))].filter(Boolean).join('\n\n');
  const narration = kind === 'collection' && !isSummary
    ? collectionText(false)
    : [fields.title.value, fields.deck.value, ...sections.map(s => s.text)].filter(Boolean).join('\n\n');
  const displayText = kind === 'collection' && !isSummary ? collectionText(true) : narration;
  const bodyLinks = allLinks.filter(l => kept.some(n => l.line >= n.position!.start.line && l.line <= (source(markdown, n).split('\n').length + n.position!.start.line - 1)));
  const numerical = (s: string) => [...new Set(s.match(/\b\d+(?:[.,]\d+)*(?:%|\+)?/g) || [])];
  const retainedInput = kept.filter(n => !(options.skipCode && n.type === 'code')).map(n => plain(n, false)).join('\n');
  const lostNumbers = numerical(retainedInput).filter(n => !numerical(narration).includes(n));
  if (lostNumbers.length) warnings.push('Review numbers missing from narration: ' + lostNumbers.join(', '));
  if (!fields.title.value) warnings.push('Title not found; metadata was not invented.');
  if (!isSummary && !medium && !guardian && !wiki) warnings.push('Generic Markdown extraction: site-specific article boundaries have not been verified.');
  if (isSummary) warnings.push('Input is an API summary, not the full article. Article boundaries and collection extraction were not applied.');
  return { schemaVersion: 1, kind, inputFormat: options.format || 'markdown', metadata: fields, capturedAt: options.capturedAt || null,
    cache: { state: meta.cacheState || null, cachedAt: meta.cachedAt || null },
    bodyMarkdown, sections, links: allLinks, bodyLinks, supplements, captions, items, narration, displayText, omissions, warnings,
    checks: { inputPlainCharacters, retainedPlainCharacters, conservativeFallbackApplied, retainedBlocks: kept.length, omittedBlocks: omissions.length, missingNumbersInRetainedBlocks: lostNumbers, titleAvailable: !!fields.title.value, authorAvailable: !!fields.author.value, publishedDateAvailable: !!fields.publishedAt.value, sourceLinksArchived: allLinks.length, knownPatternMatchesAreNotAQualityScore: true } };
}

export function compareCoverage(baseline: ReturnType<typeof processDocument>, configured: ReturnType<typeof processDocument>) {
  const original = new Set(baseline.items.map(i => i.url)), current = new Set(configured.items.map(i => i.url));
  const comparable = baseline.kind === 'collection' && configured.kind === 'collection' && baseline.inputFormat !== 'summary' && configured.inputFormat !== 'summary';
  return { comparable, baselineArticles: original.size, configuredArticles: current.size, missingArticles: comparable ? baseline.items.filter(i => !current.has(i.url)) : [], addedArticles: comparable ? configured.items.filter(i => !original.has(i.url)) : [], note: comparable ? 'Independent captures; missing cards are coverage differences, not automatically noise.' : 'Collection coverage is not comparable for articles or API summary inputs.' };
}
