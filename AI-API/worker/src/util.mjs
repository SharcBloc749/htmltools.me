/* Small shared helpers: JSON responses, OpenAI-shaped errors, CORS, hashing, limits. */

export const DAY_MS = 86_400_000;

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...headers },
  });
}

/**
 * OpenAI-compatible error envelope. `code` is a stable machine-readable string so
 * clients can branch on it (`free_pool_exhausted`, `model_not_found`, ...).
 */
export function oaiError(status, message, type, code, param = null) {
  return { error: { message, type, param, code } };
}

export function errorResponse(status, message, type, code, headers = {}, param = null) {
  return json(oaiError(status, message, type, code, param), status, headers);
}

export function nowSec() {
  return Math.floor(Date.now() / 1000);
}

export function utcDay(ms = Date.now()) {
  return new Date(ms).toISOString().slice(0, 10);
}

export function nextUtcMidnight(ms = Date.now()) {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
}

export function newRequestId() {
  return 'req_' + crypto.randomUUID().replace(/-/g, '').slice(0, 24);
}

export function logEvent(env, event) {
  // Metadata only. Never pass prompts, completions, API keys or tokens here.
  try {
    console.log(JSON.stringify({ at: new Date().toISOString(), ...event }));
  } catch {
    console.log('{"event":"log_failed"}');
  }
}

/* ── bytes / encoding ─────────────────────────────────────────────────────── */

export function bytesToHex(buffer) {
  return [...new Uint8Array(buffer)].map(b => b.toString(16).padStart(2, '0')).join('');
}

export function bytesToBase64(buffer) {
  let s = '';
  for (const b of new Uint8Array(buffer)) s += String.fromCharCode(b);
  return btoa(s);
}

export function base64ToBytes(value) {
  const s = atob(value);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export function base64urlToBytes(value) {
  const pad = value.length % 4 === 0 ? '' : '='.repeat(4 - (value.length % 4));
  return base64ToBytes(value.replace(/-/g, '+').replace(/_/g, '/') + pad);
}

export function textToBase64url(text) {
  const bytes = new TextEncoder().encode(text);
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Constant-time-ish string compare. Length mismatch returns early (length is public). */
export function constantTimeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function estimateTokens(text) {
  if (!text) return 0;
  return Math.max(1, Math.ceil(String(text).length / 4));
}

export function estimateMessageTokens(messages) {
  let chars = 0;
  for (const m of messages || []) {
    if (typeof m?.content === 'string') chars += m.content.length;
    else if (Array.isArray(m?.content)) chars += JSON.stringify(m.content).length;
    chars += 8;
  }
  return Math.max(1, Math.ceil(chars / 4));
}

/* ── request body limits ──────────────────────────────────────────────────── */

export async function readJson(request, maxBytes) {
  const declared = Number(request.headers.get('content-length') || 0);
  if (declared && declared > maxBytes) {
    return { ok: false, status: 413, message: `Request body exceeds ${Math.floor(maxBytes / 1024)} KB.` };
  }
  let text;
  try {
    text = await request.text();
  } catch {
    return { ok: false, status: 400, message: 'Could not read request body.' };
  }
  if (new TextEncoder().encode(text).length > maxBytes) {
    return { ok: false, status: 413, message: `Request body exceeds ${Math.floor(maxBytes / 1024)} KB.` };
  }
  if (!text.trim()) return { ok: false, status: 400, message: 'Request body must be a JSON object.' };
  try {
    const value = JSON.parse(text);
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return { ok: false, status: 400, message: 'Request body must be a JSON object.' };
    }
    return { ok: true, value };
  } catch {
    return { ok: false, status: 400, message: 'Request body is not valid JSON.' };
  }
}

/* ── CORS ─────────────────────────────────────────────────────────────────── */

function parseOrigins(value) {
  return String(value || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
}

function originAllowed(origin, patterns) {
  if (!origin) return false;
  for (const pattern of patterns) {
    if (pattern === '*') return true;
    if (pattern === origin) return true;
    if (pattern.startsWith('*.') && origin === pattern.slice(2)) return true;
    if (pattern.startsWith('*.') && origin.endsWith(pattern.slice(1))) return true;
  }
  return false;
}

/**
 * Two CORS modes:
 *  - `api`:  the OpenAI-compatible surface. Defaults to `*` because third-party
 *            browser tools must be able to call it with a bearer key. No cookies,
 *            so a wildcard does not create a CSRF/ambient-authority problem.
 *  - `site`: the account/admin endpoints that accept Firebase ID tokens. Only the
 *            site's own origins are allowed.
 */
export function corsHeaders(request, env = {}, mode = 'api') {
  const origin = request.headers.get('origin') || '';
  const isSite = mode === 'site';
  const patterns = parseOrigins(
    isSite ? env.SITE_CORS_ORIGINS ?? 'https://htmltools.me,https://www.htmltools.me'
           : env.API_CORS_ORIGINS ?? '*',
  );
  const headers = {
    'access-control-allow-methods': 'GET, POST, DELETE, OPTIONS',
    'access-control-allow-headers': 'authorization, content-type, x-ht-admin-passphrase',
    'access-control-max-age': '86400',
    'vary': 'Origin',
  };
  if (originAllowed(origin, patterns)) {
    headers['access-control-allow-origin'] = patterns.includes('*') ? '*' : origin;
  }
  return headers;
}

/* ── model/provider limits ────────────────────────────────────────────────── */

/** Reject or clamp request parameters that could produce runaway output. */
export function clampInt(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(n)));
}
