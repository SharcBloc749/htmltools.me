import test from 'node:test';
import assert from 'node:assert/strict';
import { crawlSite, relevantPages } from '../src/crawl.mjs';
import { readFile } from 'node:fs/promises';

const text = async (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('SiloAI dashboard, widget, source Worker, and generated Worker are present', async () => {
  for (const path of ['../index.html', '../app.js', '../style.css', '../widget.js', '../worker.js', '../brandmark.svg', '../brandmark-v2.png', '../brandmark-mono.png', '../src/index.mjs', '../wrangler.toml']) {
    assert.ok((await text(path)).length > 0, `${path} should exist and not be empty`);
  }
  const widget = await text('../widget.js');
  const app = await text('../app.js');
  const styles = await text('../style.css');
  assert.match(styles, /--bg:#080808/);
  assert.match(styles, /--text:#f5f5f5/);
  assert.doesNotMatch(styles, /#(?:9681ed|b3a3ff|9b85f0|7863be)/i, 'the dashboard palette should stay grayscale');
  assert.match(app, /widget\.js\?v=5/);
  assert.match(widget, /SiloAI\/brandmark-mono\.png/);
  assert.match(widget, /widget\.js\?v=5/);
  assert.match(widget, /\.silo-fab img\{display:block;width:100%;height:100%/);
  assert.match(widget, /border-radius:14px/);
  assert.match(widget, /transform:none/);
  assert.match(widget, /background:#e5e5e5;color:#111111/);
  assert.doesNotMatch(widget, /#(?:7560ba|7862bd|8c99ff|9681ed)/i, 'the widget palette should stay grayscale');
  assert.deepEqual(await readFile(new URL('../brandmark-mono.png', import.meta.url)), await readFile(new URL('../../logo3.png', import.meta.url)), 'the SiloAI mark should match the actual HTMLTools logo');
  const wrangler = await text('../wrangler.toml');
  assert.match(wrangler, /name\s*=\s*"siloai"/);
  assert.match(wrangler, /binding\s*=\s*"AI"/);
  assert.match(wrangler, /class_name\s*=\s*"SiloLimiter"/);
  assert.doesNotMatch(wrangler, /GITHUB_TOKEN\s*=\s*"[A-Za-z0-9_]/);
});

test('SiloAI is deliberately not promoted in the Tools directory or sitemap', async () => {
  const directory = await readFile(new URL('../../Tools/index.html', import.meta.url), 'utf8');
  const sitemap = await readFile(new URL('../../sitemap1.xml', import.meta.url), 'utf8');
  assert.doesNotMatch(directory, /SiloAI/i);
  assert.doesNotMatch(sitemap, /SiloAI/i);
});


test('crawler seeds owner tool paths, follows same-host redirect hints, and avoids redirect placeholder profiles', async () => {
  const oldFetch = globalThis.fetch;
  const pages = {
    '/robots.txt': ['User-agent: *\nAllow: /', 'text/plain'],
    '/sitemap.xml': ['', 'application/xml'],
    '/': ['<html><head><title>Redirecting...</title><meta http-equiv="refresh" content="0; url=/landing"></head><body>Redirecting...</body></html>', 'text/html'],
    '/landing': ['<html><head><title>HTMLTools</title></head><body><h1>Tools</h1><script>window.location.replace("/final-destination")</script></body></html>', 'text/html'],
    '/final-destination': ['<html><head><title>HTMLTools Home</title></head><body><h1>Public tools</h1></body></html>', 'text/html'],
    '/HTML-Runner/': ['<html><head><title>HTML Runner</title></head><body><h1>Run HTML online</h1><a href="/HTML-Runner/Advanced">Advanced Runner</a></body></html>', 'text/html'],
    '/HTML-Runner/Advanced': ['<html><head><title>Advanced HTML Runner</title></head><body><h1>Advanced HTML Runner</h1><p>Run snippets with preview and console output.</p></body></html>', 'text/html'],
  };
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    const [body, type] = pages[url.pathname] || ['', 'text/html'];
    const status = pages[url.pathname] ? 200 : 404;
    return new Response(body, { status, headers: { 'content-type': type } });
  };
  try {
    const result = await crawlSite('example.com', [], ['/HTML-Runner/', '/HTML-Runner/Advanced']);
    const paths = result.pages.map((page) => page.path);
    assert.ok(paths.includes('/HTML-Runner/'), 'the exact owner-supplied group route should be crawled');
    assert.ok(paths.includes('/HTML-Runner/Advanced'), 'owner group paths should be seeds even if not linked from the homepage');
    assert.ok(paths.includes('/landing'), 'meta refresh destinations should be crawl hints');
    assert.ok(paths.includes('/final-destination'), 'same-host JavaScript location redirects should be crawl hints');
    assert.notEqual(result.profile.title, 'Redirecting...');
  } finally { globalThis.fetch = oldFetch; }
});

test('retrieval ranks the exact current route and its title above a query-heavy homepage, excluding redirect placeholders', () => {
  const pages = [
    { path: '/', title: 'Redirecting...', description: '', headings: [], text: 'Redirecting...' },
    { path: '/home', title: 'HTMLTools', description: 'HTML Runner tool', headings: [], text: 'HTML Runner is a popular tool. '.repeat(20) },
    { path: '/HTML-Runner/', title: 'HTML Runner', description: 'Run HTML snippets', headings: ['Live preview'], text: 'Execute and preview HTML with a console.' },
  ];
  const selected = relevantPages({ pages }, 'HTML Runner', '/HTML-Runner/', 'HTML Runner');
  assert.equal(selected[0].path, '/HTML-Runner/');
});
