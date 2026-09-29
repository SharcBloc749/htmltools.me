// HTMLTools Browser — engine (auto-built single file)
const BACKEND = "https://htmltools-browser-nqv1xw3k6rph.htmltools-browser.deno.net";
const KEY = "htmltools-change-me-9f2k";
const SEARCH = 'https://duckduckgo.com/?q=';
// HTMLTools Browser — URL codec.
// A proxied URL looks like:  <prefix>~/<base64url(xor-scrambled URL)>
// Example (site root):       /~/aHR0cHM6...  (well, scrambled, not plain b64)
// The XOR keeps the encoding compact and hides the destination from casual
// URL inspection. The service worker decodes it before calling the backend.


function xorStr(s) {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    out += String.fromCharCode(s.charCodeAt(i) ^ KEY.charCodeAt(i % KEY.length));
  }
  return out;
}

function b64urlEncode(s) {
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(s) {
  let b = s.replace(/-/g, '+').replace(/_/g, '/');
  while (b.length % 4) b += '=';
  return atob(b);
}

/**
 * Encode an absolute http(s) URL into a proxied path.
 * @param {string} url    absolute URL, e.g. https://example.com/page
 * @param {string} prefix base path of the app, e.g. '/' or '/browser/'
 */
function encodeUrl(url, prefix = '/') {
  const p = prefix.endsWith('/') ? prefix : prefix + '/';
  return p + '~/' + b64urlEncode(xorStr(encodeURIComponent(url)));
}

/**
 * Decode a proxied path back into the target URL.
 * Tolerates any prefix; returns null for non-proxied paths.
 */
function decodeUrl(part) {
  const i = part.indexOf('~/');
  if (i === -1) return null;
  let tail = part.slice(i + 2);
  if (!tail) return null;
  try {
    return decodeURIComponent(xorStr(b64urlDecode(tail)));
  } catch {
    return null;
  }
}

// HTMLTools Browser — HTML/CSS URL rewriter.
// Pure string functions (no DOM) so they run in the service worker AND in
// Node for testing. Regex-based on purpose: fast, zero dependencies.
// Roadmap: streaming rewriter so huge pages never buffer fully.

const SKIP_RE = /^(#|data:|blob:|about:|mailto:|tel:|sms:|javascript:|file:|cid:|intent:|ws:|wss:|ftp:)/i;

/** Resolve any href/src-ish value against the page URL and encode it, or
 *  return it untouched when it's not proxiable. */
function proxify(value, base, encode) {
  if (typeof value !== 'string') return value;
  const v = value.trim();
  if (!v || SKIP_RE.test(v)) return value;
  try {
    const abs = new URL(v, base);
    if (abs.protocol !== 'http:' && abs.protocol !== 'https:') return value;
    return encode(abs.href);
  } catch {
    return value;
  }
}

function rewriteSrcset(value, base, encode) {
  return value
    .split(',')
    .map((part) => {
      const t = part.trim();
      if (!t) return part;
      const m = t.match(/^(\S+)(\s+.+)?$/);
      if (!m) return part;
      return proxify(m[1], base, encode) + (m[2] || '');
    })
    .join(', ');
}

const ATTRS =
  'href|src|action|formaction|poster|background|cite|longdesc|data-src|data-href|data-url|data-poster';

/** Rewrite every proxiable URL inside an HTML document. */
function rewriteHtml(html, baseUrl, encode) {
  // 0. Strip page defenses that would block rewritten resources:
  //    - CSP meta tags (they allowlist the site's own domains → our /~/
  //      URLs get treated as foreign and CSS/JS/images get blocked)
  //    - integrity (SRI) hashes (our rewritten CSS no longer matches them)
  //    - nonce attributes (meaningless once CSP is gone)
  html = html.replace(
    /<meta\s[^>]*http-equiv\s*=\s*["']?content-security-policy["']?[^>]*>/gi,
    ''
  );
  html = html.replace(
    /\s(?:integrity|nonce)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi,
    ''
  );

  // Honor <base href> if the page declares one.
  let base = baseUrl;
  const baseTag = html.match(/<base\s[^>]*href\s*=\s*["']([^"']+)["']/i);
  if (baseTag) {
    try {
      base = new URL(baseTag[1], baseUrl).href;
    } catch {}
  }

  // 1. Standard URL attributes (double + single + unquoted values).
  const attrRe = new RegExp(
    `(\\s(href|src|action|formaction|poster|background|cite|longdesc|data-src|data-href|data-url|data-poster|srcset|imagesrcset)\\s*=\\s*)("([^"]*)"|'([^']*)'|([^\\s>]+))`,
    'gi'
  );
  html = html.replace(attrRe, (m, eq, name, _q, dq, sq, uq) => {
    const raw = dq !== undefined ? dq : sq !== undefined ? sq : uq;
    const done = /srcset/i.test(name) ? rewriteSrcset(raw, base, encode) : proxify(raw, base, encode);
    return eq + '"' + String(done ?? '').replace(/"/g, '&quot;') + '"';
  });

  // 2. Inline style="..." attributes.
  html = html.replace(/(\sstyle\s*=\s*")([^"]*)(")/gi, (m, a, css, z) =>
    a + rewriteCss(css, base, encode) + z
  );

  // 3. <style> blocks.
  html = html.replace(/(<style\b[^>]*>)([\s\S]*?)(<\/style\s*>)/gi, (m, open, css, close) =>
    open + rewriteCss(css, base, encode) + close
  );

  // 4. <meta http-equiv="refresh" content="5; url=...">
  html = html.replace(
    /(<meta\s[^>]*http-equiv\s*=\s*["']?refresh["']?[^>]*?content\s*=\s*["']?)([^"'>]+)/gi,
    (m, pre, content) => {
      const out = content.replace(/(url\s*=\s*)(\S+)/i, (mm, u, target) => {
        const t = target.replace(/^['"]|['"]$/g, '');
        return u + proxify(t, base, encode);
      });
      return pre + out;
    }
  );

  return html;
}

/** Rewrite url(...) and @import inside CSS. */
function rewriteCss(css, base, encode) {
  return css
    .replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi, (m, q, u) => {
      const done = proxify(u, base, encode);
      return `url("${String(done).replace(/"/g, '%22')}")`;
    })
    .replace(/@import\s+(['"])([^'"]+)\1/gi, (m, q, u) => {
      return `@import "${String(proxify(u, base, encode)).replace(/"/g, '%22')}"`;
    });
}

// ─────────────────────────────────────────────────────────────────────────
// HTMLTools Browser — cookie store (RFC 6265-lite, Chrome-flavored).
// Pure module: runs in the service worker AND in Node for tests.
//
// Emulates what matters for logins:
//   • Domain attribute (host-only vs domain cookies, suffix matching)
//   • Path attribute + RFC default-path + path matching
//   • Expires / Max-Age (expired cookies vanish; no attrs = session cookie)
//   • Secure flag (only sent over https)
//   • HttpOnly flag (sent upstream in requests, hidden from document.cookie)
// ─────────────────────────────────────────────────────────────────────────

/** RFC 6265 §5.1.4 default-path */
function defaultPath(pathname) {
  if (!pathname || pathname[0] !== '/') return '/';
  const i = pathname.lastIndexOf('/');
  return i === 0 ? '/' : pathname.slice(0, i);
}

/** Domain matching: exact host, or host is a subdomain of cookieDomain. */
function domainMatch(host, cookieDomain) {
  host = host.toLowerCase();
  cookieDomain = String(cookieDomain).toLowerCase().replace(/^\./, '');
  return host === cookieDomain || host.endsWith('.' + cookieDomain);
}

/** RFC 6265 §5.1.4 path-match */
function pathMatch(path, cookiePath) {
  if (!path) path = '/';
  if (path === cookiePath) return true;
  if (path.startsWith(cookiePath)) {
    if (cookiePath.endsWith('/')) return true;
    if (path[cookiePath.length] === '/') return true;
  }
  return false;
}

function parseDate(s) {
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : t;
}

/**
 * Parse one Set-Cookie header value in the context of a request URL.
 * Returns a cookie record or null (rejected/invalid).
 */
function parseSetCookie(setCookieValue, requestUrl) {
  let url;
  try { url = new URL(requestUrl); } catch { return null; }
  const str = String(setCookieValue).trim();
  if (!str) return null;

  const firstSemi = str.indexOf(';');
  const nv = firstSemi === -1 ? str : str.slice(0, firstSemi);
  const eq = nv.indexOf('=');
  if (eq < 1) return null; // no name=value → ignore (per RFC)
  const name = nv.slice(0, eq).trim();
  const value = nv.slice(eq + 1).trim();
  if (!name) return null;

  const attrs = firstSemi === -1 ? [] : str.slice(firstSemi + 1).split(';');
  let domain = url.hostname.toLowerCase();
  let hostOnly = true;
  let path = null;
  let expiresTs = null;
  let secure = false;
  let httpOnly = false;
  let sameSite = 'Lax';

  for (const raw of attrs) {
    const i = raw.indexOf('=');
    const key = (i === -1 ? raw : raw.slice(0, i)).trim().toLowerCase();
    const val = i === -1 ? '' : raw.slice(i + 1).trim();
    if (key === 'domain') {
      if (val) {
        domain = val.toLowerCase().replace(/^\./, '');
        hostOnly = false;
      }
    } else if (key === 'path') {
      path = val || null;
    } else if (key === 'expires') {
      const t = parseDate(val);
      if (t !== null) expiresTs = t;
    } else if (key === 'max-age') {
      const n = parseInt(val, 10);
      if (!Number.isNaN(n)) {
        if (n <= 0) expiresTs = 0; // expired
        else expiresTs = Date.now() + n * 1000;
      }
    } else if (key === 'secure') {
      secure = true;
    } else if (key === 'httponly') {
      httpOnly = true;
    } else if (key === 'samesite') {
      sameSite = /^(strict|lax|none)$/i.test(val) ? val.toLowerCase() : 'Lax';
    }
  }

  // Domain attribute must match the request host, else the cookie is rejected.
  if (!hostOnly && !domainMatch(url.hostname, domain)) return null;

  // Secure cookies may only be set over https (Chrome-enforced).
  if (secure && url.protocol !== 'https:') return null;

  return {
    name,
    value,
    domain,
    hostOnly,
    path: path || defaultPath(url.pathname),
    expiresTs,
    secure,
    httpOnly,
    sameSite,
    createdAt: Date.now(),
  };
}

/** Cookie identity: same name+domain+path replaces. */
function keyOf(c) {
  return c.name + '|' + (c.hostOnly ? '' : '.') + c.domain + '|' + c.path;
}

function makeStore() {
  // insertion-ordered Map = creation order for the RFC sort tiebreak
  const cookies = new Map();

  function prune() {
    const now = Date.now();
    for (const [k, c] of cookies) {
      if (c.expiresTs !== null && c.expiresTs <= now) cookies.delete(k);
    }
  }

  return {
    set(record) {
      if (!record) return;
      cookies.delete(keyOf(record)); // re-insert → newest creation time wins
      cookies.set(keyOf(record), record);
      // Soft caps, like a browser would enforce
      if (cookies.size > 5000) {
        const oldest = cookies.keys().next().value;
        cookies.delete(oldest);
      }
    },
    get count() {
      prune();
      return cookies.size;
    },
    /** Cookie header value to send to this URL (already RFC-sorted). */
    forUrl(url) {
      prune();
      let u;
      try { u = url instanceof URL ? url : new URL(url); } catch { return ''; }
      const host = u.hostname.toLowerCase();
      const isSecure = u.protocol === 'https:';
      const list = [];
      for (const c of cookies.values()) {
        if (c.hostOnly ? host !== c.domain : !domainMatch(host, c.domain)) continue;
        if (!pathMatch(u.pathname, c.path)) continue;
        if (c.secure && !isSecure) continue;
        list.push(c);
      }
      list.sort((a, b) => b.path.length - a.path.length); // longer paths first
      return list.map((c) => c.name + '=' + c.value).join('; ');
    },
    /** Cookies visible to page JS (document.cookie) for this URL. */
    forUrlVisible(url) {
      return this.forUrl(url)
        .split('; ')
        .filter((pair) => {
          const name = pair.slice(0, pair.indexOf('='));
          const c = this._find(url, name);
          return c && !c.httpOnly;
        })
        .join('; ');
    },
    _find(url, name) {
      let u;
      try { u = url instanceof URL ? url : new URL(url); } catch { return null; }
      prune();
      for (const c of cookies.values()) {
        if (c.name !== name) continue;
        const host = u.hostname.toLowerCase();
        if (c.hostOnly ? host !== c.domain : !domainMatch(host, c.domain)) continue;
        if (!pathMatch(u.pathname, c.path)) continue;
        return c;
      }
      return null;
    },
    /** Add a plain 'name=value' pair (set by page JS via document.cookie). */
    setFromPage(origin, name, value) {
      try {
        const u = new URL(origin);
        this.set(parseSetCookie(name + '=' + value, u.origin + '/'));
      } catch {}
    },
    toJSON() {
      prune();
      return [...cookies.values()];
    },
    load(list) {
      if (!Array.isArray(list)) return;
      for (const c of list) {
        if (c && c.name && c.domain && typeof c.value === 'string') {
          cookies.set(keyOf(c), c);
        }
      }
      prune();
    },
    clear() {
      cookies.clear();
    },
  };
}

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





const VERSION = 'v1.2.0';
const SCOPE = new URL(self.registration.scope).pathname; // '/' or '/browser/'
const ROOT = SCOPE.replace(/\/$/, ''); // '' or '/browser'
const RUNTIME_PATH = ROOT + '/~/__ht/runtime.js';
const COOKIES_PATH = ROOT + '/~/__ht/cookies';
const SYNC_PATH = ROOT + '/~/__ht/sync';

// runtime.js source. The build script replaces the marker below with the
// actual source (bundled single-file mode); in multi-file mode it stays
// null and install() fetches ./runtime.js instead.
let RUNTIME_SRC = "// ─────────────────────────────────────────────────────────────────────────\n// HTMLTools Browser — page runtime (injected into every proxied page). v1.1\n//\n// Teaches proxied pages our URL scheme and makes them behave like they run\n// on their real origin, the way a real browser would:\n//   fetch / XHR / WebSocket / EventSource / sendBeacon / Worker /\n//   window.open / links / forms / history / dynamic DOM\n//   document.cookie (per real origin, HttpOnly-aware)\n//   localStorage + sessionStorage (per real origin, namespaced)\n//\n// __HT_KEY__ / __HT_PREFIX__ / __HT_BACKEND__ are replaced by the service\n// worker at install time, so this always matches the engine.\n// ─────────────────────────────────────────────────────────────────────────\n(function () {\n  if (window.__htmltools) return;\n  window.__htmltools = true;\n\n  var KEY = '__HT_KEY__';\n  var PREFIX = '__HT_PREFIX__';\n  var BACKEND = '__HT_BACKEND__';\n  var WS_BACKEND = BACKEND.replace(/^http/i, 'ws');\n\n  // The real URL of this page (injected just before this script loads).\n  var REAL_URL =\n    (document.currentScript && document.currentScript.getAttribute('data-real-url')) ||\n    window.__HT_REAL_URL__ ||\n    ('https://' + location.hostname + '/');\n\n  function xorStr(s) {\n    var out = '';\n    for (var i = 0; i < s.length; i++) {\n      out += String.fromCharCode(s.charCodeAt(i) ^ KEY.charCodeAt(i % KEY.length));\n    }\n    return out;\n  }\n  function b64url(s) {\n    return btoa(s).replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=+$/, '');\n  }\n  function unb64url(s) {\n    var b = s.replace(/-/g, '+').replace(/_/g, '/');\n    while (b.length % 4) b += '=';\n    return atob(b);\n  }\n  function toProxy(abs) {\n    if (!/^https?:/i.test(abs)) return abs;\n    return PREFIX + '~/' + b64url(xorStr(encodeURIComponent(abs)));\n  }\n  function resolve(u) {\n    try {\n      return new URL(String(u), REAL_URL).href;\n    } catch (e) {\n      return String(u);\n    }\n  }\n  var SKIP = /^(#|data:|blob:|about:|mailto:|tel:|sms:|javascript:)/i;\n  function px(u) {\n    var v = String(u);\n    if (!v || SKIP.test(v.trim())) return u;\n    var abs = resolve(v);\n    return toProxy(abs);\n  }\n\n  var realOrigin;\n  try { realOrigin = new URL(REAL_URL).origin; } catch (e) { realOrigin = 'https://example.com'; }\n\n  // ── 1. fetch ───────────────────────────────────────────────────────────\n  var _fetch = window.fetch;\n  window.fetch = function (input, init) {\n    try {\n      if (typeof input === 'string' || input instanceof URL) input = px(String(input));\n      else if (input && input.url) input = new Request(px(input.url), input);\n    } catch (e) {}\n    return _fetch.call(this, input, init);\n  };\n\n  // ── 2. XMLHttpRequest ──────────────────────────────────────────────────\n  var _open = XMLHttpRequest.prototype.open;\n  XMLHttpRequest.prototype.open = function (method, url) {\n    var rest = Array.prototype.slice.call(arguments, 2);\n    return _open.apply(this, [method, px(url)].concat(rest));\n  };\n\n  // ── 3. window.open ─────────────────────────────────────────────────────\n  var _wopen = window.open;\n  window.open = function (u, name, feats) {\n    try { if (u != null) u = toProxy(resolve(u)); } catch (e) {}\n    return _wopen.call(this, u, name, feats);\n  };\n\n  // ── 4. history API ─────────────────────────────────────────────────────\n  try {\n    var _push = history.pushState, _replace = history.replaceState;\n    history.pushState = function (s, t, u) {\n      return _push.call(history, s, t, u == null ? u : toProxy(resolve(u)));\n    };\n    history.replaceState = function (s, t, u) {\n      return _replace.call(history, s, t, u == null ? u : toProxy(resolve(u)));\n    };\n  } catch (e) {}\n\n  // ── 5. links + forms (capture phase, before the page can react) ────────\n  document.addEventListener(\n    'click',\n    function (e) {\n      var a = e.target && e.target.closest ? e.target.closest('a[href]') : null;\n      if (!a) return;\n      var href = a.getAttribute('href');\n      if (!href || href.charAt(0) === '#' || /^javascript:/i.test(href)) return;\n      var abs = resolve(href);\n      if (!/^https?:/i.test(abs)) return;\n      e.preventDefault();\n      if (a.target === '_blank' || e.metaKey || e.ctrlKey || e.button === 1) {\n        _wopen.call(window, toProxy(abs), '_blank');\n      } else {\n        location.href = toProxy(abs);\n      }\n    },\n    true\n  );\n  document.addEventListener(\n    'submit',\n    function (e) {\n      var f = e.target;\n      if (!f || !f.getAttribute) return;\n      var action = f.getAttribute('action');\n      var abs = resolve(action || REAL_URL);\n      if (/^https?:/i.test(abs)) f.setAttribute('action', toProxy(abs));\n    },\n    true\n  );\n\n  // ── 6. document.cookie emulation (per real origin) ─────────────────────\n  var JAR_KEY = 'ht-jar:' + realOrigin;\n  function jarGet() {\n    try { return sessionStorage.getItem(JAR_KEY) || ''; } catch (e) { return ''; }\n  }\n  function jarSet(s) {\n    try { sessionStorage.setItem(JAR_KEY, s); } catch (e) {}\n    pushCookies(s);\n  }\n  function jarMap(str) {\n    var m = {}, parts = (str || '').split(';');\n    for (var i = 0; i < parts.length; i++) {\n      var p = parts[i], idx = p.indexOf('=');\n      if (idx > 0) m[p.slice(0, idx).trim()] = p.slice(idx + 1).trim();\n    }\n    return m;\n  }\n  function jarString(m) {\n    var out = [];\n    for (var k in m) out.push(k + '=' + m[k]);\n    return out.join('; ');\n  }\n  try {\n    Object.defineProperty(document, 'cookie', {\n      configurable: true,\n      get: function () { return jarGet(); },\n      set: function (v) {\n        v = String(v);\n        var eq = v.indexOf('=');\n        if (eq < 1) return;\n        var name = v.slice(0, eq).trim();\n        var value = v.slice(eq + 1).split(';')[0];\n        var expired = /expires=thu, 01 jan 1970|max-age=0/i.test(v) || value === '';\n        var m = jarMap(jarGet());\n        if (expired) delete m[name]; else m[name] = value;\n        jarSet(jarString(m));\n      },\n    });\n  } catch (e) {}\n\n  function pushCookies(cookie) {\n    try {\n      _fetch(PREFIX + '~/__ht/cookies', {\n        method: 'POST',\n        headers: { 'content-type': 'application/json' },\n        body: JSON.stringify({ origin: realOrigin, cookie: cookie }),\n      });\n    } catch (e) {}\n  }\n\n  // Boot: pull upstream Set-Cookie the SW saved (non-HttpOnly only) → jar.\n  (function syncCookies() {\n    _fetch(PREFIX + '~/__ht/sync?o=' + encodeURIComponent(realOrigin))\n      .then(function (r) { return r.json(); })\n      .then(function (data) {\n        if (!data || !data.setCookie || !data.setCookie.length) return;\n        var m = jarMap(jarGet());\n        for (var i = 0; i < data.setCookie.length; i++) {\n          var first = String(data.setCookie[i]).split(';')[0];\n          var eq = first.indexOf('=');\n          if (eq > 0) m[first.slice(0, eq).trim()] = first.slice(eq + 1).trim();\n        }\n        var s = jarString(m);\n        try { sessionStorage.setItem(JAR_KEY, s); } catch (e) {}\n      })\n      .catch(function () {});\n  })();\n\n  // ── 7. localStorage / sessionStorage emulation (per real origin) ───────\n  // All proxied sites share the real htmltools.me storage, so every key is\n  // namespaced with the site's origin. Pages see clean per-site storage.\n  (function () {\n    var nativeLS = window.localStorage;\n    var nativeSS = window.sessionStorage;\n    var NS = '__ht__' + b64url(realOrigin) + '__';\n\n    function NsStore(native) {\n      this._n = native;\n    }\n    NsStore.prototype = {\n      _keys: function () {\n        var out = [], n = this._n;\n        for (var i = 0; i < n.length; i++) {\n          var k = n.key(i);\n          if (k && k.indexOf(NS) === 0) out.push(k.slice(NS.length));\n        }\n        return out;\n      },\n      getItem: function (k) { return this._n.getItem(NS + String(k)); },\n      setItem: function (k, v) { this._n.setItem(NS + String(k), String(v)); },\n      removeItem: function (k) { this._n.removeItem(NS + String(k)); },\n      key: function (i) { return this._keys()[i] || null; },\n      clear: function () {\n        var n = this._n;\n        this._keys().forEach(function (k) { n.removeItem(NS + k); });\n      },\n    };\n    Object.defineProperty(NsStore.prototype, 'length', {\n      get: function () { return this._keys().length; },\n    });\n\n    try {\n      Object.defineProperty(window, 'localStorage', {\n        configurable: true,\n        get: function () { return lsShim; },\n      });\n      Object.defineProperty(window, 'sessionStorage', {\n        configurable: true,\n        get: function () { return ssShim; },\n      });\n    } catch (e) {}\n    var lsShim = new NsStore(nativeLS);\n    var ssShim = new NsStore(nativeSS);\n  })();\n\n  // ── 8. WebSocket proxying ──────────────────────────────────────────────\n  // Connects to OUR backend over wss; the backend dials the real ws://\n  // server and pipes frames both ways, preserving text/binary.\n  var _WS = window.WebSocket;\n  function resolveWs(u) {\n    var s = String(u || '');\n    var abs;\n    try {\n      if (/^wss?:/i.test(s)) {\n        abs = s;\n      } else if (s.indexOf('//') === 0) {\n        abs = (location.protocol === 'https:' ? 'wss:' : 'ws:') + s;\n      } else {\n        abs = new URL(s, REAL_URL).href;\n        abs = abs.replace(/^https:/i, 'wss:').replace(/^http:/i, 'ws:');\n      }\n    } catch (e) {\n      abs = s;\n    }\n    return abs;\n  }\n\n  function HTWebSocket(url, protocols) {\n    if (!(this instanceof HTWebSocket)) {\n      throw new TypeError(\"Failed to construct 'WebSocket': use 'new'.\");\n    }\n    var self = this;\n    var abs = resolveWs(url);\n    this._url = abs;\n    this._binaryType = 'blob';\n    this._ls = { open: [], message: [], error: [], close: [] };\n\n    var handshake = b64url(JSON.stringify({\n      cookie: jarGet(),\n      origin: realOrigin,\n      protocol: protocols || null,\n    }));\n    var wire = WS_BACKEND + '/proxyws?u=' + encodeURIComponent(abs) + '&hd=' + encodeURIComponent(handshake);\n    // Protocols travel inside hd; none on the real handshake so the browser\n    // never expects a Sec-WebSocket-Protocol echo.\n    var real = new _WS(wire);\n    this._real = real;\n\n    real.addEventListener('open', function () { self._fire('open', new Event('open')); });\n    real.addEventListener('error', function () { self._fire('error', new Event('error')); });\n    real.addEventListener('close', function (e) {\n      self._fire('close', new CloseEvent('close', { code: e.code, reason: e.reason, wasClean: e.wasClean }));\n    });\n    real.addEventListener('message', function (e) {\n      var data = e.data;\n      if (data instanceof Blob && self._binaryType === 'arraybuffer') {\n        data.arrayBuffer().then(function (buf) {\n          self._fire('message', new MessageEvent('message', { data: buf }));\n        });\n      } else {\n        self._fire('message', new MessageEvent('message', { data: data }));\n      }\n    });\n  }\n  HTWebSocket.prototype._fire = function (type, event) {\n    event.target = this;\n    var list = this._ls[type].slice();\n    for (var i = 0; i < list.length; i++) {\n      try { list[i].call(this, event); } catch (e) {}\n    }\n    var h = this['on' + type];\n    if (typeof h === 'function') {\n      try { h.call(this, event); } catch (e) {}\n    }\n  };\n  HTWebSocket.prototype.addEventListener = function (t, fn, opts) {\n    if (this._ls[t]) this._ls[t].push(fn);\n  };\n  HTWebSocket.prototype.removeEventListener = function (t, fn) {\n    var l = this._ls[t];\n    if (!l) return;\n    var i = l.indexOf(fn);\n    if (i !== -1) l.splice(i, 1);\n  };\n  HTWebSocket.prototype.send = function (data) { return this._real.send(data); };\n  HTWebSocket.prototype.close = function (code, reason) { this._real.close(code, reason); };\n  Object.defineProperty(HTWebSocket.prototype, 'url', { get: function () { return this._url; } });\n  Object.defineProperty(HTWebSocket.prototype, 'readyState', {\n    get: function () { return this._real.readyState; },\n  });\n  Object.defineProperty(HTWebSocket.prototype, 'bufferedAmount', {\n    get: function () { return this._real.bufferedAmount; },\n  });\n  Object.defineProperty(HTWebSocket.prototype, 'extensions', {\n    get: function () { return this._real.extensions; },\n  });\n  Object.defineProperty(HTWebSocket.prototype, 'protocol', {\n    get: function () { return this._real.protocol; },\n  });\n  Object.defineProperty(HTWebSocket.prototype, 'binaryType', {\n    get: function () { return this._binaryType; },\n    set: function (v) {\n      this._binaryType = v === 'arraybuffer' ? 'arraybuffer' : 'blob';\n      this._real.binaryType = 'blob';\n    },\n  });\n  HTWebSocket.CONNECTING = 0;\n  HTWebSocket.OPEN = 1;\n  HTWebSocket.CLOSING = 2;\n  HTWebSocket.CLOSED = 3;\n  try { window.WebSocket = HTWebSocket; } catch (e) {}\n\n  // ── 9. EventSource / sendBeacon / Workers ──────────────────────────────\n  var _ES = window.EventSource;\n  if (_ES) {\n    var HTES = function (url, cfg) { return new _ES(px(url), cfg); };\n    HTES.prototype = _ES.prototype;\n    ['CONNECTING', 'OPEN', 'CLOSED'].forEach(function (k) { HTES[k] = _ES[k]; });\n    try { window.EventSource = HTES; } catch (e) {}\n  }\n\n  if (navigator.sendBeacon) {\n    navigator.sendBeacon = function (url, data) {\n      try {\n        _fetch(px(url), { method: 'POST', body: data, keepalive: true });\n        return true;\n      } catch (e) {\n        return false;\n      }\n    };\n  }\n\n  var _Worker = window.Worker;\n  if (_Worker) {\n    var HTWorker = function (url, opts) {\n      try { url = px(url); } catch (e) {}\n      return new _Worker(url, opts);\n    };\n    HTWorker.prototype = _Worker.prototype;\n    try { window.Worker = HTWorker; } catch (e) {}\n  }\n  var _SWC = window.SharedWorker;\n  if (_SWC) {\n    var HTSW = function (url, opts) {\n      try { url = px(url); } catch (e) {}\n      return new _SWC(url, opts);\n    };\n    HTSW.prototype = _SWC.prototype;\n    try { window.SharedWorker = HTSW; } catch (e) {}\n  }\n\n  // ── 10. dynamic DOM: rewrite nodes the page adds later ─────────────────\n  var obs = new MutationObserver(function (muts) {\n    for (var i = 0; i < muts.length; i++) {\n      var added = muts[i].addedNodes;\n      for (var j = 0; j < added.length; j++) {\n        var n = added[j];\n        if (!n || n.nodeType !== 1) continue;\n        try {\n          if (n.src && typeof n.src === 'string' && n.src.indexOf(PREFIX + '~/') !== 0) {\n            var abs = resolve(n.src);\n            if (/^https?:/i.test(abs) && abs.indexOf(location.origin + PREFIX) !== 0) n.src = toProxy(abs);\n          }\n          if (n.href && (n.tagName === 'LINK' || n.tagName === 'A') &&\n              typeof n.href === 'string' && n.href.indexOf(PREFIX + '~/') !== 0) {\n            var abs2 = resolve(n.getAttribute('href') || '');\n            if (/^https?:/i.test(abs2)) n.setAttribute('href', toProxy(abs2));\n          }\n          if (n.tagName === 'IFRAME' && n.getAttribute('src')) {\n            var abs3 = resolve(n.getAttribute('src'));\n            if (/^https?:/i.test(abs3)) n.setAttribute('src', toProxy(abs3));\n          }\n        } catch (e) {}\n      }\n    }\n  });\n  obs.observe(document.documentElement, { childList: true, subtree: true });\n})();\n";

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
  event.respondWith(handle(req, target));
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
  return new Response(resp.body, { status, headers });
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
