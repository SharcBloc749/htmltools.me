import test from 'node:test';
import assert from 'node:assert/strict';
import { safeDomain, normalizePath, sha256 } from '../src/util.mjs';
import { crawlSite, isCrawlablePath, relevantPages, verifyDomainFile } from '../src/crawl.mjs';
import { writeSite, readSite } from '../src/github.mjs';
import { SiloLimiter } from '../src/limiter.mjs';
import { verifyFirebaseToken } from '../src/firebase.mjs';

const originalFetch = globalThis.fetch;
const setFetch = (handler) => { globalThis.fetch = handler; };
const restoreFetch = () => { globalThis.fetch = originalFetch; };
const htmlResponse = (html) => new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } });

test('domain and path validation reject insecure, malformed, and traversal inputs', () => {
  assert.equal(safeDomain('https://htmltools.eu.cc/Library/Studio'), 'htmltools.eu.cc');
  assert.equal(safeDomain('example.com'), 'example.com');
  assert.equal(safeDomain('http://example.com'), null);
  assert.equal(safeDomain('https://localhost'), null);
  assert.equal(safeDomain('https://127.0.0.1'), null);
  assert.equal(safeDomain('https://user:pass@example.com'), null);
  assert.equal(normalizePath('/Library/Studio'), '/Library/Studio');
  assert.equal(normalizePath('//evil.example'), null);
  assert.equal(isCrawlablePath('/Library/Studio/Upload'), true);
  assert.equal(isCrawlablePath('/account/settings'), false);
  assert.equal(isCrawlablePath('/images/logo.png'), false);
});

test('crawler follows same-host links and sitemap entries, extracts text, and skips scripts and external URLs', async () => {
  const routes = new Map([
    ['https://example.com/robots.txt', new Response('User-agent: *\nAllow: /', { headers: { 'content-type': 'text/plain' } })],
    ['https://example.com/sitemap.xml', new Response('<urlset><url><loc>https://example.com/Studio</loc></url><url><loc>https://outside.test/no</loc></url></urlset>', { headers: { 'content-type': 'application/xml' } })],
    ['https://example.com/', htmlResponse('<html><head><title>Home &amp; Tools</title><meta name="description" content="Tools directory"></head><body><h1>Welcome</h1><a href="/Library">Library</a><a href="https://elsewhere.test">Other</a><script>secretPrompt()</script></body></html>')],
    ['https://example.com/Library', htmlResponse('<title>Library</title><h1>Library</h1><a href="/Library/Studio/Upload">Create a book</a>')],
    ['https://example.com/Library/Studio/Upload', htmlResponse('<title>Upload</title><h1>Generate a book</h1><p>Upload a file to create a book with AI.</p>')],
    ['https://example.com/Studio', htmlResponse('<title>Studio</title><h1>Book studio</h1>')],
  ]);
  let robotsReads = 0;
  setFetch(async (url) => {
    if (String(url).endsWith('/robots.txt')) robotsReads++;
    return routes.get(String(url)) || new Response('not found', { status: 404, headers: { 'content-type': 'text/plain' } });
  });
  try {
    const result = await crawlSite('example.com');
    assert.equal(robotsReads, 1, 'robots.txt is fetched once per crawl');
    assert.equal(result.profile.title, 'Home & Tools');
    assert.ok(result.pages.length >= 3);
    assert.ok(result.pages.some((page) => page.path === '/Library/Studio/Upload'));
    const home = result.pages.find((page) => page.path === '/');
    assert.match(home.text, /Welcome/);
    assert.doesNotMatch(home.text, /secretPrompt/);
    assert.ok(!home.links.some((link) => link.includes('elsewhere')));
    const matches = relevantPages({ pages: result.pages }, 'generate a book with AI', '/Library');
    assert.equal(matches[0].path, '/Library', 'the exact current route is given priority');
    assert.ok(matches.some((page) => page.path === '/Library/Studio/Upload'), 'query-relevant pages remain in the retrieved context');
  } finally { restoreFetch(); }
});


