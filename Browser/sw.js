// ─────────────────────────────────────────────────────────────────────────
// HTMLTools Browser — proxy engine (service worker). v1.2
//
// Fast by design: streaming fetch, zero CORS preflights (?hd= trick),
// only HTML/CSS rewritten, everything else streams untouched, normal
// browser caching for subresources.
//
//   • Persistent cookie store (IndexedDB) with real Domain/Path/Expires/
//     Secure/HttpOnly semantics — logins survive restarts
//   • Runtime script served dynamically with KEY/PREFIX/BACKEND substituted
//     live, so WebSocket proxying always matches the current backend
//   • Backend URL can be set from the app (⚙ in the header) and persists
//     in IndexedDB — no config file editing needed
// ─────────────────────────────────────────────────────────────────────────
import { BACKEND, KEY } from './config.js';
import { encodeUrl, decodeUrl, b64urlEncode } from './encoder.js';
import { rewriteHtml, rewriteCss } from './rewrite.js';
import { makeStore, parseSetCookie } from './cookiestore.js';

const VERSION = 'v1.2.1';
const SCOPE = new URL(self.registration.scope).pathname; // '/' or '/browser/'
const ROOT = SCOPE.replace(/\/$/, ''); // '' or '/browser'
const RUNTIME_PATH = ROOT + '/~/__ht/runtime.js';
const COOKIES_PATH = ROOT + '/~/__ht/cookies';
const SYNC_PATH = ROOT + '/~/__ht/sync';

// runtime.js source. The build script replaces the marker below with the
// actual source (bundled single-file mode); in multi-file mode it stays
// null and install() fetches ./runtime.js instead.
let RUNTIME_SRC = /*__RUNTIME_SRC__*/null;

// ── cookie store + persistence (IndexedDB) ──────────────────────────────
const store = makeStore();
const pendingSet = new Map(); // origin → Set-Cookie strings for the page runtime

const dbP = new Promise((resolve) => {
  try {
    const req = indexedDB.open('htmltools-kv', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('kv');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
  } catch {
    resolve(null);
  }
});

function idbOp(mode, fn) {
  return dbP.then(
    (db) =>
      new Promise((resolve, reject) => {
        if (!db) return resolve();
        const tx = db.transaction('kv', mode);
        const out = fn(tx.objectStore('kv'));
        tx.oncomplete = () => resolve(out && out.result);
        tx.onerror = () => reject(tx.error);
      })
  );
}

let persistTimer = null;
function persistCookies() {
  clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    idbOp('readwrite', (s) => s.put(store.toJSON(), 'cookies')).catch(() => {});
  }, 250);
}

// Load persisted cookies at startup, before any request uses them.
const storeReady = idbOp('readonly', (s) => s.get('cookies'))
  .then((list) => {
    store.load(list);
  })
  .catch(() => {});

// Backend URL: config default → overridden by the saved value (⚙ setting).
let backend = BACKEND;
const backendReady = idbOp('readonly', (s) => s.get('backend'))
  .then((v) => {
    if (typeof v === 'string' && /^https?:\/\//.test(v)) backend = v.replace(/\/$/, '');
  })
  .catch(() => {});

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      if (!RUNTIME_SRC) {
        try { RUNTIME_SRC = await (await fetch('./runtime.js')).text(); } catch { RUNTIME_SRC = ''; }
      }
      const cache = await caches.open('htmltools-' + VERSION);
      for (const f of ['./', './index.html']) {
        try { await cache.add(f); } catch { /* optional */ }
      }
      await self.skipWaiting();
    })()
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== 'htmltools-' + VERSION).map((k) => caches.delete(k)));
      await self.clients.claim();
    })()
  );
});

