// HTML Library — Games Worker (GitHub backend)
//
// Access restricted to:
//   - https://htmltools.me
//   - https://htmltool.nekoweb.org
//
// Cloudflare secrets needed:
//   - GITHUB_REPO (owner/repo)
//   - GITHUB_TOKEN (Personal Access Token)
// Optional:
//   - GITHUB_BRANCH (defaults to main)
//   - ASSETS (static assets binding)
//   - SITE_ORIGIN (separate HTTPS origin for the book HTML)
//
// Game HTML is capped at 1 MB (the GitHub Contents API per-file limit),
// matching the Studio uploader. Logo/background images live in meta, not
// in the HTML, so they never count toward that cap.

const ALLOWED_ORIGINS = new Set([
  "https://htmltools.me",
  "https://www.htmltools.me",
  "https://htmltool.nekoweb.org",
  "https://www.htmltool.nekoweb.org"
]);

function isAllowedOrigin(origin) {
  return typeof origin === "string" && ALLOWED_ORIGINS.has(origin.toLowerCase().trim());
}

const VALID_ID = /^[a-zA-Z0-9_-]+$/;
const FORBIDDEN_IDS = new Set(["__proto__", "prototype", "constructor"]);
function validId(id) {
  return typeof id === "string" && VALID_ID.test(id) && !FORBIDDEN_IDS.has(id);
}
const INDEX_TTL = 10;
const GAME_TTL = 300;
const NOT_FOUND_TTL = 30;
const CLIENT_CACHE = "public, max-age=0, must-revalidate";

export default {
  async fetch(request, env, ctx) {
    try {
      const url = new URL(request.url);
      const path = url.pathname;

      if (request.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: corsHeaders(request) });
      }

      if (path === "/github/index.json" && request.method === "GET") {
        return await cachedResponse(request, ctx, (res) => res.status === 200 ? INDEX_TTL : 0,
          () => handleGetIndex(request, env));
      }
      if (path.startsWith("/github/game/") && request.method === "GET") {
        const id = path.split("/").pop().replace(/\.html$/, "");
        return await cachedResponse(request, ctx,
          (res) => res.status === 200 ? GAME_TTL : res.status === 404 ? NOT_FOUND_TTL : 0,
          () => handleGetGame(id, request, env));
      }

      // Restricted POST writes (saves, deletions, repairs)
      if (request.method === "POST" &&
          ["/github/repair", "/github/saveGame", "/github/deleteGame"].includes(path)) {
        const denial = requireAllowedOrigin(request);
        if (denial) return denial;

        const res = path === "/github/repair" ? await handleRepair(request, env)
          : path === "/github/saveGame" ? await handleSaveGame(request, env)
          : await handleDeleteGame(request, env);
        if (res.ok) {
          const id = path === "/github/repair" ? null : (await res.clone().json()).id;
          ctx.waitUntil(purgeGameCaches(url, id).catch((e) => console.warn("Cache purge failed", e)));
        }
        return res;
      }

      if (/^\/Library\/book\/[^/]+\/?$/.test(path)) {
        return await serveBookPage(request, env);
      }

      if (path.startsWith("/github/")) return jsonResponse({ error: "Not found" }, 404, request);
      if (url.hostname.endsWith(".workers.dev")) {
        return jsonResponse({ error: "API Worker only; configure ASSETS or a separate site origin for pages" }, 404, request);
      }
      return await fetch(request);
    } catch (e) {
      console.error("Games Worker request failed", e);
      return jsonResponse({ error: "Worker request failed; check Workers Logs" }, 500, request);
    }
  },
};

// ── Origin verification ──────────────────────────────────────────────────────
function requireAllowedOrigin(request) {
  const origin = request.headers.get("Origin");
  if (!origin || !isAllowedOrigin(origin)) {
    return jsonResponse({ error: "Forbidden: Request origin not allowed" }, 403, request);
  }
  return null;
}

