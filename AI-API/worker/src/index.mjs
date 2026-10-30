/**
 * htmltools.me AI API — OpenAI-compatible gateway on Cloudflare Workers.
 *
 * Router policy: explicit allowlist. Anything not listed below returns
 * `404 {"error":{"code":"not_found"}}`. There is no public completion endpoint,
 * no "test" route and no wildcard proxy, so the Worker cannot be used to drain the
 * Workers AI allowance without a valid htmltools.me API key.
 *
 *   Public (no AI work):
 *     GET  /health
 *     GET  /public/status
 *
 *   OpenAI-compatible (Bearer ht-… key):
 *     GET  /v1/models
 *     POST /v1/chat/completions
 *
 *   Account (Firebase ID token):
 *     GET  /account/me
 *     GET  /account/keys          POST /account/keys
 *     POST /account/keys/:id/revoke
 *     POST /account/keys/:id/reveal
 *     GET  /account/usage
 *     GET  /account/byok          POST /account/byok       DELETE /account/byok
 *
 *   Admin (Firebase ID token + ADMIN_UIDS + ADMIN_PASSPHRASE):
 *     GET  /admin/roster          POST /admin/keys/:id/revoke
 *     GET  /admin/stats           POST /admin/sync
 *
 *   Site assistant (Firebase ID token, no user API key):
 *     POST /siloai/chat           (POST /htsilo/chat is a deprecated alias)
 */

import {
  corsHeaders, errorResponse, json, newRequestId, logEvent, readJson, utcDay,
} from './util.mjs';
import { displayName, bearer, verifyIdToken, userRef } from './firebase.mjs';
import { generateKey, keyId as deriveKeyId, newSalt, hashKey } from './keys.mjs';
import { byokContext, decryptSecret, encryptSecret, escrowContext } from './crypto.mjs';
import { AUTO_MODEL, AUTO_BYOK_MODEL, AUTO_FREE_MODEL, modelsPayload, resolveModel } from './models.mjs';
import { normalizeChatRequest, callWorkersAI, callGroq, verifyGroqKey } from './providers.mjs';
import { siloaiSystemPrompt, publicBase, SILOAI_MODEL } from './siloai.mjs';

export { GatewayState } from './state.mjs';

const VERSION = '1.0.0';
const MAX_CHAT_BODY = 128 * 1024;
const MAX_ACCOUNT_BODY = 8 * 1024;
const FRESH_AUTH_SECONDS = 300;

/* ── helpers ──────────────────────────────────────────────────────────────── */

const DOCS_URL = 'https://htmltools.me/AI-API/Docs/';
const SETUP_URL = 'https://htmltools.me/AI-API/README.md#5-deployment';

/**
 * Deployment readiness, reported without any secret values.
 * `required` entries stop the gateway from working at all; the rest degrade features.
 */
function readiness(env) {
  const enabled = value => String(value ?? 'true').trim().toLowerCase() !== 'false';
  const checks = {
    storage: Boolean(env.GATEWAY),
    workersAi: Boolean(env.AI),
    firebase: Boolean(env.FIREBASE_PROJECT_ID),
    keyPepper: Boolean(env.KEY_PEPPER),
    roster: Boolean(env.GITHUB_TOKEN && env.GITHUB_REPO),
    byok: Boolean(env.BYOK_ENCRYPTION_KEY),
    admin: Boolean(env.ADMIN_PASSPHRASE && (env.ADMIN_UIDS || env.ADMIN_EMAILS)),
    escrow: Boolean(env.KEY_ESCROW_SECRET),
    siloai: enabled(env.SILOAI_ENABLED ?? env.HTSILO_ENABLED),
  };
  const required = ['storage', 'workersAi', 'firebase', 'keyPepper'];
  const missing = required.filter(name => !checks[name]);
  const fixes = {
    storage: 'Add the Durable Object binding GATEWAY (class GatewayState, SQLite-backed) and apply the v1 migration. `npx wrangler deploy` does both.',
    workersAi: 'Add the Workers AI binding named AI.',
    firebase: 'Set the FIREBASE_PROJECT_ID variable to general-database-4cb1c.',
    keyPepper: 'Set the KEY_PEPPER secret: npx wrangler secret put KEY_PEPPER',
    roster: 'Optional: set GITHUB_REPO and the GITHUB_TOKEN secret to mirror the roster to your private repo.',
    byok: 'Optional: set BYOK_ENCRYPTION_KEY to allow users to connect a Groq key.',
    admin: 'Optional: set ADMIN_PASSPHRASE, ADMIN_UIDS and ADMIN_EMAILS to use the admin tab.',
    escrow: 'Optional but recommended: set KEY_ESCROW_SECRET so owners can view a key again.',
    siloai: 'SiloAI is switched off by SILOAI_ENABLED=false.',
  };
  return {
    status: missing.length ? 'degraded' : 'ready',
    missing,
    checks,
    fixes: Object.fromEntries(Object.entries(fixes).filter(([k]) => (missing.includes(k) || !checks[k]))),
  };
}

