// HTMLTools Browser — engine (auto-built single file)
const BACKEND = "https://htmltools-browser-nqv1xw3k6rph.htmltools-browser.deno.net";
const KEY = "htmltools-change-me-9f2k";
const SEARCH = "https://www.bing.com/search?q=";
const ALLOWED_HOSTS = ["*"];
function hostAllowed() { try { var h = location.hostname.toLowerCase(); return ALLOWED_HOSTS.indexOf('*') >= 0 || ALLOWED_HOSTS.indexOf(h) >= 0; } catch (e) { return false; } }
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
 * Self-heals double-wrapped URLs (~/~/…) that buggy site scripts produce:
 * if the decoded value is itself a proxied path, unwrap again (max 3x).
 */
function decodeUrl(part) {
  const i = part.indexOf('~/');
  if (i === -1) return null;
  return decodeBlob(part.slice(i + 2));
}

/** Decode a raw blob (the part after ~/). Query-string form uses this. */
function decodeBlob(tail) {
  if (!tail) return null;
  if (!tail) return null;
  let out = null;
  for (let n = 0; n < 3 && tail; n++) {
    try {
      out = decodeURIComponent(xorStr(b64urlDecode(tail)));
    } catch {
      return null;
    }
    if (typeof out !== 'string' || !/^https?:/i.test(out)) return out === null ? null : out;
    // already a clean http(s) URL that is NOT itself wrapped? done.
    const j = out.indexOf('/~/');
    if (j === -1) return out;
    // Looks double-wrapped: try peeling one layer; if the peel doesn't
    // decode cleanly, treat the original as legit (sites CAN contain /~/).
    const peeled = out.slice(j + 3);
    let inner = null;
    try {
      inner = decodeURIComponent(xorStr(b64urlDecode(peeled)));
    } catch {
      return out;
    }
    if (typeof inner !== 'string' || !/^https?:/i.test(inner)) return out;
    tail = peeled;
  }
  return out;
}

/**
 * Query-string form: path stays short (/~/?u=…) so the browser's service
 * worker never skips the request for URL-length reasons on navigations.
 */
function encodeUrlQ(url, prefix = '/') {
  const p = prefix.endsWith('/') ? prefix : prefix + '/';
  return p + '~/?u=' + b64urlEncode(xorStr(encodeURIComponent(url)));
}

// HTMLTools Browser — HTML/CSS URL rewriter.
// Pure string functions (no DOM) so they run in the service worker AND in
// Node for testing. Regex-based on purpose: fast, zero dependencies.
// Roadmap: streaming rewriter so huge pages never buffer fully.