test('crawler expands sitemap indexes and robots sitemap directives while using metadata titles', async () => {
  const routes = new Map([
    ['https://example.com/robots.txt', new Response('User-agent: *\nAllow: /\nSitemap: https://example.com/maps/index.xml', { headers: { 'content-type': 'text/plain' } })],
    ['https://example.com/sitemap.xml', new Response('not found', { status: 404, headers: { 'content-type': 'text/plain' } })],
    ['https://example.com/maps/index.xml', new Response('<sitemapindex><sitemap><loc>https://example.com/maps/one.xml</loc></sitemap><sitemap><loc>https://example.com/maps/two.xml</loc></sitemap></sitemapindex>', { headers: { 'content-type': 'application/xml' } })],
    ['https://example.com/maps/one.xml', new Response('<urlset><url><loc>https://example.com/Main/</loc></url><url><loc>https://example.com/HTML-Runner/</loc></url></urlset>', { headers: { 'content-type': 'application/xml' } })],
    ['https://example.com/maps/two.xml', new Response('<urlset><url><loc>https://example.com/meta-title</loc></url><url><loc>https://example.com/heading-title</loc></url></urlset>', { headers: { 'content-type': 'application/xml' } })],
    ['https://example.com/', htmlResponse('<title>Home</title><h1>Site home</h1>')],
    ['https://example.com/Main/', htmlResponse('<title>Main tools</title><h1>Main tools</h1>')],
    ['https://example.com/HTML-Runner/', htmlResponse('<title>Redirecting...</title><meta property="og:title" content="HTML Runner"><h1>Run HTML online</h1><p>Use the online runner.</p>')],
    ['https://example.com/meta-title', htmlResponse('<title>Loading...</title><meta name="title" content="Meta title fallback"><p>Page copy.</p>')],
    ['https://example.com/heading-title', htmlResponse('<h1>Heading title fallback</h1><p>Page copy.</p>')],
  ]);
  setFetch(async (url) => routes.get(String(url)) || new Response('not found', { status: 404, headers: { 'content-type': 'text/plain' } }));
  try {
    const result = await crawlSite('example.com');
    const byPath = new Map(result.pages.map((page) => [page.path, page]));
    assert.ok(byPath.has('/Main/'));
    assert.ok(byPath.has('/HTML-Runner/'));
    assert.equal(byPath.get('/HTML-Runner/').title, 'HTML Runner');
    assert.equal(byPath.get('/meta-title').title, 'Meta title fallback');
    assert.equal(byPath.get('/heading-title').title, 'Heading title fallback');
  } finally { restoreFetch(); }
});


test('an oversized page is skipped without stopping the rest of the crawl', async () => {
  const routes = new Map([
    ['https://example.com/robots.txt', new Response('User-agent: *\nAllow: /', { headers: { 'content-type': 'text/plain' } })],
    ['https://example.com/sitemap.xml', new Response('<urlset><url><loc>https://example.com/large</loc></url><url><loc>https://example.com/small</loc></url></urlset>', { headers: { 'content-type': 'application/xml' } })],
    ['https://example.com/', htmlResponse('<title>Home</title><h1>Home</h1>')],
    ['https://example.com/large', new Response('<title>Huge</title>', { headers: { 'content-type': 'text/html', 'content-length': '320001' } })],
    ['https://example.com/small', htmlResponse('<title>Small page</title><h1>Small page</h1><p>This should still be indexed.</p>')],
  ]);
  setFetch(async (url) => routes.get(String(url)) || new Response('not found', { status: 404, headers: { 'content-type': 'text/plain' } }));
  try {
    const result = await crawlSite('example.com');
    assert.ok(result.pages.some((page) => page.path === '/small'));
    assert.equal(result.pages.some((page) => page.path === '/large'), false);
    assert.equal(result.skippedLargePages, 1);
    assert.deepEqual(result.skippedLargePaths, ['/large']);
  } finally { restoreFetch(); }
});

test('robots.txt disallow blocks crawling and verification requires an exact token file', async () => {
  setFetch(async (url) => {
    if (String(url).endsWith('/robots.txt')) return new Response('User-agent: *\nDisallow: /', { headers: { 'content-type': 'text/plain' } });
    if (String(url).endsWith('/.well-known/siloai-verification.txt')) return new Response('siloai-verification=abc123', { headers: { 'content-type': 'text/plain' } });
    return htmlResponse('<title>Should not crawl</title>');
  });
  try {
    await assert.rejects(crawlSite('example.com'), { code: 'robots_disallow' });
    assert.equal(await verifyDomainFile('example.com', 'abc123'), true);
    assert.equal(await verifyDomainFile('example.com', 'wrong'), false);
  } finally { restoreFetch(); }
});