// ── Edge cache (best effort) ────────────────────────────────────────────────
async function cachedResponse(request, ctx, ttlForResponse, produce) {
  let cache;
  try { cache = caches.default; } catch (_) { /* no Cache API */ }
  if (!cache) return withCacheHeader(await produce(), "BYPASS", request);

  const url = new URL(request.url);
  const key = new Request(`${url.origin}${url.pathname}`, { method: "GET" });
  const conditionalHeaders = new Headers();
  for (const name of ["If-None-Match", "If-Modified-Since"]) {
    const value = request.headers.get(name);
    if (value) conditionalHeaders.set(name, value);
  }
  try {
    const hit = await cache.match(new Request(key.url, { headers: conditionalHeaders }));
    if (hit) return withCacheHeader(hit, "HIT", request);
  } catch (e) {
    console.warn("Cache lookup failed; using GitHub", e);
  }

  const res = await produce();
  const ttl = ttlForResponse(res);
  if (ttl > 0 && !/\b(no-store|private)\b/i.test(res.headers.get("Cache-Control") || "")) {
    try {
      const copy = res.clone();
      const headers = new Headers(copy.headers);
      for (const name of ["Access-Control-Allow-Origin", "Access-Control-Allow-Credentials",
        "Access-Control-Allow-Methods", "Access-Control-Allow-Headers", "Access-Control-Max-Age"]) {
        headers.delete(name);
      }
      headers.delete("Set-Cookie");
      headers.set("Cache-Control", `public, s-maxage=${ttl}`);
      const forCache = new Response(copy.body, {
        status: copy.status, statusText: copy.statusText, headers,
      });
      ctx.waitUntil(cache.put(key, forCache).catch((e) => console.warn("Cache write failed", e)));
    } catch (e) {
      console.warn("Could not prepare cache entry", e);
    }
  }
  return withCacheHeader(res, "MISS", request);
}

function withCacheHeader(res, value, request) {
  const headers = new Headers(res.headers);
  headers.set("X-Cache", value);
  headers.set("Cache-Control", res.status >= 500 || /\bno-store\b/i.test(res.headers.get("Cache-Control") || "")
    ? "no-store" : CLIENT_CACHE);
  applyCors(headers, request);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

async function purgeGameCaches(url, id) {
  let cache;
  try { cache = caches.default; } catch (_) { return; }
  if (!cache) return;
  const base = `${url.origin}/github`;
  const keys = [`${base}/index.json`];
  if (id && validId(id)) keys.push(`${base}/game/${id}`, `${base}/game/${id}.html`);
  await Promise.all(keys.map((key) => cache.delete(new Request(key, { method: "GET" }))));
}

// ── HTTP / CORS / encoding ───────────────────────────────────────────────────
function corsHeaders(request) {
  const origin = request.headers.get("Origin") || "";
  // Reflect origin only if it is in the whitelist, otherwise fallback to first allowed domain
  const allowOrigin = isAllowedOrigin(origin) ? origin : "https://htmltools.me";
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, If-None-Match, If-Match",
    "Access-Control-Max-Age": "86400",
    "Access-Control-Allow-Credentials": "true",
    "Vary": "Origin",
  };
}

function applyCors(headers, request) {
  const cors = corsHeaders(request);
  for (const [key, value] of Object.entries(cors)) {
    if (key !== "Vary") headers.set(key, value);
  }
  if (!/(^|,)\s*Origin\s*(,|$)/i.test(headers.get("Vary") || "")) {
    headers.set("Vary", [headers.get("Vary"), "Origin"].filter(Boolean).join(", "));
  }
}

function jsonResponse(obj, status, request, extra = {}) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...corsHeaders(request), ...extra },
  });
}

function htmlResponse(html, status, request, extra = {}) {
  return new Response(html, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", ...corsHeaders(request), ...extra },
  });
}

function b64EncodeUnicode(str) {
  const bytes = new TextEncoder().encode(str);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 32768) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
  }
  return btoa(binary);
}

