import test from 'node:test';
import assert from 'node:assert/strict';
import { crawlSite, relevantPages } from '../src/crawl.mjs';
import { readFile } from 'node:fs/promises';

const text = async (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('SiloAI dashboard, widget, source Worker, and generated Worker are present', async () => {
  for (const path of ['../index.html', '../app.js', '../style.css', '../widget.js', '../worker.js', '../brandmark.svg', '../brandmark-v2.png', '../brandmark-mono.png', '../src/index.mjs', '../wrangler.toml', '../../_headers']) {
    assert.ok((await text(path)).length > 0, `${path} should exist and not be empty`);
  }
  const widget = await text('../widget.js');
  const app = await text('../app.js');
  const styles = await text('../style.css');
  const dashboard = await text('../index.html');
  assert.match(dashboard, /app\.js\?v=5/);
  assert.match(styles, /--bg:#080808/);
  assert.match(styles, /--text:#f5f5f5/);
  assert.doesNotMatch(styles, /#(?:9681ed|b3a3ff|9b85f0|7863be)/i, 'the dashboard palette should stay grayscale');
  assert.ok(app.includes('widget.js?v=5" data-site-id='));
  assert.match(widget, /widget\.js\?v=5/);
  assert.match(app, /data-ai-test/);
  assert.match(app, /\/ai-test/);
  assert.match(app, /data-allow-actions/);
  assert.match(widget, /data-resize-launcher/);
  assert.match(widget, /data-resize-panel/);
  assert.match(widget, /data-voice/);
  assert.match(widget, /data-image-file/);
  assert.match(widget, /localStorage/);
  assert.match(widget, /siloai\.conversations/);
  assert.match(widget, /SpeechRecognition/);
  assert.match(widget, /silo-panel-resize/);
  assert.match(app, /Allow page interactions/);
  assert.match(widget, /siloai-control-id/);
  assert.match(styles, /\.verified-actions/);
  const headers = await text('../../_headers');
  assert.match(headers, /\/SiloAI\/widget\.js[\s\S]*Cache-Control: public, max-age=0, must-revalidate/);
  assert.match(headers, /CDN-Cache-Control: no-cache/);
  assert.match(widget, /SiloAI\/brandmark-mono\.png/);
  assert.ok(widget.includes('widget.js?v=5" data-site-id='));
  assert.match(widget, /Website Assistant - Powered by HTMLTools\.me/);
  assert.match(widget, /Set up SiloAI on your site for free at htmltools\.me\/SiloAI!/);
  assert.match(widget, /Include current editor text/);
  assert.match(widget, /pageExcerpt: pageExcerpt/);
  assert.match(widget, /includeEditor\.checked \? currentEditorText\(\) : ''/);
  assert.match(widget, /widget\.js\?v=5/);
  assert.match(widget, /\.silo-fab img\{display:block;width:100%;height:100%/);
  assert.match(widget, /border-radius:14px/);
  assert.match(widget, /transform:none/);
  assert.match(widget, /background:#e5e5e5;color:#111111/);
  assert.doesNotMatch(widget, /#(?:7560ba|7862bd|8c99ff|9681ed)/i, 'the widget palette should stay grayscale');
  const logos = await Promise.all(['../brandmark-mono.png', '../../SiloAI.png', '../brandmark-v2.png'].map((path) => readFile(new URL(path, import.meta.url))));
  for (const logo of logos) assert.equal(logo.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', 'SiloAI brandmarks should be valid PNG files');
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
