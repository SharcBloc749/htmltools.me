import { base64ToText, textToBase64 } from './util.mjs';

const API = 'https://api.github.com';
const CACHE_TTL = 60;
const memoryCache = new Map();
const cacheKey = (siteId) => new Request(`https://siloai-cache.invalid/sites/${siteId}`);

function config(env) {
  if (!env.GITHUB_TOKEN || !env.GITHUB_REPO) throw Object.assign(new Error('Private storage is not configured.'), { code: 'storage_unavailable' });
  const path = String(env.GITHUB_DATA_PATH || 'SiloAI/sites').replace(/^\/+|\/+$/g, '');
  if (!/^[A-Za-z0-9_.\-/]+$/.test(path)) throw Object.assign(new Error('Invalid storage path.'), { code: 'storage_unavailable' });
  return { repo: env.GITHUB_REPO, token: env.GITHUB_TOKEN, root: path };
}

async function request(env, path, options = {}) {
  const { repo, token } = config(env);
  const response = await fetch(`${API}/repos/${repo}/contents/${path}`, {
    ...options,
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${token}`,
      'x-github-api-version': '2022-11-28',
      'user-agent': 'SiloAI-site-assistant',
      ...(options.body ? { 'content-type': 'application/json' } : {}),
      ...options.headers,
    },
  });
  return response;
}

async function githubFile(env, siteId) {
  const { root } = config(env);
  const response = await request(env, `${root}/${siteId}.json`);
  if (response.status === 404) return null;
  if (!response.ok) throw Object.assign(new Error(`Private site storage returned ${response.status}.`), { code: 'storage_error' });
  const data = await response.json();
  if (!data.content) return null;
  try { return { record: JSON.parse(base64ToText(data.content)), sha: data.sha }; }
  catch { throw Object.assign(new Error('A SiloAI site record is invalid JSON.'), { code: 'storage_corrupt' }); }
}

async function cacheRead(siteId) {
  const local = memoryCache.get(siteId);
  if (local && local.expiresAt > Date.now()) return local.record;
  if (local) memoryCache.delete(siteId);
  try {
    if (!globalThis.caches?.default) return null;
    const response = await caches.default.match(cacheKey(siteId));
    if (!response) return null;
    const record = await response.json();
    memoryCache.set(siteId, { record, expiresAt: Date.now() + CACHE_TTL * 1000 });
    return record;
  } catch { return null; }
}

async function cacheWrite(siteId, record) {
  memoryCache.set(siteId, { record, expiresAt: Date.now() + CACHE_TTL * 1000 });
  while (memoryCache.size > 100) memoryCache.delete(memoryCache.keys().next().value);
  try {
    if (!globalThis.caches?.default) return;
    await caches.default.put(cacheKey(siteId), new Response(JSON.stringify(record), {
      headers: { 'content-type': 'application/json', 'cache-control': `public, max-age=${CACHE_TTL}` },
    }));
  } catch { /* Cache API is an optimization; GitHub remains the source of truth. */ }
}

export async function readSite(env, siteId, { fresh = false } = {}) {
  if (!/^[a-f0-9]{24}$/.test(siteId)) return null;
  if (!fresh) {
    const cached = await cacheRead(siteId);
    if (cached) return cached;
  }
  const stored = await githubFile(env, siteId);
  if (!stored) return null;
  await cacheWrite(siteId, stored.record);
  return stored.record;
}

export async function writeSite(env, record) {
  const { root } = config(env);
  const path = `${root}/${record.id}.json`;
  let lastError;
  for (let attempt = 0; attempt < 2; attempt++) {
    const existing = await githubFile(env, record.id);
    const body = { message: `SiloAI: update site ${record.domain}`, content: textToBase64(JSON.stringify(record, null, 2)), branch: env.GITHUB_BRANCH || 'main' };
    if (existing?.sha) body.sha = existing.sha;
    const response = await request(env, path, { method: 'PUT', body: JSON.stringify(body) });
    if (response.ok) {
      try { await caches.default.delete(cacheKey(record.id)); } catch { /* optional */ }
      await cacheWrite(record.id, record);
      return record;
    }
    lastError = response.status;
    if (response.status !== 409 && response.status !== 422) break;
  }
  throw Object.assign(new Error(`Could not save the site record to GitHub (${lastError || 'network error'}).`), { code: 'storage_error' });
}