const SKIP_RE = /^(#|data:|blob:|about:|mailto:|tel:|sms:|javascript:|file:|cid:|intent:|ws:|wss:|ftp:)/i;

/** Decode HTML entities in attribute values (&amp; → & etc). Without this,
 *  every URL with a query string gets literal "&amp;" baked into its encoded
 *  form and the target site receives garbage parameters. */
function decodeEntities(s) {
  return s.replace(/&(#[xX]?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g, (m, ent) => {
    if (ent[0] === '#') {
      const num =
        ent[1] === 'x' || ent[1] === 'X'
          ? parseInt(ent.slice(2), 16)
          : parseInt(ent.slice(1), 10);
      if (!Number.isNaN(num) && num > 0 && num < 0x110000) {
        try { return String.fromCodePoint(num); } catch { return m; }
      }
      return m;
    }
    const e = ent.toLowerCase();
    const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
    return named[e] !== undefined ? named[e] : m;
  });
}

/** Resolve any href/src-ish value against the page URL and encode it, or
 *  return it untouched when it's not proxiable. */
function proxify(value, base, encode) {
  if (typeof value !== 'string') return value;
  const v = decodeEntities(value.trim());
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
  'href|src|poster|background|cite|longdesc|data-src|data-href|data-url|data-poster';

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

  // The page's <base> has been applied to every URL above; leaving the tag in
  // would make the browser resolve later relative URLs against a proxied blob.
  html = html.replace(/<base\b[^>]*>/gi, '');

  // Mask <script> bodies while attributes/styles/meta are rewritten. JS often
  // contains HTML *strings* (template literals like <a href="${tool.url}">);
  // rewriting those as if they were real attributes corrupted them (every
  // card link became a proxied ".../${tool.url}" 404). Bodies are restored
  // before the script-specific rules below.
  const scriptBodies = [];
  const scriptOpens = [];
  html = html.replace(/(<script\b[^>]*>)([\s\S]*?)(<\/script\s*>)/gi, (m, open, body, close) => {
    scriptBodies.push(body);
    scriptOpens.push(open);
    return open + '\u0000HTSCRIPT' + (scriptBodies.length - 1) + '\u0000' + close;
  });

  // 0a. inline script bodies: location shim (skip JSON / templates / non-JS types)
  for (let i = 0; i < scriptBodies.length; i++) {
    const ty = /\btype\s*=\s*["']?([^"'\s>]+)/i.exec(scriptOpens[i]);
    if (ty && !/^(module|(text|application)\/(x-)?(java|ecma)script)$/i.test(ty[1])) continue;
    scriptBodies[i] = rewriteJsLoc(scriptBodies[i]);
  }

  // 0b. Same-origin <script src> / script preloads keep a PLAIN PATH (the frame URL
  //     mirrors the real path, and the service worker's catch-all maps it to the real
  //     site). Bundlers like Next/Turbopack work out each chunk's identity from its
  //     script src ("/_next/static/chunks/x.js"); a proxied blob URL made every chunk
  //     register wrongly, so the page never hydrated — dead buttons. Relative
  //     imports inside module scripts now resolve correctly too.
  let pageOrigin = '';
  try { pageOrigin = new URL(baseUrl).origin; } catch {}
  const plainPath = (raw) => {
    try {
      const u = new URL(String(raw).replace(/&amp;/g, '&').trim(), base);
      if (/^https?:$/.test(u.protocol) && u.origin === pageOrigin) return (u.pathname + u.search).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
    } catch {}
    return null;
  };
  html = html.replace(/(<script\b[^>]*?\s)src(\s*=\s*)(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi, (m, pre, eq, dq, sq, uq) => {
    const p = plainPath(dq !== undefined ? dq : sq !== undefined ? sq : uq);
    return p === null ? m : pre + 'htsrc' + eq + '"' + p + '"';
  });
  html = html.replace(/<link\b[^>]*>/gi, (tag) => {
    if (!/\bas\s*=\s*["']?script|\brel\s*=\s*["']?modulepreload/i.test(tag)) return tag;
    return tag.replace(/(\s)href(\s*=\s*)(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i, (m, sp, eq, dq, sq, uq) => {
      const p = plainPath(dq !== undefined ? dq : sq !== undefined ? sq : uq);
      return p === null ? m : sp + 'hthref' + eq + '"' + p + '"';
    });
  });

  // 1. Standard URL attributes (double + single + unquoted values).
  const attrRe = new RegExp(
    `(\\s(href|src|poster|background|cite|longdesc|data-src|data-href|data-url|data-poster|srcset|imagesrcset)\\s*=\\s*)("([^"]*)"|'([^']*)'|([^\\s>]+))`,
    'gi'
  );
  html = html.replace(attrRe, (m, eq, name, _q, dq, sq, uq) => {
    const raw = dq !== undefined ? dq : sq !== undefined ? sq : uq;
    const done = /srcset/i.test(name) ? rewriteSrcset(raw, base, encode) : proxify(raw, base, encode);
    return eq + '"' + String(done ?? '').replace(/"/g, '&quot;') + '"';
  });

  html = html.replace(/(\s)htsrc=/g, '$1src=').replace(/(\s)hthref=/g, '$1href=');

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

  html = html.replace(/\u0000HTSCRIPT(\d+)\u0000/g, (m, i) => scriptBodies[+i]);

  // 5. JS-driven redirects: location.replace/assign/href with absolute URL
  //    string literals (tracking redirectors like bing.com/ck/a do this —
  //    `location` itself can't be hooked from inside the page, so rewrite
  //    the source instead; relative /~/ paths resolve correctly in-page).
  html = html.replace(
    /location(\s*\.\s*href\s*=\s*|\s*=\s*|\s*\.\s*(?:replace|assign)\s*\(\s*)("https?:\/\/[^"]*"|'https?:\/\/[^']*')(\s*\))?/gi,
    (m, pre, q, post) => {
      const url = q.slice(1, -1);
      try {
        const abs = new URL(decodeEntities(url), base);
        if (abs.protocol !== 'http:' && abs.protocol !== 'https:') return m;
        return 'location' + pre + '"' + encode(abs.href) + '"' + (post || '');
      } catch {
        return m;
      }
    }
  );

  // 6. Rewrite ALL absolute URL string literals inside inline scripts.
  //    Real-world trackers do `var u = "https://dest"; … location.replace(u)`
  //    — the literal sits far from the navigation call, so pattern-matching
  //    the call site can't see it. Rewriting every literal covers var-assign,
  //    JSON config, fetch constants, etc. (Runtime hooks already skip
  //    values that are proxied, so double-processing is harmless.)
  html = html.replace(/(<script\b[^>]*>)([\s\S]*?<\/script\s*>)/gi, (m, open, body) => {
    if (/\bsrc\s*=/i.test(open)) return m; // external scripts untouched
    // Only tiny redirector-style scripts (they hold a URL and navigate to it).
    // Rewriting literals in real app scripts corrupts config values — e.g. a
    // Firebase databaseURL became a proxy path and the whole app froze.
    if (body.length > 4000 || !/location|window\.open|\.replace\s*\(|\.assign\s*\(/.test(body)) return m;
    const done = body.replace(/(['"])(https?:\/\/[^'"\s\\]{4,})\1/g, (mm, q, u) => {
      try {
        const abs = new URL(decodeEntities(u), base);
        if (abs.protocol !== 'http:' && abs.protocol !== 'https:') return mm;
        return q + encode(abs.href) + q;
      } catch {
        return mm;
      }
    });
    return open + done;
  });

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


// ── location shim (source rewrite) ───────────────────────────────────────
// Proxied pages live on OUR origin, so `location.origin/host/href` would show
// htmltools.me instead of the real site (share links, origin checks …).
// `location` itself can't be replaced, so scripts are rewritten to read a
// fake, real-site `location` exposed by the runtime as `__htloc`.
//   x.location            -> x.__htloc      (Object.prototype accessor falls back to x.location
//                                             for non-window objects, so JSON/data objects keep working)
//   location.href|origin… -> __htloc.href…  (bare global use)
//   window['location']    -> window.__htloc
//   obfuscated string arrays ('location' literal, scripts using _0x… names) -> '__htloc'
function rewriteJsLoc(js) {
  if (typeof js !== 'string' || js.length > 8000000 || js.indexOf('ocation') === -1) return js;
  let out = js;
  // bracket access with a literal
  out = out.replace(/\[\s*(['"])location\1\s*\]/g, '.__htloc');
  // property access (window.location, document.location, self.location, a?.location …)
  out = out.replace(/\.location\b/g, '.__htloc');
  // bare global: location.href / location.origin / location = … / location.assign(…)
  out = out.replace(/(^|[^\w$.])location(?=\s*\.\s*(?:href|origin|host|hostname|protocol|port|search|hash|pathname|assign|replace|reload|toString)\b)/g, '$1__htloc');
  out = out.replace(/(^|[;{}\n])(\s*)location(\s*=(?!=))/g, '$1$2__htloc$3');
  // javascript-obfuscator style string arrays: access goes through 'location' literals
  if (/_0x[0-9a-f]{4,6}/.test(out)) out = out.replace(/(['"])location\1/g, '$1__htloc$1');
  return out;
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
//   • The backend address is fixed at build time (no user setting)
// ─────────────────────────────────────────────────────────────────────────





const VERSION = 'v1.12.0';
const SCOPE = new URL(self.registration.scope).pathname; // '/' or '/browser/'
const ROOT = SCOPE.replace(/\/$/, ''); // '' or '/browser'
const RUNTIME_PATH = ROOT + '/~/__ht/runtime.js';
const COOKIES_PATH = ROOT + '/~/__ht/cookies';
const SYNC_PATH = ROOT + '/~/__ht/sync';
const DEBUG_PATH = ROOT + '/~/__ht/debug';
const dbg = [];
const pageBase = new Map(); // clientId → <base href> of that page (if any)
const pageReal = new Map(); // clientId → real URL of the page painted in that frame
let lastReal = '';

// Which real page does this (nested) client show? Cached; if the worker was
// restarted and forgot, ask the frame itself.
async function realFor(clientId) {
  if (pageReal.has(clientId)) return pageReal.get(clientId);
  try {
    const c = await self.clients.get(clientId);
    if (!c || c.frameType !== 'nested') return null; // the app page itself — never touch
    const r = await new Promise((res) => {
      const ch = new MessageChannel();
      ch.port1.onmessage = (m) => res(m.data && m.data.url);
      c.postMessage({ type: 'whoami' }, [ch.port2]);
      setTimeout(() => res(null), 400);
    });
    const url = r || lastReal || null;
    if (url) pageReal.set(clientId, url);
    return url;
  } catch { return null; }
}

// A proxied page asked for a same-origin URL that isn't one of ours (a path
// the page built itself, e.g. fetch('/api/x') or an <img> it created). On a
// real site that path lives on the REAL origin — map it there instead of
// letting the host answer with its own 404.
async function catchAll(event, req, url) {
  const real = await realFor(event.clientId);
  if (!real) return fetch(req);
  let target;
  try {
    target = new URL(url.pathname + url.search, real).href;
    // page has <base href>: a relative URL the browser resolved against the frame URL
    // (e.g. img.src='img/a.png') must be re-resolved against the base instead.
    const base = pageBase.get(event.clientId);
    if (base) {
      const dir = new URL('.', real).pathname;
      if (dir !== '/' && url.pathname.startsWith(dir)) target = new URL(url.pathname.slice(dir.length) + url.search, base).href;
    }
  } catch { return fetch(req); }
  try {
    return await handle(req, target, { noMerge: true, referer: real, clientId: event.clientId });
  } catch (err) {
    return new Response('HTMLTools engine error: ' + (err && err.message), { status: 502, headers: { 'content-type': 'text/plain; charset=utf-8' } });
  }
}

// runtime.js source. The build script replaces the marker below with the
// actual source (bundled single-file mode); in multi-file mode it stays
// null and install() fetches ./runtime.js instead.
let RUNTIME_SRC = "// ─────────────────────────────────────────────────────────────────────────\n// HTMLTools Browser — page runtime (injected into every proxied page). v1.1\n//\n// Teaches proxied pages our URL scheme and makes them behave like they run\n// on their real origin, the way a real browser would:\n//   fetch / XHR / WebSocket / EventSource / sendBeacon / Worker /\n//   window.open / links / forms / history / dynamic DOM\n//   document.cookie (per real origin, HttpOnly-aware)\n//   localStorage + sessionStorage (per real origin, namespaced)\n//\n// __HT_KEY__ / __HT_PREFIX__ / __HT_BACKEND__ are replaced by the service\n// worker at install time, so this always matches the engine.\n// ─────────────────────────────────────────────────────────────────────────\n(function () {\n  if (window.__htmltools) return;\n  window.__htmltools = true;\n\n  var KEY = '__HT_KEY__';\n  var PREFIX = '__HT_PREFIX__';\n  var BACKEND = '__HT_BACKEND__';\n  var WS_BACKEND = BACKEND.replace(/^http/i, 'ws');\n\n  // The real URL of this page (injected just before this script loads).\n  var REAL_URL =\n    (document.currentScript && document.currentScript.getAttribute('data-real-url')) ||\n    window.__HT_REAL_URL__ ||\n    ('https://' + location.hostname + '/');\n\n  function xorStr(s) {\n    var out = '';\n    for (var i = 0; i < s.length; i++) {\n      out += String.fromCharCode(s.charCodeAt(i) ^ KEY.charCodeAt(i % KEY.length));\n    }\n    return out;\n  }\n  function b64url(s) {\n    return btoa(s).replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=+$/, '');\n  }\n  function unb64url(s) {\n    var b = s.replace(/-/g, '+').replace(/_/g, '/');\n    while (b.length % 4) b += '=';\n    return atob(b);\n  }\n  function isProxiedPath(s) {\n    s = String(s);\n    return s.indexOf(PREFIX + '~/') === 0 || s.indexOf(location.origin + PREFIX + '~/') === 0;\n  }\n  function toProxy(abs) {\n    var s = String(abs);\n    if (!/^https?:/i.test(s)) return s;\n    // already one of OUR proxied URLs (only ~/ paths — /Browser/ itself is NOT)\n    if (s.indexOf(location.origin + PREFIX + '~/') === 0) return s.slice(location.origin.length);\n    if (s.indexOf(PREFIX + '~/') === 0) return s;\n    // query form: short path (/~/?u=…) so navigations are never skipped\n    return PREFIX + '~/?u=' + b64url(xorStr(encodeURIComponent(s)));\n  }\n  // Nested = a frame INSIDE a proxied page (ads, embeds). The page frame of a\n  // tab is a direct child of the app (window.top).\n  var IS_NESTED = false;\n  try { IS_NESTED = window.parent !== window.top; } catch (e) { IS_NESTED = true; }\n  function appPost(msg) {\n    try { window.top.postMessage(msg, location.origin); return true; } catch (e) { return false; }\n  }\n  // Navigate THIS frame through the engine. Top page frames ask the app (it\n  // fetches + paints); nested frames just navigate natively (SW handles it).\n  function sendNav(proxiedUrl) {\n    if (IS_NESTED) { window.__htAllow = true; location.href = proxiedUrl; return; }\n    if (!appPost({ __htNav: proxiedUrl })) { window.__htAllow = true; location.href = proxiedUrl; }\n  }\n  function resolve(u) {\n    var s = String(u);\n    // Already-proxied paths must NEVER be resolved against the real site —\n    // that produced https://site.com/Browser/~/?u=… (404s everywhere).\n    if (isProxiedPath(s)) return s.charAt(0) === '/' ? location.origin + s : s;\n    try {\n      var ru = new URL(s, window.__HT_BASE__ || REAL_URL);\n      // An ABSOLUTE url on our own origin (from new Request('/x'), new URL(x, location.href),\n      // a.href …) is really a real-site path — our frame URL mirrors the real path.\n      if (/^https?:/i.test(s) && ru.origin === location.origin && realOrigin !== location.origin &&\n          ru.pathname.indexOf(PREFIX + '~/') !== 0) {\n        ru = new URL(ru.pathname + ru.search + ru.hash, REAL_URL);\n      }\n      return ru.href;\n    } catch (e) {\n      return s;\n    }\n  }\n  var SKIP = /^(#|data:|blob:|about:|mailto:|tel:|sms:|javascript:)/i;\n  function px(u) {\n    var v = String(u);\n    if (!v || SKIP.test(v.trim())) return u;\n    var abs = resolve(v);\n    return toProxy(abs);\n  }\n\n  var realOrigin;\n  try { realOrigin = new URL(REAL_URL).origin; } catch (e) { realOrigin = 'https://example.com'; }\n\n  // Make this frame's own URL mirror the REAL page's path/query/hash (on our\n  // origin). Then location.pathname-based routers work, relative URLs a page\n  // builds resolve to the right real path, and the engine can map any stray\n  // same-origin request back to the real site (see sw.js catch-all).\n  var _hPush = history.pushState, _hReplace = history.replaceState;\n  function realPathOf(abs) {\n    try { var u = new URL(abs); return location.origin + u.pathname + u.search + u.hash; } catch (e) { return location.href; }\n  }\n  try { _hReplace.call(history, null, '', realPathOf(REAL_URL)); } catch (e) {}\n\n  // ── fake `location` / document URL props (real-site values) ─────────────\n  // Scripts are rewritten by the engine (rewriteJsLoc) so `x.location` becomes\n  // `x.__htloc`; for window/document that returns this fake Location. For any\n  // other object it falls back to the plain `.location` property.\n  var FL = {\n    get href() { return REAL_URL; },\n    set href(v) { location.href = v; },\n    get origin() { try { return new URL(REAL_URL).origin; } catch (e) { return location.origin; } },\n    get protocol() { try { return new URL(REAL_URL).protocol; } catch (e) { return location.protocol; } },\n    get host() { try { return new URL(REAL_URL).host; } catch (e) { return location.host; } },\n    get hostname() { try { return new URL(REAL_URL).hostname; } catch (e) { return location.hostname; } },\n    get port() { try { return new URL(REAL_URL).port; } catch (e) { return location.port; } },\n    get pathname() { return location.pathname; }, set pathname(v) { location.pathname = v; },\n    get search() { return location.search; }, set search(v) { location.search = v; },\n    get hash() { return location.hash; }, set hash(v) { location.hash = v; },\n    get ancestorOrigins() { return location.ancestorOrigins; },\n    assign: function (u) { location.assign(u); },\n    replace: function (u) { location.replace(u); },\n    reload: function () { location.reload.apply(location, arguments); },\n    toString: function () { return REAL_URL; },\n    valueOf: function () { return REAL_URL; },\n  };\n  try { Object.defineProperty(FL, Symbol.toPrimitive, { value: function () { return REAL_URL; } }); } catch (e) {}\n  try {\n    Object.defineProperty(Object.prototype, '__htloc', {\n      configurable: true, enumerable: false,\n      get: function () { return (this === window || this === document) ? FL : this.location; },\n      set: function (v) {\n        if (this === window || this === document) { location.href = v; return; }\n        Object.defineProperty(this, 'location', { value: v, writable: true, configurable: true, enumerable: true });\n      },\n    });\n  } catch (e) {}\n  // document.URL / documentURI / baseURI / domain / window.origin show the real site too\n  try {\n    var dp = Document.prototype;\n    var urlDesc = Object.getOwnPropertyDescriptor(dp, 'URL');\n    Object.defineProperty(dp, 'URL', { configurable: true, get: function () { return this === document ? REAL_URL : urlDesc.get.call(this); } });\n    Object.defineProperty(dp, 'documentURI', { configurable: true, get: function () { return REAL_URL; } });\n    Object.defineProperty(dp, 'domain', { configurable: true, get: function () { try { return new URL(REAL_URL).hostname; } catch (e) { return location.hostname; } }, set: function () {} });\n  } catch (e) {}\n  try {\n    Object.defineProperty(window, 'origin', { configurable: true, get: function () { try { return new URL(REAL_URL).origin; } catch (e) { return location.origin; } } });\n  } catch (e) {}\n  window.__htRealOrigin = function () { try { return new URL(REAL_URL).origin; } catch (e) { return location.origin; } };\n  // postMessage: pages pass their (fake) real origin as targetOrigin — deliver anyway.\n  try {\n    var _pm = Window.prototype.postMessage;\n    Window.prototype.postMessage = function (msg, a, b) {\n      try {\n        if (typeof a === 'string' && a !== '*' && a !== '/') return _pm.call(this, msg, '*', b);\n      } catch (e) {}\n      return _pm.apply(this, arguments);\n    };\n  } catch (e) {}\n  // MessageEvent.origin: same-document-family messages report the sender's REAL origin,\n  // so `e.origin === location.origin` checks (now real) keep passing.\n  try {\n    var mo = Object.getOwnPropertyDescriptor(MessageEvent.prototype, 'origin');\n    Object.defineProperty(MessageEvent.prototype, 'origin', {\n      configurable: true,\n      get: function () {\n        var o = mo.get.call(this);\n        if (o === location.origin) {\n          try { var s = this.source; if (s && typeof s.__htRealOrigin === 'function') return s.__htRealOrigin(); } catch (e) {}\n          try { return new URL(REAL_URL).origin; } catch (e) {}\n        }\n        return o;\n      },\n    });\n  } catch (e) {}\n\n  // ── 0. Navigation API: CATCH every navigation this frame attempts ─────────\n  // location.href = …, location.replace(), form.submit(), meta refresh, JS\n  // redirects… all fire a cancelable 'navigate' event. We cancel it and route\n  // it through the engine so nothing ever escapes to the real network, the\n  // app itself, or the host's 404 page. (Then neuter the API so Bing-style\n  // hijackers can't re-route our frame.)\n  function fixDest(dest) {\n    var u;\n    try { u = new URL(dest); } catch (e) { return null; }\n    if (!/^https?:$/.test(u.protocol)) return null;\n    if (u.origin === location.origin) {\n      if (u.pathname.indexOf(PREFIX + '~/') === 0) return { proxied: u.pathname + u.search };\n      // same-origin = resolved against OUR mirrored URL → it's a real-site path\n      try { return { real: new URL(u.pathname + u.search + u.hash, REAL_URL).href }; } catch (e) { return null; }\n    }\n    return { real: u.href };\n  }\n  try {\n    var nav0 = window.navigation;\n    if (nav0) {\n      var addNav = nav0.addEventListener.bind(nav0);\n      addNav('navigate', function (e) {\n        try {\n          if (window.__htAllow) { window.__htAllow = false; return; }\n          if (e.destination.sameDocument || e.hashChange || e.downloadRequest != null) return;\n          if (!e.cancelable) return;\n          var r = fixDest(e.destination.url);\n          if (!r) return;\n          var px2 = r.proxied || toProxy(r.real);\n          if (IS_NESTED && r.proxied) return; // proxied nav inside nested frame: let SW serve it\n          if (e.formData && !IS_NESTED) {\n            // native POST form navigation: replay it through the engine\n            var fp = [];\n            try { e.formData.forEach(function (v, k) { if (typeof v === 'string') fp.push([k, v]); }); } catch (e5) {}\n            e.preventDefault();\n            appPost({ __htNavPost: { url: px2, fields: fp } });\n            return;\n          }\n          e.preventDefault();\n          sendNav(px2);\n        } catch (err) {}\n      });\n      nav0.addEventListener = function () {};\n      try { Object.defineProperty(nav0, 'onnavigate', { configurable: true, get: function () { return null; }, set: function () {} }); } catch (e3) {}\n    }\n  } catch (e) {}\n\n  // ── 1. fetch ───────────────────────────────────────────────────────────\n  var _fetch = window.fetch;\n  window.fetch = function (input, init) {\n    try {\n      if (typeof input === 'string' || input instanceof URL) input = px(String(input));\n      else if (input && input.url) input = new Request(px(input.url), input);\n    } catch (e) {}\n    return _fetch.call(this, input, init);\n  };\n\n  // ── 2. XMLHttpRequest ──────────────────────────────────────────────────\n  var _open = XMLHttpRequest.prototype.open;\n  XMLHttpRequest.prototype.open = function (method, url) {\n    var rest = Array.prototype.slice.call(arguments, 2);\n    return _open.apply(this, [method, px(url)].concat(rest));\n  };\n\n  // ── 3. window.open → new tab inside our browser UI ─────────────────────\n  var _wopen = window.open;\n  function openInAppTab(proxiedUrl) {\n    if (!appPost({ __htNewTab: true, url: proxiedUrl })) {\n      try { _wopen.call(window, proxiedUrl, '_blank'); } catch (e) {}\n    }\n  }\n  function fakeWindow() {\n    return {\n      closed: false, focus: function () {}, blur: function () {}, close: function () {},\n      postMessage: function () {}, document: { write: function () {}, close: function () {} },\n      location: { href: '', replace: function () {}, assign: function () {} },\n    };\n  }\n  window.open = function (u, name, feats) {\n    try {\n      if (u != null && String(u) !== '') {\n        var abs = resolve(u);\n        if (/^https?:/i.test(abs)) {\n          var p = toProxy(abs);\n          if (/^_(self|top|parent)$/i.test(name || '')) sendNav(p);\n          else openInAppTab(p);\n          return fakeWindow();\n        }\n      }\n    } catch (e) {}\n    return _wopen.call(this, u, name, feats);\n  };\n\n  // ── 4. history API ─────────────────────────────────────────────────────\n  // The frame URL mirrors the real path, so pages see real routes. We tell\n  // the app whenever a single-page app changes route so the address bar,\n  // tab title and back/forward stay right.\n  var _lastLoc = location.pathname + location.search + location.hash;\n  function notifyUrl() {\n    if (IS_NESTED) return;\n    appPost({ __htUrl: REAL_URL });\n  }\n  function wrapHist(orig) {\n    return function (st, t, u) {\n      if (u == null) return orig.call(history, st, t);\n      var abs;\n      try { abs = new URL(String(u), REAL_URL).href; } catch (e) { return orig.call(history, st, t, u); }\n      var same = false;\n      try { same = new URL(abs).origin === realOrigin; } catch (e) {}\n      if (!same) return; // a real browser would throw here; staying quiet avoids freezing sites\n      var r = orig.call(history, st, t, realPathOf(abs));\n      REAL_URL = abs;\n      _lastLoc = location.pathname + location.search + location.hash;\n      notifyUrl();\n      return r;\n    };\n  }\n  // Patch the PROTOTYPE as well as the instance: sites (YouTube) call\n  // History.prototype.pushState directly / keep their own reference, which used to\n  // bypass the wrapper → address bar + tab title never followed the page.\n  try {\n    var wPush = wrapHist(_hPush), wRep = wrapHist(_hReplace);\n    var HP = window.History && window.History.prototype;\n    if (HP) {\n      Object.defineProperty(HP, 'pushState', { value: function (st, t, u) { return wPush.call(this, st, t, u); }, writable: true, configurable: true });\n      Object.defineProperty(HP, 'replaceState', { value: function (st, t, u) { return wRep.call(this, st, t, u); }, writable: true, configurable: true });\n    }\n    try { delete history.pushState; delete history.replaceState; } catch (e2) {}\n  } catch (e) {}\n  // Report ANY change of this frame's location to the app (address bar, tab title, back/forward).\n  // Driven by pushState/replaceState wrappers, popstate/hashchange, the Navigation API's\n  // currententrychange AND a cheap poll — YouTube changes route in a way none of the\n  // events alone reported (address bar stayed on the search page).\n  function checkLoc() {\n    try {\n      var cur = location.pathname + location.search + location.hash;\n      if (cur === _lastLoc) return;\n      _lastLoc = cur;\n      REAL_URL = realOrigin + cur;\n      notifyUrl();\n    } catch (e) {}\n  }\n  var syncFromLocation = checkLoc;\n  try {\n    if (window.navigation && window.navigation.addEventListener) {\n      window.navigation.addEventListener('currententrychange', function () { setTimeout(checkLoc, 0); });\n    }\n  } catch (e) {}\n  window.addEventListener('popstate', checkLoc);\n  window.addEventListener('hashchange', checkLoc);\n  if (!IS_NESTED) setInterval(checkLoc, 300);\n\n  // ── 5. links + forms (capture phase, before the page can react) ────────\n  // On WINDOW, capture: site hijackers (Bing/Brave) also listen on window\n  // capture — whoever registered FIRST wins, and our runtime is injected\n  // before any page script runs, so we're first in line.\n  function anchorFrom(e) {\n    var p = e.composedPath ? e.composedPath() : [];\n    for (var i = 0; i < p.length; i++) {\n      var n = p[i];\n      if (n && n.tagName && (n.tagName === 'A' || n.tagName === 'AREA') && n.getAttribute && n.getAttribute('href') !== null) return n;\n    }\n    var t = e.target;\n    return t && t.closest ? t.closest('a[href],area[href]') : null;\n  }\n  // Returns true when the link was claimed (caller cancels the native action).\n  function goAnchor(a, e) {\n    var href = a.getAttribute('href');\n    if (!href || href.charAt(0) === '#' || /^\\s*javascript:/i.test(href)) return false;\n    if (a.hasAttribute('download')) return false; // real downloads stay native\n    var tgt = a.getAttribute('target') || '';\n    var newTab = (tgt && !/^_(self|top|parent)$/i.test(tgt)) || e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1;\n    if (tgt && !/^_/.test(tgt)) { try { if (window.frames[tgt]) return false; } catch (x) {} }\n    var p;\n    if (isProxiedPath(href)) p = href.indexOf(location.origin) === 0 ? href.slice(location.origin.length) : href;\n    else {\n      var abs = resolve(href);\n      if (!/^https?:/i.test(abs)) return false;\n      p = toProxy(abs);\n    }\n    if (newTab) openInAppTab(p); else sendNav(p);\n    return true;\n  }\n  function claim(e) {\n    e.preventDefault();\n    e.stopPropagation();\n    if (e.stopImmediatePropagation) e.stopImmediatePropagation();\n  }\n  // Same-tab link clicks are NOT pre-empted any more: they navigate natively and\n  // the Navigation API handler (section 0) routes them through the engine. That\n  // way the page's own click handlers (menus, SPA routers, modals) still run and\n  // can preventDefault — previously every <a> click was swallowed (\"buttons\n  // don't work\"). Only NEW-TAB intents need us (they'd open a real window).\n  function wantsNewTab(a, e) {\n    var tgt = a.getAttribute('target') || '';\n    return (tgt && !/^_(self|top|parent)$/i.test(tgt)) || e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1;\n  }\n  window.addEventListener('click', function (e) {\n    if (e.button !== 0 || e.defaultPrevented) return;\n    var a = anchorFrom(e);\n    if (a && wantsNewTab(a, e) && goAnchor(a, e)) claim(e);\n  }, false);\n  // middle-click fires auxclick, not click — it used to open a REAL browser tab\n  window.addEventListener('auxclick', function (e) {\n    if (e.button !== 1 || e.defaultPrevented) return;\n    var a = anchorFrom(e);\n    if (a && goAnchor(a, e)) claim(e);\n  }, false);\n  // a.click() on a DETACHED link (very common: create <a target=_blank>, click it)\n  // never reaches window listeners — it used to open a REAL browser tab.\n  try {\n    var _aclick = HTMLAnchorElement.prototype.click;\n    HTMLAnchorElement.prototype.click = function () {\n      try { if (!this.isConnected && goAnchor(this, {})) return; } catch (x) {}\n      return _aclick.call(this);\n    };\n  } catch (e) {}\n\n  // Returns true when the form was claimed.\n  function submitForm(f, submitter) {\n    var action = (submitter && submitter.getAttribute && submitter.getAttribute('formaction')) || f.getAttribute('action') || '';\n    var method = ((submitter && submitter.getAttribute && submitter.getAttribute('formmethod')) || f.getAttribute('method') || 'get').toUpperCase();\n    var proxied;\n    if (isProxiedPath(action)) proxied = action.indexOf(location.origin) === 0 ? action.slice(location.origin.length) : action;\n    else {\n      var abs = resolve(action || REAL_URL);\n      if (!/^https?:/i.test(abs)) return false;\n      proxied = toProxy(abs);\n    }\n    var newTab = /^_blank$/i.test(f.getAttribute('target') || '');\n    var pairs = [];\n    try {\n      var fd = submitter ? new FormData(f, submitter) : new FormData(f);\n      fd.forEach(function (v, k) { if (typeof v === 'string') pairs.push([k, v]); });\n    } catch (e3) { return false; }\n    if (method === 'POST') {\n      return appPost({ __htNavPost: { url: proxied, fields: pairs, newTab: newTab } });\n    }\n    var qs = pairs.map(function (p2) { return encodeURIComponent(p2[0]) + '=' + encodeURIComponent(p2[1]); }).join('&');\n    var dest = qs ? proxied + (proxied.indexOf('?') === -1 ? '?' : '&') + qs : proxied;\n    if (newTab) openInAppTab(dest); else sendNav(dest);\n    return true;\n  }\n  // Normal submits go native → Navigation API. Only target=_blank forms need us.\n  window.addEventListener('submit', function (e) {\n    var f = e.target;\n    if (!f || !f.getAttribute || e.defaultPrevented) return;\n    if (!/^_blank$/i.test((e.submitter && e.submitter.getAttribute('formtarget')) || f.getAttribute('target') || '')) return;\n    try { if (submitForm(f, e.submitter)) claim(e); } catch (x) {}\n  }, false);\n  // form.submit() fires NO submit event — it used to navigate natively\n  try {\n    var _fsubmit = HTMLFormElement.prototype.submit;\n    HTMLFormElement.prototype.submit = function () {\n      try { if (submitForm(this, null)) return; } catch (x) {}\n      return _fsubmit.call(this);\n    };\n  } catch (e) {}\n\n  // ── 6. document.cookie emulation (per real origin) ─────────────────────\n  var JAR_KEY = 'ht-jar:' + realOrigin;\n  function jarGet() {\n    try { return sessionStorage.getItem(JAR_KEY) || ''; } catch (e) { return ''; }\n  }\n  function jarSet(s) {\n    try { sessionStorage.setItem(JAR_KEY, s); } catch (e) {}\n    pushCookies(s);\n  }\n  function jarMap(str) {\n    var m = {}, parts = (str || '').split(';');\n    for (var i = 0; i < parts.length; i++) {\n      var p = parts[i], idx = p.indexOf('=');\n      if (idx > 0) m[p.slice(0, idx).trim()] = p.slice(idx + 1).trim();\n    }\n    return m;\n  }\n  function jarString(m) {\n    var out = [];\n    for (var k in m) out.push(k + '=' + m[k]);\n    return out.join('; ');\n  }\n  try {\n    Object.defineProperty(document, 'cookie', {\n      configurable: true,\n      get: function () { return jarGet(); },\n      set: function (v) {\n        v = String(v);\n        var eq = v.indexOf('=');\n        if (eq < 1) return;\n        var name = v.slice(0, eq).trim();\n        var value = v.slice(eq + 1).split(';')[0];\n        var expired = /expires=thu, 01 jan 1970|max-age=0/i.test(v) || value === '';\n        var m = jarMap(jarGet());\n        if (expired) delete m[name]; else m[name] = value;\n        jarSet(jarString(m));\n      },\n    });\n  } catch (e) {}\n\n  function pushCookies(cookie) {\n    try {\n      // keepalive: this POST used to get aborted by page navigations (every\n      // form submit!) — losing the login cookies it was carrying.\n      _fetch(PREFIX + '~/__ht/cookies', {\n        method: 'POST',\n        headers: { 'content-type': 'application/json' },\n        body: JSON.stringify({ origin: realOrigin, cookie: cookie }),\n        keepalive: true,\n      });\n    } catch (e) {}\n  }\n\n  // Boot: pull upstream Set-Cookie the SW saved (non-HttpOnly only) → jar.\n  (function syncCookies() {\n    _fetch(PREFIX + '~/__ht/sync?o=' + encodeURIComponent(realOrigin))\n      .then(function (r) { return r.json(); })\n      .then(function (data) {\n        if (!data || !data.setCookie || !data.setCookie.length) return;\n        var m = jarMap(jarGet());\n        for (var i = 0; i < data.setCookie.length; i++) {\n          var first = String(data.setCookie[i]).split(';')[0];\n          var eq = first.indexOf('=');\n          if (eq > 0) m[first.slice(0, eq).trim()] = first.slice(eq + 1).trim();\n        }\n        var s = jarString(m);\n        try { sessionStorage.setItem(JAR_KEY, s); } catch (e) {}\n      })\n      .catch(function () {});\n  })();\n\n  // ── 7. localStorage / sessionStorage emulation (per real origin) ───────\n  // All proxied sites share the real htmltools.me storage, so every key is\n  // namespaced with the site's origin. Pages see clean per-site storage.\n  (function () {\n    var nativeLS = window.localStorage;\n    var nativeSS = window.sessionStorage;\n    var NS = '__ht__' + b64url(realOrigin) + '__';\n\n    function NsStore(native) {\n      this._n = native;\n    }\n    NsStore.prototype = {\n      _keys: function () {\n        var out = [], n = this._n;\n        for (var i = 0; i < n.length; i++) {\n          var k = n.key(i);\n          if (k && k.indexOf(NS) === 0) out.push(k.slice(NS.length));\n        }\n        return out;\n      },\n      getItem: function (k) { return this._n.getItem(NS + String(k)); },\n      setItem: function (k, v) { this._n.setItem(NS + String(k), String(v)); },\n      removeItem: function (k) { this._n.removeItem(NS + String(k)); },\n      key: function (i) { return this._keys()[i] || null; },\n      clear: function () {\n        var n = this._n;\n        this._keys().forEach(function (k) { n.removeItem(NS + k); });\n      },\n    };\n    Object.defineProperty(NsStore.prototype, 'length', {\n      get: function () { return this._keys().length; },\n    });\n\n    try {\n      Object.defineProperty(window, 'localStorage', {\n        configurable: true,\n        get: function () { return lsShim; },\n      });\n      Object.defineProperty(window, 'sessionStorage', {\n        configurable: true,\n        get: function () { return ssShim; },\n      });\n    } catch (e) {}\n    var lsShim = new NsStore(nativeLS);\n    var ssShim = new NsStore(nativeSS);\n  })();\n\n  // ── 8. WebSocket proxying ──────────────────────────────────────────────\n  // Connects to OUR backend over wss; the backend dials the real ws://\n  // server and pipes frames both ways, preserving text/binary.\n  var _WS = window.WebSocket;\n  function resolveWs(u) {\n    var s = String(u || '');\n    var abs;\n    try {\n      if (/^wss?:/i.test(s)) {\n        abs = s;\n      } else if (s.indexOf('//') === 0) {\n        abs = (location.protocol === 'https:' ? 'wss:' : 'ws:') + s;\n      } else {\n        abs = new URL(s, REAL_URL).href;\n        abs = abs.replace(/^https:/i, 'wss:').replace(/^http:/i, 'ws:');\n      }\n    } catch (e) {\n      abs = s;\n    }\n    return abs;\n  }\n\n  function HTWebSocket(url, protocols) {\n    if (!(this instanceof HTWebSocket)) {\n      throw new TypeError(\"Failed to construct 'WebSocket': use 'new'.\");\n    }\n    var self = this;\n    var abs = resolveWs(url);\n    this._url = abs;\n    this._binaryType = 'blob';\n    this._ls = { open: [], message: [], error: [], close: [] };\n\n    var handshake = b64url(JSON.stringify({\n      cookie: jarGet(),\n      origin: realOrigin,\n      protocol: protocols || null,\n    }));\n    var wire = WS_BACKEND + '/proxyws?u=' + encodeURIComponent(abs) + '&hd=' + encodeURIComponent(handshake);\n    // Protocols travel inside hd; none on the real handshake so the browser\n    // never expects a Sec-WebSocket-Protocol echo.\n    var real = new _WS(wire);\n    this._real = real;\n\n    real.addEventListener('open', function () { self._fire('open', new Event('open')); });\n    real.addEventListener('error', function () { self._fire('error', new Event('error')); });\n    real.addEventListener('close', function (e) {\n      self._fire('close', new CloseEvent('close', { code: e.code, reason: e.reason, wasClean: e.wasClean }));\n    });\n    real.addEventListener('message', function (e) {\n      var data = e.data;\n      if (data instanceof Blob && self._binaryType === 'arraybuffer') {\n        data.arrayBuffer().then(function (buf) {\n          self._fire('message', new MessageEvent('message', { data: buf }));\n        });\n      } else {\n        self._fire('message', new MessageEvent('message', { data: data }));\n      }\n    });\n  }\n  HTWebSocket.prototype._fire = function (type, event) {\n    event.target = this;\n    var list = this._ls[type].slice();\n    for (var i = 0; i < list.length; i++) {\n      try { list[i].call(this, event); } catch (e) {}\n    }\n    var h = this['on' + type];\n    if (typeof h === 'function') {\n      try { h.call(this, event); } catch (e) {}\n    }\n  };\n  HTWebSocket.prototype.addEventListener = function (t, fn, opts) {\n    if (this._ls[t]) this._ls[t].push(fn);\n  };\n  HTWebSocket.prototype.removeEventListener = function (t, fn) {\n    var l = this._ls[t];\n    if (!l) return;\n    var i = l.indexOf(fn);\n    if (i !== -1) l.splice(i, 1);\n  };\n  HTWebSocket.prototype.send = function (data) { return this._real.send(data); };\n  HTWebSocket.prototype.close = function (code, reason) { this._real.close(code, reason); };\n  Object.defineProperty(HTWebSocket.prototype, 'url', { get: function () { return this._url; } });\n  Object.defineProperty(HTWebSocket.prototype, 'readyState', {\n    get: function () { return this._real.readyState; },\n  });\n  Object.defineProperty(HTWebSocket.prototype, 'bufferedAmount', {\n    get: function () { return this._real.bufferedAmount; },\n  });\n  Object.defineProperty(HTWebSocket.prototype, 'extensions', {\n    get: function () { return this._real.extensions; },\n  });\n  Object.defineProperty(HTWebSocket.prototype, 'protocol', {\n    get: function () { return this._real.protocol; },\n  });\n  Object.defineProperty(HTWebSocket.prototype, 'binaryType', {\n    get: function () { return this._binaryType; },\n    set: function (v) {\n      this._binaryType = v === 'arraybuffer' ? 'arraybuffer' : 'blob';\n      this._real.binaryType = 'blob';\n    },\n  });\n  HTWebSocket.CONNECTING = 0;\n  HTWebSocket.OPEN = 1;\n  HTWebSocket.CLOSING = 2;\n  HTWebSocket.CLOSED = 3;\n  try { window.WebSocket = HTWebSocket; } catch (e) {}\n\n  // ── 9. EventSource / sendBeacon / Workers ──────────────────────────────\n  var _ES = window.EventSource;\n  if (_ES) {\n    var HTES = function (url, cfg) { return new _ES(px(url), cfg); };\n    HTES.prototype = _ES.prototype;\n    ['CONNECTING', 'OPEN', 'CLOSED'].forEach(function (k) { HTES[k] = _ES[k]; });\n    try { window.EventSource = HTES; } catch (e) {}\n  }\n\n  if (navigator.sendBeacon) {\n    navigator.sendBeacon = function (url, data) {\n      try {\n        _fetch(px(url), { method: 'POST', body: data, keepalive: true });\n        return true;\n      } catch (e) {\n        return false;\n      }\n    };\n  }\n\n  var _Worker = window.Worker;\n  if (_Worker) {\n    var HTWorker = function (url, opts) {\n      try { url = px(url); } catch (e) {}\n      return new _Worker(url, opts);\n    };\n    HTWorker.prototype = _Worker.prototype;\n    try { window.Worker = HTWorker; } catch (e) {}\n  }\n  var _SWC = window.SharedWorker;\n  if (_SWC) {\n    var HTSW = function (url, opts) {\n      try { url = px(url); } catch (e) {}\n      return new _SWC(url, opts);\n    };\n    HTSW.prototype = _SWC.prototype;\n    try { window.SharedWorker = HTSW; } catch (e) {}\n  }\n\n  // ── 10. dynamic DOM: rewrite nodes the page adds later ─────────────────\n  // Careful: element .src/.href PROPERTIES resolve against the app's real\n  // location (htmltools.me/Browser/~/…), so an already-proxied node looks\n  // \"unproxied\" to a naive prefix check → double-wrapping → 404 storms.\n  // We check both the raw attribute and the resolved property before touching.\n  var PROX_HIT = location.origin + PREFIX + '~/';\n  function alreadyDone(val) {\n    return (\n      typeof val !== 'string' ||\n      val.indexOf(PREFIX + '~/') === 0 ||\n      val.indexOf(PROX_HIT) !== -1\n    );\n  }\n  var obs = new MutationObserver(function (muts) {\n    for (var i = 0; i < muts.length; i++) {\n      var added = muts[i].addedNodes;\n      for (var j = 0; j < added.length; j++) {\n        var n = added[j];\n        if (!n || n.nodeType !== 1) continue;\n        try {\n          // Bing's hidden auth-check iframe re-navigates itself on failure and\n          // then walks into our sibling frames (same origin under the hood),\n          // hijacking tabs. It serves no purpose through the proxy: remove it.\n          if (n.tagName === 'IFRAME') {\n            var nsrc = (n.getAttribute && n.getAttribute('src')) || '';\n            if (/fd\\/auth\\/signin/i.test(nsrc) || (n.src && /fd\\/auth\\/signin/i.test(n.src))) {\n              n.parentNode && n.parentNode.removeChild(n);\n              continue;\n            }\n          }\n          if (n.tagName === 'SCRIPT') {\n            // keep same-origin script paths PLAIN: bundlers (Turbopack/webpack) read\n            // document.currentScript.src to identify the chunk. The SW catch-all serves them.\n            var sraw = n.getAttribute('src');\n            if (sraw && !/^(https?:)?\\/\\//i.test(sraw)) continue;\n            if (sraw && /^https?:/i.test(sraw) && !alreadyDone(sraw)) {\n              try {\n                var su = new URL(sraw);\n                if (su.origin === realOrigin && realOrigin !== location.origin) { n.setAttribute('src', su.pathname + su.search); continue; }\n              } catch (e3) {}\n            }\n          }\n          if (n.src && typeof n.src === 'string' && !alreadyDone(n.src)) {\n            var raw = n.getAttribute('src');\n            if (raw && !alreadyDone(raw)) {\n              var abs = resolve(raw);\n              if (/^https?:/i.test(abs) && abs.indexOf(location.origin + PREFIX + '~/') !== 0) {\n                n.setAttribute('src', toProxy(abs));\n              }\n            }\n          }\n          if ((n.tagName === 'LINK' || n.tagName === 'A') && !alreadyDone(n.href)) {\n            var raw2 = n.getAttribute('href');\n            if (raw2 && raw2.charAt(0) !== '#' && !alreadyDone(raw2)) {\n              var abs2 = resolve(raw2);\n              if (/^https?:/i.test(abs2) && abs2.indexOf(location.origin + PREFIX + '~/') !== 0) {\n                n.setAttribute('href', toProxy(abs2));\n              }\n            }\n          }\n        } catch (e) {}\n      }\n    }\n  });\n  obs.observe(document.documentElement, { childList: true, subtree: true });\n\n  // ── 11. tell the engine which real page this frame is showing ───────────\n  // Lets the service worker map any stray same-origin request (a path a page\n  // built itself) back to the REAL site instead of a 404.\n  try {\n    var swc = navigator.serviceWorker;\n    if (swc) {\n      var reg = function () { if (swc.controller) swc.controller.postMessage({ type: 'page', url: REAL_URL, base: window.__HT_BASE__ || '' }); };\n      reg();\n      swc.addEventListener('controllerchange', reg);\n      swc.addEventListener('message', function (ev) {\n        if (ev.data && ev.data.type === 'whoami' && ev.ports && ev.ports[0]) ev.ports[0].postMessage({ url: REAL_URL });\n      });\n      if (swc.startMessages) swc.startMessages();\n    }\n  } catch (e) {}\n})();\n";

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

// The backend address is fixed at build time. (Older builds let the user save one in IndexedDB;
// forget any such leftover so it can never point somewhere else.)
const backend = BACKEND;
const backendReady = idbOp('readwrite', (s) => s.delete('backend')).catch(() => {});

// ── extensions (config pushed by the app; persisted so a restarted worker keeps it) ──
let extConf = { adblock: false, dark: false, cookies: false, exts: [] };
const extReady = idbOp('readonly', (s) => s.get('ext')).then((c) => { if (c && typeof c === 'object') extConf = c; }).catch(() => {});

const AD_HOSTS = /(^|\.)(doubleclick\.net|googlesyndication\.com|googleadservices\.com|googletagservices\.com|adservice\.google\.[a-z.]+|google-analytics\.com|adnxs\.com|taboola\.com|outbrain\.com|criteo\.(com|net)|rubiconproject\.com|pubmatic\.com|openx\.net|amazon-adsystem\.com|moatads\.com|scorecardresearch\.com|hotjar\.com|adsrvr\.org|casalemedia\.com|smartadserver\.com|teads\.tv|media\.net|advertising\.com|adform\.net|3lift\.com|sharethrough\.com|indexww\.com|bidswitch\.net|contextweb\.com|2mdn\.net|serving-sys\.com|quantserve\.com|zedo\.com|revcontent\.com|mgid\.com|popads\.net|propellerads\.com|exoclick\.com|adsterra\.com|yieldmo\.com|lijit\.com|33across\.com|connect\.facebook\.net|ads-twitter\.com|analytics\.tiktok\.com|snap\.licdn\.com)$/i;
const AD_YT = /^\/(api\/stats\/(ads|atr)|pagead\/|ptracking|get_midroll_info|youtubei\/v1\/log_event)/i;
function isAdRequest(u) {
  const h = u.hostname;
  if (AD_HOSTS.test(h)) return true;
  if (/(^|\.)youtube\.com$/.test(h) && AD_YT.test(u.pathname)) return true;
  return false;
}
const AD_CSS = 'ins.adsbygoogle,.adsbygoogle,[id^="google_ads_"],[id^="div-gpt-ad"],[id*="google_ads_iframe"],iframe[src*="doubleclick.net"],iframe[src*="googlesyndication"],' +
  'iframe[id^="google_ads"],.ad-slot,.ad-banner,.ad-container,.advert,.advertisement,.ad-unit,[class*="ad-placeholder"],[data-ad-slot],[data-google-query-id],' +
  '#player-ads,#masthead-ad,ytd-ad-slot-renderer,ytd-display-ad-renderer,ytd-promoted-sparkles-web-renderer,ytd-banner-promo-renderer,.ytp-ad-module,.ytp-ad-overlay-container,' +
  '.taboola,.trc_related_container,[id^="taboola-"],.OUTBRAIN,[data-widget-id^="AR_"]{display:none!important}';

const COOKIE_CSS = '#onetrust-banner-sdk,#onetrust-consent-sdk,.onetrust-pc-dark-filter,#CybotCookiebotDialog,#CybotCookiebotDialogBodyUnderlay,#cookiebanner,#cookie-banner,#cookie-notice,#cookie-law-info-bar,#cookieConsent,#cookie-consent,#gdpr-cookie-notice,#gdpr-consent,' +
  '.cc-window,.cc-banner,.cookie-banner,.cookie-notice,.cookie-consent,.cookie-popup,.cookies-banner,.cookie-bar,.cookiebar,.gdpr-banner,.truste_overlay,.truste_box_overlay,#truste-consent-track,' +
  '[id^="sp_message_container"],.fc-consent-root,.qc-cmp2-container,#qc-cmp2-container,#didomi-host,.didomi-popup-backdrop,#usercentrics-root,#cmpwrapper,.osano-cm-window,.evidon-banner,.termsfeed-com---nb,#hs-eu-cookie-confirmation,.iubenda-cs-container,#iubenda-cs-banner,[aria-label="Cookie banner" i],[aria-label="Cookie consent" i],[id*="cookie-banner" i],[class*="cookie-banner" i]{display:none!important}';

function adStub(request) {
  const d = request.destination || '';
  if (d === 'script') return new Response('/* blocked by HTMLTools */', { status: 200, headers: { 'content-type': 'application/javascript' } });
  if (d === 'image') {
    const gif = Uint8Array.from(atob('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'), (c) => c.charCodeAt(0));
    return new Response(gif, { status: 200, headers: { 'content-type': 'image/gif' } });
  }
  if (d === 'style') return new Response('', { status: 200, headers: { 'content-type': 'text/css' } });
  return new Response('', { status: 200, headers: { 'content-type': 'text/plain' } });
}

// Chrome match patterns (*://*.site.com/*, <all_urls>) and userscript globs
function globRe(g) {
  return new RegExp('^' + g.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$', 'i');
}
function matchPat(p, url) {
  try {
    if (!p) return false;
    if (p === '<all_urls>' || p === '*') return /^https?:/i.test(url);
    const m = /^(\*|https?):\/\/([^/]*)(\/.*)?$/i.exec(p);
    if (!m) return globRe(p).test(url);
    const u = new URL(url);
    const scheme = m[1].toLowerCase();
    if (scheme === '*' ? !/^https?:$/.test(u.protocol) : u.protocol !== scheme + ':') return false;
    const host = m[2];
    const hostRe = host === '*' ? '.*' : host.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/^\*\\\./, '(?:.+\\.)?').replace(/\*/g, '.*');
    if (!new RegExp('^' + hostRe + '$', 'i').test(host.indexOf(':') >= 0 ? u.host : u.hostname)) return false;
    return globRe(m[3] || '/*').test(u.pathname + u.search);
  } catch { return false; }
}

function chromeShimSrc(e) {
  const files = e.files || {};
  return '(function(){var ID=' + JSON.stringify(e.id) + ',F=' + JSON.stringify(files) + ',MF=' + JSON.stringify(e.manifest || {}) + ';' +
    'var pre="htx:"+ID+":";function keys(k){if(k==null)return Object.keys(localStorage).filter(function(x){return x.indexOf(pre)==0}).map(function(x){return x.slice(pre.length)});' +
    'if(typeof k==="string")return[k];if(Array.isArray(k))return k;return Object.keys(k)}' +
    'var st={get:function(k,cb){var r={};try{keys(k).forEach(function(x){var v=localStorage.getItem(pre+x);if(v!=null)r[x]=JSON.parse(v);else if(k&&typeof k==="object"&&!Array.isArray(k))r[x]=k[x]})}catch(e){}if(cb)cb(r);return Promise.resolve(r)},' +
    'set:function(o,cb){try{for(var x in o)localStorage.setItem(pre+x,JSON.stringify(o[x]))}catch(e){}if(cb)cb();return Promise.resolve()},' +
    'remove:function(k,cb){try{keys(k).forEach(function(x){localStorage.removeItem(pre+x)})}catch(e){}if(cb)cb();return Promise.resolve()},' +
    'clear:function(cb){try{keys().forEach(function(x){localStorage.removeItem(pre+x)})}catch(e){}if(cb)cb();return Promise.resolve()},' +
    'getBytesInUse:function(k,cb){if(cb)cb(0);return Promise.resolve(0)},onChanged:{addListener:function(){},removeListener:function(){}}};' +
    'var ev={addListener:function(){},removeListener:function(){},hasListener:function(){return false}};' +
    'var c=window.chrome=window.chrome||{};' +
    'c.runtime=c.runtime||{};c.runtime.id=c.runtime.id||ID;' +
    'c.runtime.getURL=function(p){p=String(p||"").replace(/^\\//,"");return F[p]||"about:blank#"+p};' +
    'c.runtime.getManifest=function(){return MF};' +
    'c.runtime.sendMessage=function(){var cb=arguments[arguments.length-1];if(typeof cb==="function")setTimeout(function(){cb()},0);return Promise.resolve()};' +
    'c.runtime.connect=function(){return{postMessage:function(){},disconnect:function(){},onMessage:ev,onDisconnect:ev}};' +
    'c.runtime.onMessage=c.runtime.onMessage||ev;c.runtime.onConnect=c.runtime.onConnect||ev;c.runtime.onInstalled=c.runtime.onInstalled||ev;' +
    'c.storage={local:st,sync:st,session:st,managed:st,onChanged:ev};' +
    'c.i18n=c.i18n||{getMessage:function(k){return k},getUILanguage:function(){return navigator.language}};' +
    'c.extension=c.extension||{getURL:c.runtime.getURL};c.tabs=c.tabs||{query:function(q,cb){if(cb)cb([]);return Promise.resolve([])},sendMessage:function(){return Promise.resolve()}};' +
    'window.browser=window.browser||c;})();';
}
function gmShimSrc(e) {
  return '(function(){var pre="htgm:"+' + JSON.stringify(e.id) + '+":";' +
    'window.unsafeWindow=window;window.GM_info={script:{name:' + JSON.stringify(e.name) + '}};' +
    'window.GM_getValue=function(k,d){try{var v=localStorage.getItem(pre+k);return v==null?d:JSON.parse(v)}catch(x){return d}};' +
    'window.GM_setValue=function(k,v){try{localStorage.setItem(pre+k,JSON.stringify(v))}catch(x){}};' +
    'window.GM_deleteValue=function(k){try{localStorage.removeItem(pre+k)}catch(x){}};' +
    'window.GM_addStyle=function(css){var s=document.createElement("style");s.textContent=css;(document.head||document.documentElement).appendChild(s);return s};' +
    'window.GM_log=function(){console.log.apply(console,arguments)};' +
    'window.GM_registerMenuCommand=function(){};window.GM_openInTab=function(u){window.open(u,"_blank")};' +
    'window.GM_setClipboard=function(t){try{navigator.clipboard.writeText(t)}catch(x){}};' +
    'window.GM_xmlhttpRequest=function(o){fetch(o.url,{method:o.method||"GET",headers:o.headers,body:o.data}).then(function(r){return r.text().then(function(t){var res={status:r.status,statusText:r.statusText,responseText:t,response:t,finalUrl:r.url};o.onload&&o.onload(res)})}).catch(function(x){o.onerror&&o.onerror(x)})};' +
    'window.GM={getValue:function(k,d){return Promise.resolve(window.GM_getValue(k,d))},setValue:function(k,v){return Promise.resolve(window.GM_setValue(k,v))},addStyle:function(c){return Promise.resolve(window.GM_addStyle(c))}};})();';
}

// Everything the extensions system adds to a page (top frame or nested frame).
function extInject(targetUrl, isTop) {
  let out = '';
  if (extConf.adblock) out += '<style data-ht-ext>' + AD_CSS + '</style>';
  if (extConf.cookies) out += '<style data-ht-ext>' + COOKIE_CSS + '</style>';
  if (extConf.dark && isTop) {
    out += '<style data-ht-ext>html{filter:invert(.93) hue-rotate(180deg)!important;background:#fff!important}' +
      'img,video,canvas,picture,svg image,iframe,embed,object,[style*="background-image"]{filter:invert(1) hue-rotate(180deg)!important}</style>';
  }
  for (const e of extConf.exts || []) {
    for (const c of e.cs || []) {
      if (!isTop && !c.allFrames) continue;
      if (!(c.matches || []).some((p) => matchPat(p, targetUrl))) continue;
      if ((c.excludes || []).some((p) => matchPat(p, targetUrl))) continue;
      if (c.css) out += '<style data-ht-ext="' + e.id + '">' + c.css.replace(/<\/style/gi, '<\\/style') + '</style>';
      if (c.js) {
        let code = rewriteJsLoc(c.js);
        const late = c.runAt && c.runAt !== 'document_start';
        const body = (e.shim ? chromeShimSrc(e) : '') + (e.kind === 'userscript' ? gmShimSrc(e) : '') +
          'try{(function(){' + code + '\n})()}catch(err){console.error("[HTMLTools extension: ' + String(e.name).replace(/["\\\n\r]/g, ' ') + ']",err)}';
        const wrapped = late
          ? '(function(){function go(){' + body + '}if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",go);else go()})();'
          : body;
        out += '<script data-ht-ext="' + e.id + '">' + wrapped.replace(/<\/script/gi, '<\\/script') + '</script>';
      }
    }
  }
  return out;
}


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

self.addEventListener('message', (event) => {
  const d = event.data || {};
  if (d.type === 'version') {
    // the app asks which engine version is actually running, so it can
    // detect a stale worker (Chrome can keep an old one for many reloads)
    const payload = { type: 'version', version: VERSION };
    if (event.ports && event.ports[0]) event.ports[0].postMessage(payload);
    else if (event.source) event.source.postMessage(payload);
    return;
  }
  if (d.type === 'page' && typeof d.url === 'string' && event.source && event.source.id) {
    // a proxied page frame tells us which REAL url it is showing
    pageReal.set(event.source.id, d.url);
    if (typeof d.base === 'string' && d.base) pageBase.set(event.source.id, d.base); else pageBase.delete(event.source.id);
    lastReal = d.url;
    if (pageReal.size > 300) pageReal.delete(pageReal.keys().next().value);
    return;
  }
  if (d.type === 'ext' && d.conf && typeof d.conf === 'object') {
    extConf = d.conf;
    idbOp('readwrite', (s) => s.put(extConf, 'ext')).catch(() => {});
    return;
  }
  if (d.type === 'clearCookies') {
    store.clear();
    idbOp('readwrite', (s) => s.put(store.toJSON(), 'cookies')).catch(() => {});
    if (event.ports && event.ports[0]) event.ports[0].postMessage({ ok: true });
  }
});

self.addEventListener('fetch', (event) => {
  if (typeof hostAllowed === 'function' && !hostAllowed()) return; // host lock: only htmltools.me
  const req = event.request;
  if (req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'POST') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) {
    // Self-heal: a page resolved one of OUR paths against the real site
    // (https://site.com/Browser/~/?u=…). Decode it and serve the real target.
    if (event.clientId && url.pathname.indexOf(SCOPE + '~/') === 0) {
      const t = decodeBlob(url.searchParams.get('u') || '') || decodeUrl(url.pathname);
      if (t && /^https?:/i.test(t)) {
        event.respondWith(handle(req, t, { noMerge: true, clientId: event.clientId }).catch(
          (err) => new Response('HTMLTools engine error: ' + (err && err.message), { status: 502 })));
      }
    }
    return;
  }
  dbg.push(req.method + ' ' + url.pathname.slice(0, 90));
  if (dbg.length > 400) dbg.splice(0, 200);

  if (url.pathname === DEBUG_PATH) {
    event.respondWith(new Response(JSON.stringify(dbg), { headers: { 'content-type': 'application/json' } }));
    return;
  }
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

  let target = decodeUrl(url.pathname) || decodeBlob(url.searchParams.get('u') || '');
  if (!target || !/^https?:/i.test(target)) {
    // A /~/ path we can't decode = a mangled/double-wrapped link. Show a
    // small friendly page instead of letting the host site's 404 take over.
    if (url.pathname.indexOf(SCOPE + '~/') === 0) {
      event.respondWith(
        new Response(
          '<meta charset="utf-8"><body style="font-family:system-ui;background:#0d1117;color:#e6edf3;display:grid;place-items:center;height:100vh;margin:0"><div style="text-align:center;max-width:90%"><div style="font-size:40px">&#60;HT&#62;</div><p>This link got scrambled in transit.<br>Go back and try the link again.</p><p style="font-size:11px;color:#8b949e;word-break:break-all">debug: ' +
            url.pathname.slice(0, 120).replace(/</g, '&lt;') +
            '</p><p><a href="' + SCOPE + '" style="color:#58a6ff">Back to HTMLTools Browser</a></p></div>',
          { status: 404, headers: { 'content-type': 'text/html; charset=utf-8' } }
        )
      );
      return;
    }
    // same-origin request from a proxied page frame → map to the real site
    if (event.clientId && req.mode !== 'navigate') {
      event.respondWith(catchAll(event, req, url));
    }
    return; // otherwise: normal app traffic
  }
  event.respondWith(
    handle(req, target, { clientId: event.clientId }).catch((err) => {
      console.error('[htmltools] engine error:', err);
      return new Response('HTMLTools engine error: ' + (err && err.message), {
        status: 502,
        headers: { 'content-type': 'text/plain; charset=utf-8' },
      });
    })
  );
});

// ── runtime script (served live with current settings) ──────────────────
function runtimeSource() {
  return (RUNTIME_SRC || '')
    .replaceAll('__HT_KEY__', KEY)
    .replaceAll('__HT_PREFIX__', SCOPE)
    .replaceAll('__HT_BACKEND__', backend);
}
async function serveRuntime() {
  await backendReady;
  return new Response(runtimeSource(), {
    headers: { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store' },
  });
}

// ── core proxy ───────────────────────────────────────────────────────────
async function handle(request, targetUrl, opts = {}) {
  await storeReady;
  await extReady;
  await backendReady;
  let tURL;
  try { tURL = new URL(targetUrl); } catch {
    return new Response('bad target', { status: 400 });
  }
  if (extConf.adblock && request.headers.get('x-ht-nav') !== '1' && isAdRequest(tURL)) return adStub(request);
  const method = request.method;

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
  // Referer/Origin must be those of the REAL PAGE making the request (APIs such as
  // Firebase/YouTube keys are locked to the site's own domain and answered 403
  // "Requests from referer https://www.googleapis.com/ are blocked" before).
  let pageUrl = opts.referer || '';
  if (!pageUrl && opts.clientId) { try { pageUrl = (await realFor(opts.clientId)) || ''; } catch {} }
  let pageOrigin = '';
  try { pageOrigin = pageUrl ? new URL(pageUrl).origin : ''; } catch {}
  if (pageUrl && pageOrigin) {
    // strict-origin-when-cross-origin, like a real browser
    fwd['referer'] = pageOrigin === tURL.origin ? pageUrl.split('#')[0] : pageOrigin + '/';
  } else {
    fwd['referer'] = decRef && /^https?:/i.test(decRef) ? decRef : tURL.origin + '/';
  }

  // Tracker redirectors: bing.com/ck/a?…&u=a1<base64url> embeds the real
  // destination. Redirect straight there — never load the tracker's JS
  // redirect page (it navigates the frame itself, which is the flaky path).
  if (/(^|\.)bing\.com$/.test(tURL.hostname) && tURL.pathname.startsWith('/ck/')) {
    const uP = tURL.searchParams.get('u') || '';
    if (uP.startsWith('a1')) {
      try {
        let b = uP.slice(2).replace(/-/g, '+').replace(/_/g, '/');
        while (b.length % 4) b += '=';
        const bin = atob(b);
        let dest = '';
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        dest = decodeURIComponent(escape(String.fromCharCode.apply(null, bytes)));
        if (/^https?:\/\//i.test(dest)) return respondRedirect(dest, 302);
      } catch { /* fall through to normal proxying */ }
    }
  }

  // Beacon/Auth spam throttle: some sites (Bing) fire dozens of telemetry
  // POSTs and hidden auth-check navigations; forwarding them all can wedge
  // navigation handling for the whole worker. Answer them locally.
  if (method === 'POST' && /\/web\/xlsc|\/rewardsapp\/report|\/fd\/ls\//.test(tURL.pathname)) {
    return new Response(null, { status: 204 });
  }
  if (/\/fd\/auth\/signin/.test(tURL.pathname)) {
    // Silent-auth probe: answer "not signed in, don't retry" so Bing's page
    // never opens the auth iframe loop in the first place.
    return new Response('{"isAuthenticated":false,"silentAuth":false}', {
      status: 200,
      headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
    });
  }

  // GET forms append their fields to the OUTER query (?u=<blob>&q=…). Merge
  // every foreign param into the decoded target so nothing is silently lost.
  try {
    const reqUrl = new URL(request.url);
    if (!opts.noMerge && reqUrl.search.length > 1) {
      const tu = new URL(targetUrl);
      let merged = false;
      for (const [k, v] of reqUrl.searchParams) {
        if (k === 'u' || k === 'rdr' || k === 'rdrig') continue;
        tu.searchParams.set(k, v);
        merged = true;
      }
      if (merged) {
        targetUrl = tu.href;
        tURL = new URL(targetUrl);
      }
    }
  } catch {}

  const cookie = store.forUrl(tURL);
  if (cookie) fwd['cookie'] = cookie;
  if (request.method !== 'GET' && request.method !== 'HEAD') fwd['origin'] = pageOrigin || tURL.origin;
  else if (pageOrigin && pageOrigin !== tURL.origin && request.mode === 'cors') fwd['origin'] = pageOrigin;

  // Pass through every other header the PAGE set (x-goog-api-key, x-goog-visitor-id,
  // x-youtube-client-*, x-csrf-token, authorization, x-requested-with …). Until now only
  // five headers survived, which broke API keys/CSRF/"who is calling" headers on many sites
  // (YouTube's bot-check API answered 403 without x-goog-api-key). NOTE: the backend must
  // also forward them — see backend notes.
  const SKIP_HDR = /^(host|connection|content-length|cookie|cookie2|origin|referer|user-agent|accept-encoding|transfer-encoding|upgrade|te|keep-alive|proxy-.*|x-ht-.*|sec-.*|dnt|priority)$/i;
  try {
    request.headers.forEach((v, k) => { if (!SKIP_HDR.test(k) && v && !(k in fwd)) fwd[k] = v; });
  } catch {}
  // NOTE: client hints / sec-fetch-* are deliberately NOT synthesised: forwarding them made
  // accounts.google.com answer 401 (they disagree with the datacenter request shape).

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
    if (request.mode === 'navigate' || request.destination === 'iframe' || request.headers.get('x-ht-nav') === '1') {
      return upstreamErrorPage(targetUrl, 'The HTMLTools server did not answer. Check your connection.');
    }
    return new Response('HTMLTools server unreachable: ' + (err && err.message), { status: 502, headers: { 'content-type': 'text/plain; charset=utf-8' } });
  }

  // Backend-level failure (it couldn't reach the site at all): retry once,
  // then show a readable page instead of raw JSON.
  const isNavReq =
    request.mode === 'navigate' || request.destination === 'iframe' || request.headers.get('x-ht-nav') === '1';
  if (resp.status >= 500 && !resp.headers.get('x-proxy-headers')) {
    let j = null;
    try { j = await resp.clone().json(); } catch {}
    if (j && j.error === 'upstream_failed') {
      if (request.method === 'GET') {
        try {
          await new Promise((r) => setTimeout(r, 500));
          const again = await fetch(backendUrl(targetUrl, fwd), { method: 'GET', redirect: 'manual', cache: 'no-store' });
          if (again.headers.get('x-proxy-headers')) resp = again;
        } catch {}
      }
      if (!resp.headers.get('x-proxy-headers') && isNavReq) return upstreamErrorPage(targetUrl, j.detail);
    }
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
  // x-ht-nav: app-side fetch-and-paint navigations (see app.js loadIntoFrame)
  const isNav =
    request.mode === 'navigate' ||
    request.destination === 'iframe' ||
    request.headers.get('x-ht-nav') === '1';

  if (isHTML && isNav) {
    let html = await resp.text();
    const baseAbs = findBase(html, targetUrl);
    html = rewriteHtml(html, targetUrl, (u) => encodeUrlQ(u, SCOPE));
    html = await inlineStylesheets(html, targetUrl);
    html = injectRuntime(html, targetUrl, baseAbs, request.headers.get('x-ht-nav') === '1');
    headers.set('content-type', 'text/html; charset=utf-8');
    headers.set('cache-control', 'no-store');
    return new Response(html, { status, headers });
  }

  const isJS = /javascript|ecmascript/.test(ctype) && !/^(worker|sharedworker|serviceworker|audioworklet|paintworklet)$/.test(request.destination || '');
  let jsOk = isJS && status === 200;
  if (jsOk && request.clientId) {
    // importScripts() inside a worker has no runtime (no fake location): leave those untouched
    try { const c = await self.clients.get(request.clientId); if (c && c.type !== 'window') jsOk = false; } catch {}
  }
  if (jsOk) {
    try {
      const js = rewriteJsLoc(await resp.text());
      headers.set('content-type', ctype || 'text/javascript; charset=utf-8');
      headers.delete('content-length');
      return new Response(js, { status, headers });
    } catch (e) { /* fall through to raw */ }
  }

  if (isCSS) {
    const css = rewriteCss(await resp.text(), targetUrl, (u) => encodeUrlQ(u, SCOPE));
    headers.set('content-type', ctype || 'text/css; charset=utf-8');
    return new Response(css, { status, headers });
  }

  // Serve from a full buffer, NOT a stream. Streamed responses get cancelled
  // mid-flight when the page navigates away (Bing-style long connections),
  // which wedges the worker so every LATER navigation bypasses it entirely
  // (the "promise was rejected" → host-404 storm). Buffering kills that.
  const buf = await resp.arrayBuffer();
  const noBody = status === 204 || status === 205 || status === 304;
  if (isNavReq && status >= 500 && buf.byteLength === 0) return upstreamErrorPage(targetUrl, 'The site answered with an error (' + status + ') and no page.');
  return new Response(noBody ? null : buf, { status, headers });
}

function upstreamErrorPage(targetUrl, detail) {
  const esc = (x) => String(x || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  let host = targetUrl;
  let query = '';
  let isEngine = '';
  try {
    const u = new URL(targetUrl);
    host = u.hostname;
    const m = /(^|\.)(yahoo\.com|duckduckgo\.com|bing\.com)$/.exec(host);
    if (m) { isEngine = m[2]; query = u.searchParams.get('q') || u.searchParams.get('p') || ''; }
  } catch {}
  const enc = encodeUrlQ(targetUrl, SCOPE);
  const alts = [];
  if (query) {
    if (isEngine !== 'bing.com') alts.push(['Search Bing instead', 'https://www.bing.com/search?q=' + encodeURIComponent(query)]);
    if (isEngine !== 'duckduckgo.com') alts.push(['Search DuckDuckGo instead', 'https://duckduckgo.com/?q=' + encodeURIComponent(query)]);
  }
  const altNav = alts.map((a) => [a[0], encodeUrlQ(a[1], SCOPE)]);
  const sure = isEngine === 'yahoo.com'
    ? 'Yahoo blocks most proxy servers, so its search results usually cannot load here.'
    : 'Some sites (Google\u2019s Gemini, banks, streaming and sign-in pages) refuse connections from free proxy servers. It can also be a short-lived glitch.';
  const html =
    '<!doctype html><meta charset="utf-8"><title>Can\u2019t reach ' + esc(host) + '</title>' +
    '<style>*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0a0a0a;color:#f2f2f2;font:14px/1.55 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}' +
    '.c{max-width:500px;padding:32px 28px}.ic{width:44px;height:44px;border-radius:50%;border:2px solid #444;display:grid;place-items:center;margin-bottom:18px;font-size:22px;color:#bbb;font-weight:300}' +
    'h1{font-size:22px;font-weight:600;margin:0 0 10px;letter-spacing:-.2px}p{color:#a8a8a8;margin:0 0 20px}' +
    '.b{display:flex;gap:10px;flex-wrap:wrap}button{font:inherit;font-weight:500;height:36px;padding:0 18px;border-radius:18px;border:1px solid #3a3a3a;background:transparent;color:#f2f2f2;cursor:pointer}' +
    'button:hover{background:rgba(255,255,255,.1)}button.p{background:#fff;color:#000;border-color:#fff}button.p:hover{background:#ddd}' +
    '.d{margin-top:26px;font-size:11.5px;color:#6b6b6b;word-break:break-all}</style>' +
    '<div class="c"><div class="ic">!</div><h1>Can\u2019t reach ' + esc(host) + '</h1><p>' + esc(sure) + '</p>' +
    '<div class="b"><button class="p" id="r">Try again</button>' +
    altNav.map((a, i) => '<button data-a="' + i + '">' + esc(a[0]) + '</button>').join('') + '</div>' +
    '<div class="d">' + esc(detail) + '</div></div>' +
    '<script>var A=' + JSON.stringify(altNav.map((a) => a[1])).replace(/</g, '\\u003c') + ',go=function(u){window.parent.postMessage({__htNav:u},location.origin)};' +
    'document.getElementById("r").onclick=function(){go(' + JSON.stringify(enc).replace(/</g, '\\u003c') + ')};' +
    'Array.prototype.forEach.call(document.querySelectorAll("[data-a]"),function(b){b.onclick=function(){go(A[+b.getAttribute("data-a")])}})</script>';
  return new Response(html, { status: 502, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
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
  return Response.redirect(new URL(encodeUrlQ(abs, SCOPE), self.registration.scope).href, code);
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

// ── stylesheet inlining for painted pages ───────────────────────────────
// After certain pages (Bing) load, Chrome stops dispatching requests that
// originate INSIDE the frame tree to the service worker, so the page's own
// <link rel=stylesheet> loads 404. Fetching stylesheets here (SW context
// always dispatches) and embedding them as <style> makes painted pages
// render styled regardless.
async function inlineStylesheets(html, targetUrl) {
  const tags = html.match(/<link\b[^>]*rel=["']?stylesheet["']?[^>]*>/gi) || [];
  if (!tags.length) return html;
  const jobs = tags.slice(0, 8).map(async (tag) => {
    const m = tag.match(/href=["']([^"']+)["']/i);
    if (!m) return null;
    let u;
    try { u = new URL(m[1], targetUrl); } catch { return null; }
    const real = decodeUrl(u.pathname) || decodeBlob(u.searchParams.get('u') || '');
    if (!real || !/^https?:/i.test(real)) return null;
    try {
      const resp = await handle(new Request(u.href), real);
      if (!resp.ok) return null;
      const raw = await resp.text();
      // handle() already rewrote the stylesheet's url()s — rewriting again double-wrapped
      // every font/image URL (→ https://cdn.host/Browser/~/?u=… → 404/522, icons as □).
      const css = raw;
      return { tag, css: css.replace(/<\/style/gi, '<\\/style') };
    } catch {
      return null;
    }
  });
  const results = await Promise.all(jobs);
  for (const r of results) {
    if (r) html = html.replace(r.tag, '<style data-ht-inlined="1">' + r.css + '</style>');
  }
  return html;
}

// Per-site compatibility CSS.
function siteFixes(targetUrl) {
  let host = '';
  try { host = new URL(targetUrl).hostname; } catch {}
  // Bing's bot check hides #b_content (inline visibility:hidden) until it has
  // seen human input AND reloaded with &rdr=1 — which never completes inside a
  // proxied frame, so the results flashed and then vanished. Keep them shown.
  if (/(^|\.)bing\.com$/i.test(host)) return '<style>#b_content{visibility:visible!important}</style>';

  // YouTube: from datacenter IPs the main player often shows "Sign in to confirm you're
  // not a bot". The embedded player (the one MatTube uses) still plays, so when the wall
  // appears we overlay the embed for the same video.
  if (/(^|\.)youtube\.com$/i.test(host)) {
    return '<script>(function(){' +
      'var ov=null,oid=null;' +
      'function vid(){var m=location.pathname.match(/^\\/(?:shorts|live|embed)\\/([\\w-]{11})/);if(m)return m[1];' +
      'if(location.pathname==="/watch"){var v=new URLSearchParams(location.search).get("v");return v&&/^[\\w-]{11}$/.test(v)?v:null}return null}' +
      'function wall(){var e=document.querySelector("yt-player-error-message-renderer,.ytp-error,.ytp-error-content-wrap");' +
      'return !!(e&&/not a bot|confirm you|sign in to|LOGIN_REQUIRED|unavailable|error occurred|try again later|playback ID/i.test(e.textContent||""))}' +
      'function drop(){if(ov&&ov.parentNode)ov.parentNode.removeChild(ov);ov=null;oid=null}' +
      'function tick(){try{if(location.pathname.indexOf("/embed/")===0)return;var id=vid();' +
      'if(!id){if(ov)drop();return}' +
      'if(ov&&oid!==id)drop();' +
      'if(!ov&&wall()){var host=document.querySelector("#player-container-outer,#player-container,#player,#movie_player");' +
      'if(!host)return;var cs=getComputedStyle(host);if(cs.position==="static")host.style.position="relative";' +
      'ov=document.createElement("iframe");oid=id;' +
      'ov.src="https://www.youtube-nocookie.com/embed/"+id+"?autoplay=1&rel=0&playsinline=1";' +
      'ov.setAttribute("allow","autoplay; fullscreen; encrypted-media; picture-in-picture");ov.setAttribute("allowfullscreen","");' +
      'ov.setAttribute("data-ht-embed","1");ov.style.cssText="position:absolute;inset:0;width:100%;height:100%;border:0;z-index:2147483000;background:#000";' +
      'host.appendChild(ov)}}catch(e){}}' +
      'setInterval(tick,700)})()</script>';
  }
  return '';
}

// ── runtime injection ────────────────────────────────────────────────────
// <base href> of the ORIGINAL page (we strip the tag, but JS-made relative URLs must still
// resolve against it — e.g. games that live in a /public_games/123/ folder).
function findBase(html, targetUrl) {
  try {
    const m = /<base\b[^>]*?\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(html.slice(0, 20000));
    if (!m) return '';
    const abs = new URL((m[1] || m[2] || m[3] || '').replace(/&amp;/g, '&'), targetUrl).href;
    return abs === targetUrl ? '' : abs;
  } catch { return ''; }
}

function injectRuntime(html, targetUrl, baseUrl, isTop) {
  // Inline the runtime: painted (document.write) frames and strict-CSP-ish
  // pages can be flaky about loading external scripts, but fetches through
  // the SW always work — so ship the runtime inside the HTML itself.
  const tag =
    `<script>window.__HT_REAL_URL__=${JSON.stringify(targetUrl)};${baseUrl ? 'window.__HT_BASE__=' + JSON.stringify(baseUrl) + ';' : ''}</script>` +
    `<script>${runtimeSource().replace(/<\/script/gi, '<\\/script')}</script>` +
    siteFixes(targetUrl) + extInject(targetUrl, !!isTop);
  if (/<head[^>]*>/i.test(html)) return html.replace(/<head[^>]*>/i, (m) => m + tag);
  if (/<html[^>]*>/i.test(html)) return html.replace(/<html[^>]*>/i, (m) => m + tag);
  return tag + html;
}