function b64DecodeUnicode(b64) {
  const binary = atob(b64.replace(/\s/g, ""));
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function etagMatches(request, etag) {
  const given = request.headers.get("If-None-Match");
  if (!given || !etag) return false;
  const normalize = (s) => s.trim().replace(/^W\//i, "");
  return given.split(",").some((part) => part.trim() === "*" || normalize(part) === normalize(etag));
}

function notModified(request, etag) {
  return new Response(null, { status: 304,
    headers: { ...corsHeaders(request), ETag: etag, "Cache-Control": CLIENT_CACHE } });
}

function sanitizeMeta(meta) {
  const copy = { ...meta };
  for (const key of ["logoImage", "bgImage"]) {
    if (typeof copy[key] === "string" && copy[key].startsWith("data:") && copy[key].length > 20000) {
      copy[key] = null;
    }
  }
  for (const key of Object.keys(copy)) {
    if (typeof copy[key] === "string" && copy[key].length > 100000) copy[key] = copy[key].slice(0, 100000);
  }
  return copy;
}

function githubConfig(env) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(env.GITHUB_REPO || "") || !env.GITHUB_TOKEN) return null;
  return {
    repo: env.GITHUB_REPO,
    branch: env.GITHUB_BRANCH || "main",
    token: env.GITHUB_TOKEN,
    headers: {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`, "User-Agent": "htmltools-worker",
      Accept: "application/vnd.github+json", "Content-Type": "application/json",
    },
  };
}

function apiFileUrl(cfg, path) {
  return `https://api.github.com/repos/${cfg.repo}/contents/${path}?ref=${encodeURIComponent(cfg.branch)}`;
}

function rawFileUrl(cfg, path) {
  return `https://raw.githubusercontent.com/${cfg.repo}/${cfg.branch}/${path}`;
}

async function fetchRaw(cfg, path) {
  return fetch(rawFileUrl(cfg, path), {
    headers: { Authorization: `Bearer ${cfg.token}`, "User-Agent": "htmltools-worker" },
    cf: { cacheTtl: 0 },
  });
}

async function contentsObject(cfg, path) {
  const response = await fetch(apiFileUrl(cfg, path), { headers: cfg.headers });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`GitHub read ${path} failed (${response.status})`);
  const data = await response.json();
  if (!data || typeof data.sha !== "string") throw new Error(`Missing GitHub SHA for ${path}`);
  if (data.encoding === "base64" && typeof data.content === "string" && data.content) {
    return { sha: data.sha, text: b64DecodeUnicode(data.content) };
  }
  const blob = await fetch(`https://api.github.com/repos/${cfg.repo}/git/blobs/${encodeURIComponent(data.sha)}`,
    { headers: cfg.headers });
  if (!blob.ok) throw new Error(`GitHub blob read failed (${blob.status})`);
  const object = await blob.json();
  if (object.encoding !== "base64" || !object.content) throw new Error(`GitHub blob has no content for ${path}`);
  return { sha: data.sha, text: b64DecodeUnicode(object.content) };
}

function parseIndex(text) {
  const parsed = JSON.parse(text);
  if (!parsed || typeof parsed !== "object" || !parsed.games ||
      typeof parsed.games !== "object" || Array.isArray(parsed.games)) {
    throw new Error("index.json must be an object containing games");
  }
  return parsed;
}

async function indexForWrite(cfg) {
  const file = await contentsObject(cfg, "Games/index.json");
  return file ? { sha: file.sha, index: parseIndex(file.text) }
    : { sha: null, index: { version: 0, games: {} } };
}

async function putFile(cfg, path, message, content, sha) {
  return fetch(`https://api.github.com/repos/${cfg.repo}/contents/${path}`, {
    method: "PUT", headers: cfg.headers,
    body: JSON.stringify({ message, content: b64EncodeUnicode(content), sha: sha || undefined, branch: cfg.branch }),
  });
}

// ── Public GitHub GET endpoints ──────────────────────────────────────────────
async function handleGetIndex(request, env) {
  const cfg = githubConfig(env);
  if (!cfg) return jsonResponse({ error: "Missing GitHub configuration" }, 500, request);

  try {
    const raw = await fetchRaw(cfg, "Games/index.json");
    if (raw.ok) {
      const text = await raw.text();
      const parsed = parseIndex(text);
      const etag = raw.headers.get("ETag");
      if (etag && etagMatches(request, etag)) return notModified(request, etag);
      return jsonResponse(parsed, 200, request,
        { ...(etag ? { ETag: etag } : {}), "Cache-Control": CLIENT_CACHE, "X-Served-By": "github-raw" });
    }
  } catch (e) {
    console.warn("GitHub RAW index unavailable; trying API", e);
  }
  try {
    const file = await contentsObject(cfg, "Games/index.json");
    if (!file) return jsonResponse({ version: 0, games: {} }, 200, request);
    const parsed = parseIndex(file.text);
    const etag = `"${file.sha}"`;
    if (etagMatches(request, etag)) return notModified(request, etag);
    return jsonResponse(parsed, 200, request,
      { ETag: etag, "Cache-Control": CLIENT_CACHE, "X-GitHub-SHA": file.sha, "X-Served-By": "github" });
  } catch (e) {
    console.error("GitHub index read failed", e);
    return jsonResponse({ error: "Could not read GitHub index; check Workers Logs" }, 502, request);
  }
}

async function handleGetGame(id, request, env) {
  if (!validId(id)) return jsonResponse({ error: "Invalid ID" }, 400, request);
  const cfg = githubConfig(env);
  if (!cfg) return jsonResponse({ error: "Missing GitHub configuration" }, 500, request);
  const path = `Games/${id}.html`;
  try {
    const raw = await fetchRaw(cfg, path);
    if (raw.ok) {
      const html = await raw.text();
      const etag = raw.headers.get("ETag");
      if (etag && etagMatches(request, etag)) return notModified(request, etag);
      return htmlResponse(html, 200, request,
        { ...(etag ? { ETag: etag } : {}), "Cache-Control": CLIENT_CACHE, "X-Served-By": "github-raw" });
    }
  } catch (e) {
    console.warn("GitHub RAW game unavailable; trying API", e);
  }
  try {
    const file = await contentsObject(cfg, path);
    if (!file) return jsonResponse({ error: "Game not found", id }, 404, request,
      { "Cache-Control": CLIENT_CACHE });
    const etag = `"${file.sha}"`;
    if (etagMatches(request, etag)) return notModified(request, etag);
    return htmlResponse(file.text, 200, request,
      { ETag: etag, "Cache-Control": CLIENT_CACHE, "X-GitHub-SHA": file.sha, "X-Served-By": "github" });
  } catch (e) {
    console.error("GitHub game read failed", e);
    return jsonResponse({ error: "Could not read GitHub game; check Workers Logs" }, 502, request);
  }
}

// ── Handlers for writes ──────────────────────────────────────────────────────
async function handleRepair(request, env) {
  const cfg = githubConfig(env);
  if (!cfg) return jsonResponse({ error: "Missing GitHub configuration" }, 500, request);
  try {
    const body = await request.json();
    const submitted = body.full || body;
    if (!submitted || !submitted.games || typeof submitted.games !== "object" || Array.isArray(submitted.games)) {
      return jsonResponse({ error: "Missing games object" }, 400, request);
    }
    const games = {};
    for (const [id, meta] of Object.entries(submitted.games)) {
      if (!validId(id) || !meta || typeof meta !== "object" || Array.isArray(meta)) {
        return jsonResponse({ error: "Invalid game ID or metadata" }, 400, request);
      }
      games[id] = sanitizeMeta(meta);
    }
    const next = { version: Date.now(), games };
    const get = await fetch(apiFileUrl(cfg, "Games/index.json"), { headers: cfg.headers });
    if (get.status !== 404 && !get.ok) throw new Error(`GitHub index SHA read failed (${get.status})`);
    const sha = get.ok ? (await get.json()).sha : null;
    if (get.ok && !sha) throw new Error("GitHub index SHA missing");
    const put = await putFile(cfg, "Games/index.json", `repair index - ${Object.keys(games).length} games`,
      JSON.stringify(next, null, 2), sha);
    if (!put.ok) throw new Error(`GitHub index repair failed (${put.status})`);
    return jsonResponse({ ok: true, games: Object.keys(games).length, version: next.version }, 200, request);
  } catch (e) {
    console.error("Repair failed", e);
    return jsonResponse({ error: "Repair failed; check Workers Logs" }, 502, request);
  }
}

async function handleSaveGame(request, env) {
  const cfg = githubConfig(env);
  if (!cfg) return jsonResponse({ error: "Missing GitHub configuration" }, 500, request);
  let id;
  let htmlSaved = false;
  try {
    const body = await request.json();
    ({ id } = body);
    const { html, meta } = body;
    if (!validId(id)) return jsonResponse({ error: "Invalid ID" }, 400, request);
    // 1 MB of actual code bytes — the GitHub Contents API per-file cap the
    // Studio client now enforces too. Logo/background images live in meta
    // (not the HTML), so they never count toward this.
    if (typeof html !== "string" || !html ||
        new TextEncoder().encode(html).length > 1_048_576 ||
        !meta || typeof meta !== "object" || Array.isArray(meta) ||
        typeof meta.title !== "string" || !meta.title.trim()) {
      return jsonResponse({ error: "Missing/invalid HTML or meta.title (HTML code limit: 1 MB — GitHub's per-file cap; logo/background images in meta don't count)" }, 400, request);
    }
    const cleanMeta = sanitizeMeta(meta);
    const path = `Games/${id}.html`;
    const check = await fetch(apiFileUrl(cfg, path), { headers: cfg.headers });
    if (check.status !== 404 && !check.ok) throw new Error(`GitHub HTML SHA read failed (${check.status})`);
    const sha = check.ok ? (await check.json()).sha : null;
    if (check.ok && !sha) throw new Error("GitHub HTML SHA missing");
    const saved = await putFile(cfg, path, `save game ${id}: ${cleanMeta.title}`, html, sha);
    if (!saved.ok) throw new Error(`GitHub HTML write failed (${saved.status})`);
    htmlSaved = true;

    for (let attempt = 0; attempt < 3; attempt++) {
      const { index, sha: indexSha } = await indexForWrite(cfg);
      index.version = Date.now();
      index.games[id] = { ...cleanMeta, updatedAt: Date.now(), id };
      const put = await putFile(cfg, "Games/index.json", `update index ${id}`,
        JSON.stringify(index, null, 2), indexSha);
      if (put.ok) return jsonResponse({ ok: true, id, version: index.version }, 200, request);
      if (put.status !== 409 || attempt === 2) throw new Error(`GitHub index write failed (${put.status})`);
      await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
    }
  } catch (e) {
    console.error("Save failed", e);
    return jsonResponse({ error: "Save failed; check Workers Logs", id, htmlSaved,
      ...(htmlSaved ? { hint: "HTML was saved but index was not updated; retry the save." } : {}) }, 502, request);
  }
}

async function handleDeleteGame(request, env) {
  const cfg = githubConfig(env);
  if (!cfg) return jsonResponse({ error: "Missing GitHub configuration" }, 500, request);
  let id;
  let indexUpdated = false;
  try {
    ({ id } = await request.json());
    if (!validId(id)) return jsonResponse({ error: "Invalid ID" }, 400, request);

    for (let attempt = 0; attempt < 3; attempt++) {
      const { index, sha } = await indexForWrite(cfg);
      if (!Object.hasOwn(index.games, id)) { indexUpdated = true; break; }
      delete index.games[id];
      index.version = Date.now();
      const put = await putFile(cfg, "Games/index.json", `delete index ${id}`,
        JSON.stringify(index, null, 2), sha);
      if (put.ok) { indexUpdated = true; break; }
      if (put.status !== 409 || attempt === 2) throw new Error(`GitHub index write failed (${put.status})`);
      await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
    }

    const path = `Games/${id}.html`;
    const check = await fetch(apiFileUrl(cfg, path), { headers: cfg.headers });
    if (check.status !== 404 && !check.ok) throw new Error(`GitHub HTML SHA read failed (${check.status})`);
    if (check.ok) {
      const sha = (await check.json()).sha;
      if (!sha) throw new Error("GitHub HTML SHA missing");
      const deleted = await fetch(`https://api.github.com/repos/${cfg.repo}/contents/${path}`, {
        method: "DELETE", headers: cfg.headers,
        body: JSON.stringify({ message: `delete game ${id}`, sha, branch: cfg.branch }),
      });
      if (!deleted.ok) throw new Error(`GitHub HTML deletion failed (${deleted.status})`);
    }
    return jsonResponse({ ok: true, id }, 200, request);
  } catch (e) {
    console.error("Delete failed", e);
    return jsonResponse({ error: "Delete failed; check Workers Logs", id, indexUpdated,
      ...(indexUpdated ? { hint: "Index is updated; HTML deletion may need retrying." } : {}) }, 502, request);
  }
}

// ── Book-page alias ──────────────────────────────────────────────────────────
async function serveBookPage(request, env) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return jsonResponse({ error: "Method not allowed" }, 405, request);
  }
  const alias = new URL(request.url);
  alias.pathname = "/Library/book/index.html";
  let originResponse;
  if (env.ASSETS && typeof env.ASSETS.fetch === "function") {
    originResponse = await env.ASSETS.fetch(new Request(alias.toString(), { method: request.method }));
  } else if (env.SITE_ORIGIN) {
    const base = new URL(env.SITE_ORIGIN);
    if (base.protocol !== "https:" || base.host === alias.host) {
      return jsonResponse({ error: "SITE_ORIGIN must be a separate HTTPS origin" }, 503, request);
    }
    const target = new URL("/Library/book/index.html", base);
    originResponse = await fetch(target.toString(), { method: request.method });
  } else if (alias.hostname.endsWith(".workers.dev")) {
    return jsonResponse({ error: "No book assets behind workers.dev; configure ASSETS or SITE_ORIGIN" }, 503, request);
  } else {
    originResponse = await fetch(alias.toString(), { method: request.method, headers: request.headers });
  }
  const headers = new Headers(originResponse.headers);
  headers.set("Cache-Control", CLIENT_CACHE);
  return new Response(originResponse.body, {
    status: originResponse.status, statusText: originResponse.statusText, headers,
  });
}