// The app can set the backend at runtime (⚙ in the header / first-run box).
self.addEventListener('message', (event) => {
  const d = event.data || {};
  if (d.type === 'backend' && typeof d.url === 'string' && /^https?:\/\//.test(d.url)) {
    backend = d.url.replace(/\/$/, '');
    idbOp('readwrite', (s) => s.put(backend, 'backend')).catch(() => {});
  }
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'POST') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname === RUNTIME_PATH) {
    event.respondWith(serveRuntime());
    return;
  }
  if (url.pathname === COOKIES_PATH) {
    event.respondWith(handleCookiePush(req));
    return;
  }
  if (url.pathname === SYNC_PATH) {
    event.respondWith(handleCookieSync(url));
    return;
  }

  const target = decodeUrl(url.pathname);
  if (!target || !/^https?:/i.test(target)) return; // normal app traffic
  event.respondWith(
    handle(req, target).catch((err) => {
      console.error('[htmltools] engine error:', err);
      return new Response('HTMLTools engine error: ' + (err && err.message), {
        status: 502,
        headers: { 'content-type': 'text/plain; charset=utf-8' },
      });
    })
  );
});

// ── runtime script (served live with current settings) ──────────────────
async function serveRuntime() {
  await backendReady;
  const src = (RUNTIME_SRC || '')
    .replaceAll('__HT_KEY__', KEY)
    .replaceAll('__HT_PREFIX__', SCOPE)
    .replaceAll('__HT_BACKEND__', backend);
  return new Response(src, {
    headers: { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store' },
  });
}

// ── core proxy ───────────────────────────────────────────────────────────
async function handle(request, targetUrl) {
  await storeReady;
  await backendReady;
  let tURL;
  try { tURL = new URL(targetUrl); } catch {
    return new Response('bad target', { status: 400 });
  }

  // Headers we want upstream (sent inside ?hd= to avoid CORS preflights).
  const fwd = {};
  for (const h of ['accept', 'accept-language', 'range', 'content-type', 'user-agent']) {
    const v = request.headers.get(h);
    if (v) fwd[h] = v;
  }
  // Our own /~/ referer decodes into the real referer.
  const ref = request.headers.get('referer') || request.referrer || '';
  let decRef = null;
  if (ref) {
    try { decRef = decodeUrl(new URL(ref).pathname); } catch {}
  }
  fwd['referer'] = decRef && /^https?:/i.test(decRef) ? decRef : tURL.origin + '/';

  const cookie = store.forUrl(tURL);
  if (cookie) fwd['cookie'] = cookie;
  if (request.method !== 'GET' && request.method !== 'HEAD') fwd['origin'] = tURL.origin;

  // Keep the request CORS-simple: safelisted content-type or none in the
  // actual body headers; the REAL one travels inside ?hd=.
  const ct = fwd['content-type'];
  const bodyCT = ct && /^(text\/plain|application\/x-www-form-urlencoded|multipart\/form-data)/i.test(ct)
    ? ct
    : undefined;
  if (ct) fwd['content-type'] = ct;

  let resp;
  try {
    const init = { method: request.method, redirect: 'manual', cache: 'no-store' };
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      init.body = await request.arrayBuffer();
      init.headers = { 'content-type': bodyCT || 'text/plain;charset=UTF-8' };
    }
    resp = await fetch(backendUrl(targetUrl, fwd), init);
  } catch (err) {
    return new Response(
      'HTMLTools proxy backend unreachable: ' + backend + '\n\n' +
      'Open the app page and click ⚙ to check the backend URL.\n\n' + (err && err.message),
      { status: 502, headers: { 'content-type': 'text/plain; charset=utf-8' } }
    );
  }

  const status = parseInt(resp.headers.get('x-proxy-status') || '', 10) || resp.status;
  let meta = {};
  try { meta = JSON.parse(resp.headers.get('x-proxy-headers') || '{}'); } catch {}

  const setCookies = meta['set-cookie'] || [];
  if (setCookies.length) storeCookies(tURL.origin, setCookies);

  // Upstream redirect → synthetic redirect to the encoded location.
  if (meta.location && status >= 300 && status < 400) {
    try {
      const abs = new URL(meta.location, targetUrl).href;
      if (abs !== targetUrl) return respondRedirect(abs, status);
    } catch {}
  }

  const headers = new Headers();
  for (const h of ['content-type', 'content-range', 'accept-ranges', 'cache-control', 'etag', 'last-modified', 'expires', 'content-disposition', 'www-authenticate', 'vary']) {
    const v = meta[h];
    if (v) headers.set(h, Array.isArray(v) ? v.join(', ') : String(v));
  }

  const ctype = (meta['content-type'] || '').toLowerCase();
  const isHTML = ctype.includes('text/html') || ctype.includes('application/xhtml');
  const isCSS = ctype.includes('text/css');
  const isNav = request.mode === 'navigate' || request.destination === 'iframe';

  if (isHTML && isNav) {
    let html = await resp.text();
    html = rewriteHtml(html, targetUrl, (u) => encodeUrl(u, SCOPE));
    html = injectRuntime(html, targetUrl);
    headers.set('content-type', 'text/html; charset=utf-8');
    headers.set('cache-control', 'no-store');
    return new Response(html, { status, headers });
  }

  if (isCSS) {
    const css = rewriteCss(await resp.text(), targetUrl, (u) => encodeUrl(u, SCOPE));
    headers.set('content-type', ctype || 'text/css; charset=utf-8');
    return new Response(css, { status, headers });
  }

  // Everything else streams through raw — no buffering.
  // 204/205/304 answers legally have NO body — handing the browser a stream
  // (even an empty one) throws. Sites return these constantly when files
  // haven't changed, so getting this wrong breaks half the page.
  const noBody = status === 204 || status === 205 || status === 304;
  return new Response(noBody ? null : resp.body, { status, headers });
}