function storageMissing() {
  return Object.assign(new Error('The gateway storage binding (GATEWAY) is not configured.'), { code: 'misconfigured' });
}

async function doCall(env, op, payload) {
  if (!env.GATEWAY) throw storageMissing();
  let res;
  try {
    res = await env.GATEWAY.get(env.GATEWAY.idFromName('global')).fetch(`https://gateway.internal/${op}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload || {}),
    });
  } catch (error) {
    // The binding exists but the class was never migrated, or storage is unavailable.
    throw Object.assign(
      new Error('The gateway storage class could not be reached. The GATEWAY Durable Object binding is present but its migration has not been applied.'),
      { code: 'storage_unavailable', cause: error },
    );
  }
  if (!res.ok) {
    let message = 'Gateway storage error.';
    try { message = (await res.json()).message || message; } catch { /* ignore */ }
    throw Object.assign(new Error(message), { code: 'storage_error' });
  }
  return res.json();
}

function finalize(response, request, env, requestId, mode = 'api', extra = {}) {
  const headers = new Headers(response.headers);
  for (const [k, v] of Object.entries(corsHeaders(request, env, mode))) headers.set(k, v);
  headers.set('x-request-id', requestId);
  for (const [k, v] of Object.entries(extra)) {
    if (v === undefined || v === null) continue;
    headers.set(k, String(v));
  }
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function apiError(status, message, type, code, headers = {}) {
  return errorResponse(status, message, type, code, headers);
}

function quotaError(result, requestId) {
  const headers = {};
  if (result.retryAfter) headers['retry-after'] = String(result.retryAfter);
  if (result.pool) {
    headers['x-ht-pool-remaining'] = String(result.pool.remaining ?? '');
  }
  const type = result.status === 401 ? 'invalid_request_error' : 'insufficient_quota';
  return {
    response: apiError(result.status, result.message, type, result.code, headers),
    headers,
  };
}

function adminList(env, name) {
  return String(env[name] || '')
    .split(',')
    .map(s => s.trim().toLowerCase())
    .filter(Boolean);
}

function isAdmin(user, env) {
  if (!user) return false;
  if (adminList(env, 'ADMIN_UIDS').includes(String(user.uid).toLowerCase())) return true;
  if (user.emailVerified && adminList(env, 'ADMIN_EMAILS').includes(String(user.email).toLowerCase())) return true;
  return false;
}

function authFailure(error) {
  const code = error?.code || 'auth_failed';
  const map = {
    auth_missing: [401, 'Sign in first: this endpoint needs a Firebase ID token.'],
    auth_malformed: [401, 'That sign-in token is not valid. Sign in again.'],
    auth_expired: [401, 'Your session expired. Sign in again.'],
    auth_wrong_project: [401, 'That account belongs to a different Firebase project. Use the AI-API sign-in.'],
    auth_bad_signature: [401, 'That sign-in token failed verification. Sign in again.'],
    auth_verification_failed: [401, 'Could not verify sign-in token. Try again shortly.'],
    auth_misconfigured: [500, 'Sign-in is not configured on the server yet.'],
  };
  const [status, message] = map[code] || [401, 'Sign-in could not be verified.'];
  return { status, message, code };
}

async function requireUser(request, env) {
  try {
    const user = await verifyIdToken(bearer(request), env, env.__fetch || fetch);
    return { ok: true, user };
  } catch (error) {
    return { ok: false, ...authFailure(error) };
  }
}

function requireFresh(user) {
  if (!user.authTime) return false;
  return Date.now() / 1000 - user.authTime <= FRESH_AUTH_SECONDS;
}

function requirePassphrase(request, env) {
  if (!env.ADMIN_PASSPHRASE) return { ok: false, code: 'admin_disabled' };
  const supplied = request.headers.get('x-ht-admin-passphrase') || '';
  // Length check first, then a constant-time comparison.
  if (supplied.length !== env.ADMIN_PASSPHRASE.length) return { ok: false, code: 'bad_passphrase' };
  let diff = 0;
  for (let i = 0; i < supplied.length; i++) diff |= supplied.charCodeAt(i) ^ env.ADMIN_PASSPHRASE.charCodeAt(i);
  return diff === 0 ? { ok: true } : { ok: false, code: 'bad_passphrase' };
}

async function clientIp(request) {
  return request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
}

function tooManyRequests(message = 'Too many requests. Retry in a minute.', retryAfter = 60) {
  return { response: apiError(429, message, 'rate_limit_exceeded', 'rate_limit_exceeded', { 'retry-after': String(retryAfter) }), headers: { 'retry-after': String(retryAfter) } };
}

/* ── public routes ────────────────────────────────────────────────────────── */

// Unauthenticated, so it must be cheap: a short per-isolate cache keeps polling
// visitors from turning into Durable Object traffic.
let publicStatusCache = { at: 0, body: null };

async function handlePublicStatus(request, env, requestId) {
  if (publicStatusCache.body && Date.now() - publicStatusCache.at < 10_000) {
    return finalize(json(publicStatusCache.body, 200, { 'cache-control': 'public, max-age=10' }), request, env, requestId, 'api');
  }
  const status = await doCall(env, 'publicStatus', {
    models: modelsPayload(env, { hasByok: true }).data.map(m => ({
      id: m.id, label: m.x_ht.label, provider: m.x_ht.provider,
      free: m.x_ht.free_pool, requires_byok: Boolean(m.x_ht.requires_byok),
      available: m.x_ht.free_pool,
      streaming: m.x_ht.streaming, tools: m.x_ht.tools, max_output_tokens: m.x_ht.max_output_tokens,
    })),
  });
  publicStatusCache = { at: Date.now(), body: status };
  return finalize(json(status, 200, { 'cache-control': 'public, max-age=10' }), request, env, requestId, 'api');
}

/* ── /v1 ──────────────────────────────────────────────────────────────────── */

async function handleModels(request, env, requestId) {
  const key = bearer(request);
  if (!key) return finalize(apiError(401, 'Missing API key. Send `Authorization: Bearer ht-…`.', 'invalid_request_error', 'invalid_api_key'), request, env, requestId);

  // Authenticate a cheap quota-neutral check: the key must exist and be live.
  const auth = await doCall(env, 'authorize', {
    key, ip: '', provider: 'workers-ai', modelId: '', maxOutput: 0, inputTokens: 0, isFreePool: false, context: 'models',
  });
  if (!auth.ok) return finalize(quotaError(auth).response, request, env, requestId);

  const byok = await doCall(env, 'byokStatus', { uid: auth.uid });
  const payload = modelsPayload(env, { hasByok: Boolean(byok.connected) });
  return finalize(json(payload, 200, { 'cache-control': 'no-store' }), request, env, requestId, 'api', {
    'x-ratelimit-limit-requests': String(auth.limits?.perKeyRpm ?? ''),
  });
}

async function handleChat(request, env, ctx, requestId) {
  const key = bearer(request);
  if (!key) return finalize(apiError(401, 'Missing API key. Send `Authorization: Bearer ht-…`.', 'invalid_request_error', 'invalid_api_key'), request, env, requestId);

  const body = await readJson(request, MAX_CHAT_BODY);
  if (!body.ok) {
    return finalize(apiError(body.status, body.message, 'invalid_request_error', 'invalid_request'), request, env, requestId);
  }

  let modelId = typeof body.value.model === 'string' ? body.value.model.trim() : '';
  if (!modelId) return finalize(apiError(400, '`model` is required. Call GET /v1/models for the allowlist.', 'invalid_request_error', 'model_required', {}, 'model'), request, env, requestId);

  // `auto` prefers the caller's own Groq key, then the shared free pool.
  let autoResolved = null;
  if (modelId === AUTO_MODEL) {
    const probeUid = deriveKeyId(key);
    if (!probeUid) return finalize(apiError(401, 'That API key is not valid.', 'invalid_request_error', 'invalid_api_key'), request, env, requestId);
    // Cheap lookup of the key owner so BYOK can be resolved before authorisation.
    const owner = await doCall(env, 'ownerForKey', { keyId: probeUid });
    autoResolved = owner?.ok && owner.hasByok ? AUTO_BYOK_MODEL : AUTO_FREE_MODEL;
    modelId = autoResolved;
  }

  const model = resolveModel(modelId);
  if (!model) {
    return finalize(apiError(400, `Model "${modelId.slice(0, 80)}" is not on this gateway's allowlist. See GET /v1/models.`, 'invalid_request_error', 'model_not_found', {}, 'model'), request, env, requestId);
  }

  const normalized = normalizeChatRequest(body.value, model);
  if (!normalized.ok) {
    return finalize(apiError(400, normalized.message, 'invalid_request_error', normalized.code || 'invalid_request', {}, normalized.param || null), request, env, requestId);
  }
  const req = normalized.value;

  const isFreePool = model.provider === 'workers-ai';
  const ip = await clientIp(request);
  const auth = await doCall(env, 'authorize', {
    key, ip, provider: model.provider, modelId: model.id,
    maxOutput: req.maxTokens, inputTokens: req.inputTokens, isFreePool, context: 'chat',
  });
  if (!auth.ok) {
    logEvent(env, { event: 'denied', code: auth.code, model: model.id, day: utcDay() });
    return finalize(quotaError(auth).response, request, env, requestId);
  }

  const usageHeaders = {
    'x-ratelimit-limit-requests': String(auth.limits?.perKeyRpm ?? ''),
    'x-ht-pool-remaining': String(auth.limits?.freePool?.remaining ?? ''),
    'x-ht-daily-remaining': String(auth.limits?.remainingToday ?? ''),
  };

  const settle = async usage => {
    await doCall(env, 'settle', {
      keyId: auth.keyId, uid: auth.uid, reservation: auth.reservation, reservationId: auth.reservationId,
      isFreePool, inputTokens: usage.inputTokens || req.inputTokens,
      outputTokens: usage.outputTokens || 0, success: true,
    }).catch(() => {});
  };

  const started = Date.now();
  let result;
  try {
    if (model.provider === 'workers-ai') {
      result = await callWorkersAI(env, model, req, { requestId });
    } else {
      const stored = await doCall(env, 'byokGet', { uid: auth.uid });
      if (!stored.ok) {
        await doCall(env, 'settle', { keyId: auth.keyId, uid: auth.uid, reservation: auth.reservation, reservationId: auth.reservationId, isFreePool: false, success: false }).catch(() => {});
        return finalize(apiError(400, 'This model needs your own Groq API key. Connect one at https://htmltools.me/AI-API/Dashboard/.', 'invalid_request_error', 'provider_not_connected', {}, 'model'), request, env, requestId);
      }
      const groqKey = await decryptSecret(stored.record.blob, env.BYOK_ENCRYPTION_KEY, byokContext(auth.uid, 'groq'), 'BYOK_ENCRYPTION_KEY');
      result = await callGroq(env, model, req, groqKey, { requestId, fetchImpl: env.__fetch || fetch });
    }
  } catch (error) {
    await doCall(env, 'settle', { keyId: auth.keyId, uid: auth.uid, reservation: auth.reservation, reservationId: auth.reservationId, isFreePool, success: false }).catch(() => {});
    logEvent(env, { event: 'provider_error', provider: model.provider, model: model.id, code: String(error?.code || 'error').slice(0, 60), ms: Date.now() - started });
    const status = Number(error?.status) || (error?.code === 'ciphertext_undecryptable' ? 409 : 502);
    const message = String(error?.message || 'The provider request failed.').slice(0, 300);
    return finalize(apiError(status, message, 'upstream_error', error?.code || 'provider_error'), request, env, requestId);
  }

  if (result.streamed) {
    ctx.waitUntil(result.usage.then(settle).catch(() => {}));
    logEvent(env, { event: 'chat', stream: true, provider: model.provider, model: model.id, key: auth.keyId, ms: Date.now() - started, pool: auth.limits?.freePool?.remaining });
    return finalize(result.response, request, env, requestId, 'api', usageHeaders);
  }

  const usage = await result.usage;
  await settle(usage);
  logEvent(env, {
    event: 'chat', stream: false, provider: model.provider, model: model.id, key: auth.keyId,
    in: usage.inputTokens, out: usage.outputTokens, ms: Date.now() - started,
  });
  return finalize(result.response, request, env, requestId, 'api', usageHeaders);
}

/* ── /account ─────────────────────────────────────────────────────────────── */

async function handleAccount(request, env, ctx, requestId, path, user) {
  const ip = await clientIp(request);
  const limited = await doCall(env, 'limitCheck', { scope: 'account', key: `${user.uid}:${ip}`, limit: 40, windowSec: 60 }).catch(() => ({ ok: true }));
  if (!limited.ok) return finalize(tooManyRequests().response, request, env, requestId, 'site');

  if (path === '/account/me' && request.method === 'GET') {
    const byok = await doCall(env, 'byokStatus', { uid: user.uid });
    return finalize(json({
      uid: user.uid,
      ref: userRef(user.uid),
      name: displayName(user),
      email: user.email,
      emailVerified: user.emailVerified,
      provider: user.signInProvider,
      admin: isAdmin(user, env),
      fresh: requireFresh(user),
      byok: { connected: Boolean(byok.connected), provider: byok.provider, updated: byok.updated, verified: byok.verified },
      baseUrl: new URL(request.url).origin + '/v1',
      pool: (await doCall(env, 'publicStatus', { models: [] })).pool,
    }), request, env, requestId, 'site');
  }

  if (path === '/account/keys' && request.method === 'GET') {
    const keys = await doCall(env, 'listKeys', { uid: user.uid });
    const usage = await doCall(env, 'usage', { uid: user.uid });
    return finalize(json({ keys: keys.keys, usage: usage.usage, escrow: Boolean(env.KEY_ESCROW_SECRET) }), request, env, requestId, 'site');
  }

  if (path === '/account/keys' && request.method === 'POST') {
    const body = await readJson(request, MAX_ACCOUNT_BODY);
    if (!body.ok) return finalize(apiError(body.status, body.message, 'invalid_request_error', 'invalid_request'), request, env, requestId, 'site');
    const label = typeof body.value.label === 'string' ? body.value.label.trim().slice(0, 60) : '';
    if (!env.KEY_PEPPER) {
      return finalize(apiError(500, 'Key creation is not configured on the server (KEY_PEPPER secret missing).', 'server_error', 'misconfigured'), request, env, requestId, 'site');
    }
    const plaintext = generateKey();
    const id = deriveKeyId(plaintext);
    const salt = newSalt();
    const hash = await hashKey(plaintext, salt, env.KEY_PEPPER);
    let escrow = null;
    if (env.KEY_ESCROW_SECRET) {
      escrow = await encryptSecret(plaintext, env.KEY_ESCROW_SECRET, escrowContext(id), 'KEY_ESCROW_SECRET').catch(() => null);
    }
    const created = await doCall(env, 'createKey', {
      uid: user.uid, name: displayName(user), email: user.email,
      label, salt, hash, escrow, keyId: id,
    });
    if (!created.ok) return finalize(apiError(400, created.message, 'invalid_request_error', created.code || 'key_limit'), request, env, requestId, 'site');
    logEvent(env, { event: 'key_created', key: id, user: userRef(user.uid) });
    return finalize(json({
      key: plaintext,
      id,
      record: created.record,
      notice: 'Copy this key now. It cannot be shown again unless escrow is enabled by the operator.',
      baseUrl: new URL(request.url).origin + '/v1',
    }, 201), request, env, requestId, 'site');
  }

  const keyMatch = /^\/account\/keys\/(ht-[a-z0-9]{10})\/(revoke|reveal)$/.exec(path);
  if (keyMatch) {
    if (request.method !== 'POST') return finalize(apiError(405, 'Use POST for this endpoint.', 'invalid_request_error', 'method_not_allowed'), request, env, requestId, 'site');
    const [, id, action] = keyMatch;

    if (action === 'revoke') {
      const result = await doCall(env, 'revokeKey', { uid: user.uid, keyId: id });
      if (!result.ok) return finalize(apiError(result.code === 'forbidden' ? 403 : 404, result.message, 'invalid_request_error', result.code), request, env, requestId, 'site');
      logEvent(env, { event: 'key_revoked', key: id, user: userRef(user.uid) });
      return finalize(json({ revoked: true, record: result.record }), request, env, requestId, 'site');
    }

    // reveal: sensitive → requires a password/Google re-auth within 5 minutes and
    // only if the operator opted into escrow.
    if (!requireFresh(user)) {
      return finalize(apiError(403, 'Confirm your password again (sign in within the last 5 minutes) to view a key.', 'invalid_request_error', 'reauth_required'), request, env, requestId, 'site');
    }
    if (!env.KEY_ESCROW_SECRET) {
      return finalize(apiError(409, 'Keys are stored as one-way hashes on this deployment, so they cannot be shown again. Create a new key instead.', 'invalid_request_error', 'key_not_recoverable'), request, env, requestId, 'site');
    }
    const limitedReveal = await doCall(env, 'limitCheck', { scope: 'reveal', key: `${user.uid}:${id}`, limit: 5, windowSec: 300 });
    if (!limitedReveal.ok) return finalize(tooManyRequests('Too many reveal attempts. Try again in a few minutes.').response, request, env, requestId, 'site');
    const record = await doCall(env, 'getKey', { keyId: id, uid: user.uid });
    if (!record.ok) return finalize(apiError(record.code === 'forbidden' ? 403 : 404, record.message, 'invalid_request_error', record.code), request, env, requestId, 'site');
    if (!record.record.escrow) {
      return finalize(apiError(409, 'This key was created before escrow was enabled, so it cannot be shown again.', 'invalid_request_error', 'key_not_recoverable'), request, env, requestId, 'site');
    }
    try {
      const plaintext = await decryptSecret(record.record.escrow, env.KEY_ESCROW_SECRET, escrowContext(id), 'KEY_ESCROW_SECRET');
      logEvent(env, { event: 'key_revealed', key: id, user: userRef(user.uid) });
      return finalize(json({ key: plaintext, id }), request, env, requestId, 'site');
    } catch {
      return finalize(apiError(409, 'This key could not be decrypted. The escrow secret may have been rotated.', 'server_error', 'ciphertext_undecryptable'), request, env, requestId, 'site');
    }
  }

  if (path === '/account/usage' && request.method === 'GET') {
    const usage = await doCall(env, 'usage', { uid: user.uid });
    return finalize(json(usage.usage), request, env, requestId, 'site');
  }

  if (path === '/account/byok') {
    if (request.method === 'GET') {
      const status = await doCall(env, 'byokStatus', { uid: user.uid });
      return finalize(json({ ...status, encryptionConfigured: Boolean(env.BYOK_ENCRYPTION_KEY) }), request, env, requestId, 'site');
    }
    if (request.method === 'POST') {
      if (!requireFresh(user)) return finalize(apiError(403, 'Confirm your password again to store a provider key.', 'invalid_request_error', 'reauth_required'), request, env, requestId, 'site');
      if (!env.BYOK_ENCRYPTION_KEY) return finalize(apiError(500, 'BYOK encryption is not configured on the server.', 'server_error', 'misconfigured'), request, env, requestId, 'site');
      const body = await readJson(request, MAX_ACCOUNT_BODY);
      if (!body.ok) return finalize(apiError(body.status, body.message, 'invalid_request_error', 'invalid_request'), request, env, requestId, 'site');
      const provider = String(body.value.provider || 'groq');
      if (provider !== 'groq') return finalize(apiError(400, 'Only provider "groq" is supported.', 'invalid_request_error', 'unsupported_provider'), request, env, requestId, 'site');
      const apiKey = typeof body.value.key === 'string' ? body.value.key.trim() : '';
      const verified = await verifyGroqKey(apiKey, env.__fetch || fetch);
      if (!verified.ok) return finalize(apiError(400, verified.message, 'invalid_request_error', 'invalid_provider_key'), request, env, requestId, 'site');
      const blob = await encryptSecret(apiKey, env.BYOK_ENCRYPTION_KEY, byokContext(user.uid, 'groq'), 'BYOK_ENCRYPTION_KEY');
      const stored = await doCall(env, 'byokSet', { uid: user.uid, ref: userRef(user.uid), provider: 'groq', blob, verified: true });
      logEvent(env, { event: 'byok_saved', user: userRef(user.uid) });
      return finalize(json({ connected: true, provider: 'groq', updated: stored.updated, verified: true }), request, env, requestId, 'site');
    }
    if (request.method === 'DELETE') {
      await doCall(env, 'byokDelete', { uid: user.uid });
      logEvent(env, { event: 'byok_deleted', user: userRef(user.uid) });
      return finalize(json({ connected: false }), request, env, requestId, 'site');
    }
  }

  return finalize(apiError(404, 'No such account endpoint.', 'invalid_request_error', 'not_found'), request, env, requestId, 'site');
}

/* ── /admin ───────────────────────────────────────────────────────────────── */

async function handleAdmin(request, env, requestId, path, user) {
  if (!isAdmin(user, env)) {
    return finalize(apiError(403, 'This endpoint is restricted to the gateway operator.', 'invalid_request_error', 'forbidden'), request, env, requestId, 'site');
  }
  if (!requireFresh(user)) {
    return finalize(apiError(403, 'Sign in again within the last 5 minutes to use admin tools.', 'invalid_request_error', 'reauth_required'), request, env, requestId, 'site');
  }
  const pass = requirePassphrase(request, env);
  if (!pass.ok) {
    return finalize(apiError(pass.code === 'admin_disabled' ? 503 : 403,
      pass.code === 'admin_disabled'
        ? 'Admin tools are disabled: set the ADMIN_PASSPHRASE secret and re-deploy.'
        : 'Admin passphrase is missing or incorrect.',
      'invalid_request_error', pass.code), request, env, requestId, 'site');
  }

  if (path === '/admin/diagnostics' && request.method === 'GET') {
    const ready = readiness(env);
    let storage = ready.checks.storage;
    if (storage) {
      try { await doCall(env, 'publicStatus', { models: [] }); storage = 'ok'; }
      catch (error) { storage = `error: ${String(error?.code || 'unknown')}`; }
    }
    return finalize(json({
      ...ready,
      checks: { ...ready.checks, storage },
      limits: await doCall(env, 'publicStatus', { models: [] }).then(s => s.pool).catch(() => null),
      config: {
        publicApiBase: publicBase(env, request),
        rosterRepo: env.GITHUB_REPO ? 'configured' : 'not configured',
        siloaiModel: env.SILOAI_MODEL || env.HTSILO_MODEL || SILOAI_MODEL,
        freeDailyNeurons: env.FREE_DAILY_NEURONS || '6000',
      },
      docs: DOCS_URL,
    }), request, env, requestId, 'site');
  }

  if (path === '/admin/roster' && request.method === 'GET') {
    const roster = await doCall(env, 'roster', {});
    return finalize(json({
      ...roster,
      escrow: Boolean(env.KEY_ESCROW_SECRET),
      keys: roster.keys.map(k => ({
        id: k.id, uid: k.uid, name: k.name, email: k.email, label: k.label,
        created: k.created, lastUsed: k.lastUsed, revoked: Boolean(k.revoked), revokedAt: k.revokedAt,
        usage: k.usage, recoverable: Boolean(k.escrow),
      })),
    }), request, env, requestId, 'site');
  }

  if (path === '/admin/stats' && request.method === 'GET') {
    return finalize(json(await doCall(env, 'adminStats', {})), request, env, requestId, 'site');
  }

  if (path === '/admin/sync' && request.method === 'POST') {
    return finalize(json(await doCall(env, 'syncNow', {})), request, env, requestId, 'site');
  }

  const adminReveal = /^\/admin\/keys\/(ht-[a-z0-9]{10})\/reveal$/.exec(path);
  if (adminReveal && request.method === 'POST') {
    if (!env.KEY_ESCROW_SECRET) {
      return finalize(apiError(409, 'Escrow is not enabled on this deployment, so keys cannot be recovered.', 'invalid_request_error', 'key_not_recoverable'), request, env, requestId, 'site');
    }
    const limited = await doCall(env, 'limitCheck', { scope: 'admin-reveal', key: `admin:${user.uid}`, limit: 10, windowSec: 300 });
    if (!limited.ok) return finalize(tooManyRequests('Too many reveal attempts. Try again in a few minutes.').response, request, env, requestId, 'site');
    const record = await doCall(env, 'getKey', { keyId: adminReveal[1], asAdmin: true });
    if (!record.ok) return finalize(apiError(404, record.message, 'invalid_request_error', record.code), request, env, requestId, 'site');
    if (!record.record.escrow) {
      return finalize(apiError(409, 'That key was created before escrow was enabled, so it cannot be recovered.', 'invalid_request_error', 'key_not_recoverable'), request, env, requestId, 'site');
    }
    try {
      const plaintext = await decryptSecret(record.record.escrow, env.KEY_ESCROW_SECRET, escrowContext(adminReveal[1]), 'KEY_ESCROW_SECRET');
      logEvent(env, { event: 'key_revealed_admin', key: adminReveal[1], user: userRef(user.uid) });
      return finalize(json({ key: plaintext, id: adminReveal[1], owner: { name: record.record.name, email: record.record.email } }), request, env, requestId, 'site');
    } catch {
      return finalize(apiError(409, 'This key could not be decrypted. The escrow secret may have been rotated.', 'server_error', 'ciphertext_undecryptable'), request, env, requestId, 'site');
    }
  }

  const revoke = /^\/admin\/keys\/(ht-[a-z0-9]{10})\/revoke$/.exec(path);
  if (revoke && request.method === 'POST') {
    const result = await doCall(env, 'revokeKey', { keyId: revoke[1], asAdmin: true });
    if (!result.ok) return finalize(apiError(404, result.message, 'invalid_request_error', result.code), request, env, requestId, 'site');
    logEvent(env, { event: 'key_revoked_admin', key: revoke[1] });
    return finalize(json({ revoked: true, record: result.record }), request, env, requestId, 'site');
  }

  return finalize(apiError(404, 'No such admin endpoint.', 'invalid_request_error', 'not_found'), request, env, requestId, 'site');
}

/* ── SiloAI ───────────────────────────────────────────────────────────────── */

async function handleSiloAI(request, env, requestId, user) {
  if (String(env.SILOAI_ENABLED ?? env.HTSILO_ENABLED ?? 'true') === 'false') {
    return finalize(apiError(503, 'SiloAI is switched off right now.', 'server_error', 'disabled'), request, env, requestId, 'site');
  }
  const body = await readJson(request, 16 * 1024);
  if (!body.ok) return finalize(apiError(body.status, body.message, 'invalid_request_error', 'invalid_request'), request, env, requestId, 'site');

  const raw = Array.isArray(body.value.messages) ? body.value.messages.slice(-8) : [];
  const messages = [];
  let chars = 0;
  for (const message of raw) {
    const role = message?.role === 'assistant' ? 'assistant' : 'user';
    const content = typeof message?.content === 'string' ? message.content.slice(0, 2000) : '';
    if (!content.trim()) continue;
    chars += content.length;
    messages.push({ role, content });
  }
  if (!messages.length || messages[messages.length - 1].role !== 'user') {
    return finalize(apiError(400, '"messages" must end with a user message.', 'invalid_request_error', 'invalid_request'), request, env, requestId, 'site');
  }
  if (chars > 4000) {
    return finalize(apiError(413, 'That message is too long for SiloAI (4,000 characters max).', 'invalid_request_error', 'request_too_large'), request, env, requestId, 'site');
  }

  const model = resolveModel(env.SILOAI_MODEL || env.HTSILO_MODEL || SILOAI_MODEL);
  if (!model) return finalize(apiError(503, 'The SiloAI model is not enabled on this gateway.', 'server_error', 'model_not_found'), request, env, requestId, 'site');

  const ip = await clientIp(request);
  const auth = await doCall(env, 'siteAuthorize', {
    uid: user.uid, ip, provider: 'workers-ai', modelId: model.id, maxOutput: 320, inputTokens: Math.ceil(chars / 4), kind: 'siloai',
  });
  if (!auth.ok) {
    const retry = auth.retryAfter ? { 'retry-after': String(auth.retryAfter) } : {};
    return finalize(apiError(auth.status, auth.message, 'insufficient_quota', auth.code, retry), request, env, requestId, 'site');
  }

  const prompt = {
    messages: [{ role: 'system', content: siloaiSystemPrompt(body.value.page, publicBase(env, request)) }, ...messages],
    maxTokens: 320,
    temperature: 0.6,
    stream: false,
    inputTokens: Math.ceil(chars / 4),
  };

  try {
    const result = await callWorkersAI(env, model, prompt, { requestId });
    const payload = await result.response.json();
    const usage = await result.usage;
    await doCall(env, 'settle', {
      keyId: '', uid: user.uid, reservation: auth.reservation, reservationId: auth.reservationId, isFreePool: true,
      inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, success: true,
    }).catch(() => {});
    return finalize(json({
      reply: payload.choices?.[0]?.message?.content || 'I did not get an answer that time — try asking again.',
      remaining: auth.remaining,
      model: model.id,
    }), request, env, requestId, 'site');
  } catch (error) {
    await doCall(env, 'settle', { keyId: '', uid: user.uid, reservation: auth.reservation, reservationId: auth.reservationId, isFreePool: true, success: false }).catch(() => {});
    return finalize(apiError(502, 'SiloAI could not reach the model. Try again in a moment.', 'upstream_error', 'provider_error'), request, env, requestId, 'site');
  }
}

/* ── router ───────────────────────────────────────────────────────────────── */

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';
    const requestId = newRequestId();

    if (request.method === 'OPTIONS') {
      const mode = path.startsWith('/v1') ? 'api' : 'site';
      return new Response(null, { status: 204, headers: { ...corsHeaders(request, env, mode), 'x-request-id': requestId } });
    }

    try {
      if (path === '/health' && request.method === 'GET') {
        const ready = readiness(env);
        // Prove the Durable Object actually answers; a bound-but-unmigrated class
        // otherwise looks healthy until the first real request.
        if (ready.checks.storage) {
          try {
            await doCall(env, 'publicStatus', { models: [] });
            ready.checks.storage = 'ok';
          } catch {
            ready.checks.storage = 'error';
            ready.status = 'degraded';
            if (!ready.missing.includes('storage')) ready.missing.push('storage');
          }
        }
        return finalize(json({
          ok: ready.status === 'ready',
          status: ready.status,
          service: 'htmltools-me-ai-api',
          version: VERSION,
          ...ready,
          docs: DOCS_URL,
        }), request, env, requestId, 'site', { 'cache-control': 'no-store' });
      }

      if (path === '/public/status' && request.method === 'GET') {
        return await handlePublicStatus(request, env, requestId);
      }

      if (path === '/v1/models' && request.method === 'GET') {
        return await handleModels(request, env, requestId);
      }

      if (path === '/v1/chat/completions') {
        if (request.method !== 'POST') {
          return finalize(apiError(405, 'Use POST for /v1/chat/completions.', 'invalid_request_error', 'method_not_allowed', { allow: 'POST' }), request, env, requestId);
        }
        return await handleChat(request, env, ctx, requestId);
      }

      const isSilo = path === '/siloai/chat' || path === '/htsilo/chat';
      const needsUser = path.startsWith('/account') || path.startsWith('/admin') || isSilo;
      if (needsUser) {
        const auth = await requireUser(request, env);
        if (!auth.ok) {
          return finalize(apiError(auth.status, auth.message, 'invalid_request_error', auth.code), request, env, requestId, 'site');
        }
        if (path.startsWith('/account')) return await handleAccount(request, env, ctx, requestId, path, auth.user);
        if (path.startsWith('/admin')) return await handleAdmin(request, env, requestId, path, auth.user);
        if (isSilo) {
          if (request.method !== 'POST') {
            return finalize(apiError(405, 'Use POST for /siloai/chat.', 'invalid_request_error', 'method_not_allowed'), request, env, requestId, 'site');
          }
          const response = await handleSiloAI(request, env, requestId, auth.user);
          if (path === '/htsilo/chat') response.headers.set('deprecation', 'true');
          return response;
        }
      }

      // Everything else is a hard 404. No proxy, no public test route.
      if (path.startsWith('/v1')) {
        return finalize(apiError(404, `No such API endpoint: ${path.slice(0, 60)}. See https://htmltools.me/AI-API/Docs/.`, 'invalid_request_error', 'not_found'), request, env, requestId);
      }
      return finalize(json({ error: { message: 'Not found.', type: 'invalid_request_error', code: 'not_found' } }, 404), request, env, requestId, 'site');
    } catch (error) {
      const code = String(error?.code || 'error').slice(0, 60);
      logEvent(env, { event: 'unhandled', code, message: String(error?.message || '').slice(0, 160) });
      const mode = path.startsWith('/v1') ? 'api' : 'site';

      // Setup problems are the operator's to fix and must never look like a crash:
      // 503 + the exact missing piece, so the dashboard can say what to do.
      if (code === 'misconfigured' || code === 'storage_unavailable') {
        const ready = readiness(env);
        return finalize(json({
          error: {
            message: 'The gateway is not fully configured yet, so this feature is unavailable. The owner needs to finish setup.',
            type: 'server_error',
            code: 'not_configured',
            param: null,
            setup: { missing: ready.missing, fixes: ready.fixes, docs: DOCS_URL },
          },
        }, 503), request, env, requestId, mode);
      }
      if (code === 'storage_error') {
        return finalize(apiError(503, 'The gateway storage layer returned an error. Try again in a moment; if it persists the owner should check the Worker logs.', 'server_error', 'storage_error'), request, env, requestId, mode);
      }

      return finalize(
        apiError(500, 'The gateway hit an unexpected error. If it persists, the operator needs to check the Worker logs.', 'server_error', 'internal_error'),
        request, env, requestId, mode,
      );
    }
  },
};
