import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createAppServer, stats } from './server.ts';
import { processDocument, compareCoverage } from './processing.ts';

test('HTTP route forwards each checkbox and returns only the requested output format', async () => {
  const nativeFetch = globalThis.fetch;
  const sent: any[] = [];
  let missing = false;
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(init!.body as string);
    sent.push(body);
    const data: any = { markdown: '# Article\n\n[Link](https://example.com)\n\n```js\nsecretCode()\n```', summary: 'Summary result', metadata: { statusCode: 200 }, warning: 'Fixture warning' };
    if (!body.onlyMainContent) data.markdown = '# Original capture\n\nNavigation and full page content.';
    if (missing) delete data.summary;
    return new Response(JSON.stringify({ success: true, data }));
  };
  const saveRoot = await mkdtemp(join(tmpdir(), 'crawlab-audit-'));
  const server = createAppServer(saveRoot);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as { port: number };
  const request = async (options: any, extra: any = {}) => {
    sent.length = 0;
    const response = await nativeFetch(`http://127.0.0.1:${address.port}`, {
      method: 'POST', body: JSON.stringify({ url: 'https://example.com', options, localCleanup: false, ...extra }),
    });
    return { status: response.status, data: await response.json() as any };
  };
  try {
    for (const onlyMainContent of [false, true]) {
      for (const summary of [false, true]) {
        for (const tag of [undefined, 'nav', 'footer', 'button', 'aside']) {
          const options = { onlyMainContent, summary, excludeTags: tag ? [tag] : [], includeTags: [] };
          const { data } = await request(options);
          assert.equal(sent.length, 1, 'exactly one Firecrawl request per comparison');
          assert.deepEqual(sent[0], { url: 'https://example.com', formats: [summary ? 'summary' : 'markdown'], onlyMainContent: true, ...(tag ? { excludeTags: [tag] } : {}) });
          assert.deepEqual(data.cleaned.request, sent[0]);
          assert.equal(data.cleaned.text, summary ? 'Summary result' : data.base.text);
          assert.equal(data.cleaned.warning, 'Fixture warning');
          assert.equal(data.base.text, data.conf.text);
          assert.equal(data.cleaned.text, data.base.text);
          assert.equal(data.captureMode, 'single');
          assert.equal(data.original, undefined);
        }
      }
    }
    const options = { summary: false, excludeTags: ['nav', '.sandpack'], includeTags: ['article', 'main'] };
    const { data } = await request(options, { localCleanup: true, skipCode: true, originalResponse: true });
    assert.equal(sent.length, 2);
    assert.deepEqual(sent[1], { url: 'https://example.com', formats: ['markdown'], onlyMainContent: false });
    assert.equal(data.captureMode, 'dual');
    assert.match(data.original.text, /Original capture/);
    assert.notEqual(data.original.text, data.base.text);
    assert.deepEqual(sent[0].excludeTags, options.excludeTags);
    assert.deepEqual(sent[0].includeTags, options.includeTags);
    assert(data.cleaned.text.includes('(code block omitted)'));
    assert(!data.cleaned.text.includes('secretCode()'));
    const apiCallsBeforeSave = sent.length;
    const save = async () => {
      const response = await nativeFetch(`http://127.0.0.1:${address.port}/save`, { method: 'POST', body: JSON.stringify({ comparisonId: data.comparisonId }) });
      assert.equal(response.status, 200);
      return await response.json() as any;
    };
    const saved = await save();
    assert.equal(sent.length, apiCallsBeforeSave, 'saving must not call Firecrawl');
    assert.equal(resolve(saved.path), join(saveRoot, data.comparisonId));
    assert.equal(await readFile(join(saved.path, 'baseline.md'), 'utf8'), data.original.text);
    assert.equal(JSON.parse(await readFile(join(saved.path, 'firecrawl-baseline.json'), 'utf8')).data.markdown, data.original.text);
    assert.equal(await readFile(join(saved.path, 'configured.md'), 'utf8'), data.conf.text);
    assert.equal(await readFile(join(saved.path, 'improved.txt'), 'utf8'), data.cleaned.text);
    const response = JSON.parse(await readFile(join(saved.path, 'firecrawl-configured.json'), 'utf8'));
    assert.equal(response.data.markdown, data.conf.text);
    const metadata = JSON.parse(await readFile(join(saved.path, 'comparison.json'), 'utf8'));
    assert.deepEqual(metadata.cleaned.request, sent[0]);
    assert.equal(metadata.implementationSha256.length, 64);
    assert.equal(JSON.parse(await readFile(join(saved.path, 'structured.json'), 'utf8')).metadata.title.value, 'Article');
    assert.equal(await readFile(join(saved.path, 'narration.txt'), 'utf8'), data.cleaned.text);
    assert.equal(JSON.parse(await readFile(join(saved.path, 'sources.json'), 'utf8')).links[0].url, 'https://example.com/');
    assert.equal(JSON.parse(await readFile(join(saved.path, 'collection.json'), 'utf8')).items.length, 0);
    assert.equal((await save()).path, saved.path, 'repeat save uses the same folder');
    const missingSave = await nativeFetch(`http://127.0.0.1:${address.port}/save`, { method: 'POST', body: JSON.stringify({ comparisonId: '../../unknown' }) });
    assert.equal(missingSave.status, 404);
    const retained = await request(options, { localCleanup: true, skipCode: false });
    assert(retained.data.cleaned.text.includes('secretCode()'));
    const summaryWithOriginal = await request({ summary: true, excludeTags: ['nav'], includeTags: ['article'] }, { originalResponse: true });
    assert.equal(sent.length, 2);
    assert.equal(summaryWithOriginal.data.base.text, 'Summary result');
    assert.deepEqual(sent[1], { url: 'https://example.com', formats: ['markdown'], onlyMainContent: false });
    missing = true;
    const failed = await request({ onlyMainContent: true, summary: true });
    assert.equal(failed.status, 500);
    assert.match(failed.data.error, /did not return the requested summary/);
  } finally {
    globalThis.fetch = nativeFetch;
    await new Promise<void>(resolve => server.close(() => resolve()));
    if (saveRoot.startsWith(join(tmpdir(), 'crawlab-audit-'))) await rm(saveRoot, { recursive: true, force: true });
  }
});

