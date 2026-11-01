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
  assert.match(dashboard, /app\.js\?v=10/);
  assert.match(styles, /--bg:#080808/);
  assert.match(styles, /--text:#f5f5f5/);
  assert.doesNotMatch(styles, /#(?:9681ed|b3a3ff|9b85f0|7863be)/i, 'the dashboard palette should stay grayscale');
  assert.ok(app.includes("widget.js'"), 'the dashboard hands out an unversioned embed URL');
  assert.doesNotMatch(app, /widget\.js\?v=\d/, 'owners never have to edit their snippet after an update');
  assert.match(app, /data-ai-test/);
  assert.match(app, /\/ai-test/);
  assert.match(app, /data-allow-actions/);
  assert.doesNotMatch(widget, /data-resize-launcher/, 'the launcher keeps a fixed size and is drag-only');
  assert.match(widget, /data-resize-panel/);
  assert.match(widget, /data-drag-handle/, 'the chat window itself can be dragged');
  assert.match(widget, /silo-panel-resize/);
  assert.match(widget, /data-voice/);
  assert.match(widget, /data-image-file/);
  assert.match(widget, /localStorage/);
  assert.match(widget, /siloai\.conversations/);
  assert.match(widget, /SpeechRecognition/);
  assert.match(widget, /data-siloai-highlight/, 'highlights are drawn on the page');
  assert.doesNotMatch(widget, /Each question sends up to 2\.5 KB/, 'the privacy footnote under the composer is gone');
  assert.match(widget, /window\.SiloAI\.inspect/, 'owners can inspect which controls the widget can reach');
  assert.match(widget, /silo-version/, 'the running widget version is shown in the chat window corner');
  assert.match(widget, /renderRichText/, 'markdown replies are rendered instead of showing raw asterisks');
  assert.match(widget, /LABEL_EDGE|cleanLabel/, 'decorative glyphs are stripped from control labels');
  assert.match(widget, /explicitButtonType/, 'only author-declared submit/reset buttons are withheld');
  assert.match(widget, /pageDocuments/, 'same-origin frames are scanned for controls');
  assert.match(widget, /shadowRoot/, 'controls inside open shadow roots are scanned');
  assert.match(widget, /type === 'edit'/);
  assert.match(app, /Allow page interactions/);
  assert.match(widget, /collectPageTargets/);
  assert.match(styles, /\.verified-actions/);
  const headers = await text('../../_headers');
  assert.match(headers, /\/SiloAI\/widget\.js[\s\S]*Cache-Control: public, max-age=0, must-revalidate/);
  assert.match(headers, /CDN-Cache-Control: no-cache/);
  assert.match(widget, /SiloAI\/brandmark-mono\.png/);
  assert.match(widget, /data-site-id/, 'the embed snippet still carries the site id');
  assert.match(widget, /Website assistant by HTMLTools\.me/);
  assert.match(widget, /Set up SiloAI on your site for free at htmltools\.me\/SiloAI!/);
  assert.doesNotMatch(widget, /Include current editor text/, 'the editor opt-in checkbox is gone');
  assert.doesNotMatch(widget, /editorText/, 'the widget never reads or sends editor text');
  assert.match(widget, /pageExcerpt: pageExcerpt/);
  assert.match(widget, /\.silo-fab img\{display:block;width:100%;height:100%/);
  assert.match(widget, /border-radius:14px/);
  assert.match(widget, /transform:none/);
  assert.match(widget, /\.silo-send\{background:#ededed;color:#0d0d0d/);
  assert.match(widget, /data-voice/);
  assert.match(widget, /data-attach/);
  assert.doesNotMatch(widget, /#(?:7560ba|7862bd|8c99ff|9681ed)/i, 'the widget palette should stay grayscale');
  const logos = await Promise.all(['../brandmark-mono.png', '../../SiloAI.png', '../brandmark-v2.png'].map((path) => readFile(new URL(path, import.meta.url))));
  for (const logo of logos) assert.equal(logo.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', 'SiloAI brandmarks should be valid PNG files');
  const wrangler = await text('../wrangler.toml');
  assert.match(wrangler, /name\s*=\s*"siloai"/);
  assert.match(wrangler, /binding\s*=\s*"AI"/);
  assert.match(wrangler, /class_name\s*=\s*"SiloLimiter"/);
  assert.doesNotMatch(wrangler, /GITHUB_TOKEN\s*=\s*"[A-Za-z0-9_]/);
});

const SITE_ID = '30268100ff25914e5289a440';

const EMBEDDED_PAGES = [
  'index.html',
  'Tools/index.html',
  'Main/index.html',
  'Library/index.html',
  'Library/Studio/index.html',
  'Library/Studio/Upload/index.html',
  'AI-Playground/index.html',
  'AI-Playground/Chat/index.html',
  'Advanced/index.html',
  'Advanced/Download/index.html',
  'Art/index.html',
  'Art/Create/index.html',
  'Art/Museum/index.html',
  'Art/Upload/index.html',
  'Browser/index.html',
  'ImageEditorAI/index.html',
  'ImageGeneratorAI/index.html',
  'MatTok/index.html',
  'Meet/index.html',
  'Research/index.html',
  'SiloAI/index.html',
  'website-encryption/index.html',
];

test('every HTMLTools page carries exactly one SiloAI embed, and Library/book stays clean', async () => {
  const embed = new RegExp(`<script async src="https://htmltools\\.me/SiloAI/widget\\.js" data-site-id="${SITE_ID}"></script>`);
  for (const path of EMBEDDED_PAGES) {
    const page = await readFile(new URL(`../../${path}`, import.meta.url), 'utf8');
    const matches = page.match(/https:\/\/htmltools\.me\/SiloAI\/widget\.js/g) || [];
    assert.equal(matches.length, 1, `${path} loads the widget exactly once`);
    assert.match(page, embed, `${path} uses the htmltools.me site id`);
    assert.match(page, /data-site-id="30268100ff25914e5289a440"><\/script>\s*<\/body>/, `${path} embeds the widget as the last thing in the body`);
    assert.doesNotMatch(page, /widget\.js\?v=/, `${path} never cache-busts the embed URL`);
  }
  const book = await readFile(new URL('../../Library/book/index.html', import.meta.url), 'utf8');
  assert.doesNotMatch(book, /SiloAI\/widget\.js/, 'the book reader keeps its own page clean');
});

test('SiloAI is listed under the featured tool on the home page and the Tools directory', async () => {
  for (const path of ['../../index.html', '../../Tools/index.html']) {
    const directory = await readFile(new URL(path, import.meta.url), 'utf8');
    const start = directory.indexOf('const tools = [');
    const featured = directory.indexOf('id: "htmltools-browser"', start);
    const silo = directory.indexOf('id: "siloai"', featured);
    const next = directory.indexOf('id: "', featured + 1);
    assert.ok(featured > -1 && silo > -1, `${path} lists SiloAI`);
    assert.equal(silo, next, `${path} places SiloAI directly under the featured tool`);
    const entry = directory.slice(silo, directory.indexOf('\n      },', silo));
    assert.match(entry, /url: "https:\/\/htmltools\.me\/SiloAI"/, `${path} links to the SiloAI page`);
    assert.match(entry, /img: "https:\/\/htmltools\.me\/SiloAI\/brandmark-mono\.png"/, `${path} uses the SiloAI logo`);
  }
  const sitemap = await readFile(new URL('../../sitemap1.xml', import.meta.url), 'utf8');
  assert.match(sitemap, /<loc>https:\/\/htmltools\.me\/SiloAI\/<\/loc>/);
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