test('GitHub site JSON writes are versioned and subsequent reads use cache', async () => {
  const files = new Map();
  let calls = 0;
  setFetch(async (url, options = {}) => {
    calls++;
    const path = new URL(url).pathname;
    if (options.method === 'PUT') {
      const payload = JSON.parse(options.body);
      files.set(path, { content: payload.content, sha: 'sha-1' });
      return Response.json({ content: { sha: 'sha-1' } });
    }
    const file = files.get(path);
    if (!file) return Response.json({ message: 'Not Found' }, { status: 404 });
    return Response.json(file);
  });
  try {
    const record = { id: '0123456789abcdef01234567', domain: 'example.com', ownerUid: 'uid1', pages: [] };
    const env = { GITHUB_TOKEN: 'test-token', GITHUB_REPO: 'owner/private-db', GITHUB_DATA_PATH: 'SiloAI/sites', GITHUB_BRANCH: 'main' };
    await writeSite(env, record);
    const afterWrite = calls;
    assert.equal((await readSite(env, record.id)).domain, 'example.com');
    assert.equal(calls, afterWrite);
  } finally { restoreFetch(); }
});

class MemoryStorage {
  constructor() { this.values = new Map(); }
  async get(key) { return this.values.get(key); }
  async put(key, value) { this.values.set(key, value); }
  async delete(key) { this.values.delete(key); }
  async transaction(callback) { return callback(this); }
}

test('Durable Object limiter enforces per-IP and per-site short and daily caps', async () => {
  const limiter = new SiloLimiter({ storage: new MemoryStorage() });
  const originalNow = Date.now;
  const start = originalNow();
  let response;
  try {
    Date.now = () => start;
    for (let i = 0; i < 12; i++) response = await limiter.fetch(new Request('https://limiter/check', { method: 'POST', body: JSON.stringify({ bucket: 'ip:client-a' }) }));
    assert.equal(response.status, 200);
    response = await limiter.fetch(new Request('https://limiter/check', { method: 'POST', body: JSON.stringify({ bucket: 'ip:client-a' }) }));
    assert.equal(response.status, 429);
    for (let i = 0; i < 60; i++) response = await limiter.fetch(new Request('https://limiter/check', { method: 'POST', body: JSON.stringify({ bucket: 'site' }) }));
    assert.equal(response.status, 200);
    response = await limiter.fetch(new Request('https://limiter/check', { method: 'POST', body: JSON.stringify({ bucket: 'site' }) }));
    assert.equal(response.status, 429);
    for (let i = 0; i < 100; i++) response = await limiter.fetch(new Request('https://limiter/crawl-check', { method: 'POST', body: JSON.stringify({ bucket: 'crawl-global' }) }));
    assert.equal(response.status, 200);
    response = await limiter.fetch(new Request('https://limiter/crawl-check', { method: 'POST', body: JSON.stringify({ bucket: 'crawl-global' }) }));
    assert.equal(response.status, 429);
    for (let i = 0; i < 500; i++) {
      Date.now = () => start + Math.floor(i / 100) * 60_000;
      response = await limiter.fetch(new Request('https://limiter/check', { method: 'POST', body: JSON.stringify({ bucket: 'global' }) }));
    }
    assert.equal(response.status, 200);
    Date.now = () => start + 5 * 60_000;
    response = await limiter.fetch(new Request('https://limiter/check', { method: 'POST', body: JSON.stringify({ bucket: 'global' }) }));
    assert.equal(response.status, 429);
  } finally { Date.now = originalNow; }
});

test('Firebase ID tokens require a valid signature, project audience, and expiry', async () => {
  const pair = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  const jwk = await crypto.subtle.exportKey('jwk', pair.publicKey);
  jwk.kid = 'test-key';
  const b64 = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const header = b64({ alg: 'RS256', kid: 'test-key', typ: 'JWT' });
  const payload = b64({ aud: 'demo-firebase', iss: 'https://securetoken.google.com/demo-firebase', sub: 'uid-123', iat: now, exp: now + 3600 });
  const bytes = new TextEncoder().encode(header + '.' + payload);
  const signature = Buffer.from(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', pair.privateKey, bytes)).toString('base64url');
  const token = `${header}.${payload}.${signature}`;
  const fetchMock = async () => Response.json({ keys: [jwk] }, { headers: { 'cache-control': 'max-age=300' } });
  assert.equal((await verifyFirebaseToken(token, 'demo-firebase', fetchMock)).uid, 'uid-123');
  await assert.rejects(verifyFirebaseToken(token, 'wrong-project', fetchMock), { code: 'unauthorized' });
});

test('sha256 IDs are stable and fixed length', async () => {
  assert.equal(await sha256('example.com'), await sha256('example.com'));
  assert.equal((await sha256('example.com')).length, 64);
});