function backendUrl(targetUrl, fwd) {
  return (
    backend +
    '/proxy?url=' + encodeURIComponent(targetUrl) +
    '&hd=' + encodeURIComponent(b64urlEncode(JSON.stringify(fwd)))
  );
}

function respondRedirect(abs, status) {
  const code = [301, 302, 303, 307, 308].includes(status) ? status : 302;
  return Response.redirect(new URL(encodeUrl(abs, SCOPE), self.registration.scope).href, code);
}

// ── cookie engine ────────────────────────────────────────────────────────
function storeCookies(origin, setCookies) {
  const pending = pendingSet.get(origin) || [];
  for (const sc of setCookies) {
    const rec = parseSetCookie(sc, origin + '/');
    if (!rec) continue;
    store.set(rec);
    if (!rec.httpOnly) pending.push(rec.name + '=' + rec.value);
  }
  pendingSet.set(origin, pending.slice(-50));
  persistCookies();
}

async function handleCookiePush(req) {
  await storeReady;
  try {
    const { origin, cookie } = await req.json();
    if (origin && /^https?:/.test(origin) && typeof cookie === 'string') {
      for (const pair of cookie.split(';')) {
        const i = pair.indexOf('=');
        if (i > 0) store.setFromPage(origin, pair.slice(0, i).trim(), pair.slice(i + 1).trim());
      }
      persistCookies();
    }
  } catch {}
  return new Response(null, { status: 204 });
}

function handleCookieSync(url) {
  const origin = url.searchParams.get('o') || '';
  const pending = pendingSet.get(origin) || [];
  pendingSet.set(origin, []);
  return new Response(JSON.stringify({ setCookie: pending }), {
    headers: { 'content-type': 'application/json' },
  });
}

// ── runtime injection ────────────────────────────────────────────────────
function injectRuntime(html, targetUrl) {
  const tag =
    `<script>window.__HT_REAL_URL__=${JSON.stringify(targetUrl)};</script>` +
    `<script src="${RUNTIME_PATH}" data-real-url="${targetUrl.replace(/"/g, '&quot;')}"></script>`;
  if (/<head[^>]*>/i.test(html)) return html.replace(/<head[^>]*>/i, (m) => m + tag);
  if (/<html[^>]*>/i.test(html)) return html.replace(/<html[^>]*>/i, (m) => m + tag);
  return tag + html;
}