test('image syntax does not inflate the inline link count', () => {
  assert.equal(stats('[link](url) ![image](image.png)').links, 1);
  assert.equal(stats('[link](url) ![image](image.png)').images, 1);
});

test('browser checkboxes reach the POST body, and result labels handle empty and larger outputs', async () => {
  const html = readFileSync('index.html', 'utf8');
  assert(!html.includes('id="omc"'));
  const elements: any = {};
  for (const id of ['f', 'go', 'msg', 'out', 'empty', 'url', 'sum', 'original-response', 'cex', 'inc', 'code', 'cleanup', 'save', 'save-panel', 'save-status', 'page-type', 'processing-summary', 'processing-info', 'processing-warnings', 'structured-data']) {
    elements[id] = { value: '', checked: false, children: [], append(c: any) { this.children.push(c); } };
  }
  elements.url.value = 'https://example.com';
  elements.cex.value = ' .sandpack, header, ';
  elements.inc.value = ' article, main ';
  let selected: string[] = [];
  let posted: any;
  const document = {
    getElementById: (id: string) => elements[id],
    querySelectorAll: () => selected.map(value => ({ value })),
    createElement: () => ({ innerHTML: '', querySelector: () => ({}), append() {} }),
  };
  const fixture: any = { base: { text: '', stats: stats('') }, cleaned: { text: 'More', stats: stats('More') } };
  const context = vm.createContext({ document, fetch: async (_url: string, init: any) => { posted = JSON.parse(init.body); return { json: async () => fixture }; } });
  vm.runInContext(html.match(/<script>([\s\S]*?)<\/script>/)![1], context);
  for (const value of [false, true]) {
    elements.sum.checked = value;
    elements['original-response'].checked = value;
    elements.cleanup.checked = value;
    elements.code.checked = true;
    elements.cleanup.onchange();
    assert.equal(elements.code.disabled, !value);
    for (const tag of ['nav', 'footer', 'button', 'aside']) {
      selected = [tag];
      await elements.f.onsubmit({ preventDefault() {} });
      assert.deepEqual(posted.options, { summary: value, excludeTags: [tag, '.sandpack', 'header'], includeTags: ['article', 'main'] });
      assert.equal(posted.localCleanup, value);
      assert.equal(posted.originalResponse, value);
      assert.equal(posted.skipCode, value);
    }
  }
  assert(elements.out.children.at(-1).innerHTML.includes('N/A (empty baseline)'));
  fixture.base.stats = stats('A');
  await elements.f.onsubmit({ preventDefault() {} });
  assert(elements.out.children.at(-1).innerHTML.includes('300% more characters'));
  fixture.base.stats = stats('More');
  await elements.f.onsubmit({ preventDefault() {} });
  assert(elements.out.children.at(-1).innerHTML.includes('Same character count'));
  elements['page-type'].value = 'collection';
  fixture.structured = processDocument('# Examples\n\n[An example article with a useful title](https://example.com/story)', { url: 'https://example.com/list', kind: 'collection' });
  fixture.coverage = compareCoverage(fixture.structured, fixture.structured);
  fixture.cleaned.localCleanup = true;
  await elements.f.onsubmit({ preventDefault() {} });
  assert.equal(posted.pageType, 'collection');
  assert.equal(elements['processing-summary'].hidden, false);
  assert(elements['processing-info'].textContent.includes('Type: collection'));
  assert(elements['structured-data'].textContent.includes('https://example.com/story'));
  assert(elements['processing-warnings'].children.length > 0);
  assert(elements.out.children.at(-1).innerHTML.includes('Collection output'));
  fixture.original = { text: 'Original', stats: stats('Original') };
  await elements.f.onsubmit({ preventDefault() {} });
  assert.equal(elements.out.className, 'grid with-original');
  assert(elements.out.children.at(-1).innerHTML.includes('Original response'));
  delete fixture.original;
  await elements.f.onsubmit({ preventDefault() {} });
  assert.equal(elements.out.className, 'grid');
  assert(elements.out.children.at(-1).innerHTML.includes('Collection output'));
});
