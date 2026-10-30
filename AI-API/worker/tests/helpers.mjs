/* Test harness: real GatewayState (real hashing, quotas, GitHub rendering) with
 * in-memory storage, a mock Workers AI binding and locally signed Firebase tokens. */

import crypto from 'node:crypto';
import { GatewayState } from '../src/state.mjs';

export class MemoryStorage {
  constructor() {
    this.map = new Map();
    this.alarm = null;
  }
  async get(key) {
    if (Array.isArray(key)) return Object.fromEntries(key.map(k => [k, this.map.get(k)]));
    return this.map.get(key);
  }
  async put(key, value) {
    if (typeof key === 'object') {
      for (const [k, v] of Object.entries(key)) this.map.set(k, v);
      return;
    }
    this.map.set(key, value);
  }
  async delete(key) { this.map.delete(key); }
  async list({ prefix }) {
    const out = new Map();
    for (const [k, v] of this.map) if (!prefix || k.startsWith(prefix)) out.set(k, v);
    return out;
  }
  async getAlarm() { return this.alarm; }
  async setAlarm(time) { this.alarm = time; }
}

/** Create a Durable Object instance + a namespace stub that behaves like the real one. */
export function makeGateway(env, existing) {
  const storage = existing || new MemoryStorage();
  const fakeState = {
    storage,
    blockConcurrencyWhile(fn) { this.ready = Promise.resolve().then(fn); },
  };
  const instance = new GatewayState(fakeState, env);
  const ready = fakeState.ready || Promise.resolve();
  const namespace = {
    idFromName: name => name,
    get: () => ({
      fetch: async (url, init) => {
        await ready;
        return instance.fetch(new Request(url, init));
      },
    }),
  };
  return { instance, storage, namespace, ready };
}

export function makeAI(handler) {
  const calls = [];
  return {
    calls,
    async run(model, input) {
      calls.push({ model, input });
      return handler(model, input);
    },
  };
}

export function sseStream(chunks) {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

/* ── Firebase token signing ───────────────────────────────────────────────── */

export function makeSigner() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = publicKey.export({ format: 'jwk' });
  const kid = crypto.randomUUID().slice(0, 12);
  return {
    kid,
    jwks: { keys: [{ ...jwk, kid, alg: 'RS256', use: 'sig' }] },
    sign(claims = {}, options = {}) {
      const projectId = options.projectId || 'general-database-4cb1c';
      const now = Math.floor(Date.now() / 1000);
      const header = { alg: 'RS256', kid: options.kid || kid, typ: 'JWT' };
      const payload = {
        iss: options.iss || `https://securetoken.google.com/${projectId}`,
        aud: options.aud || projectId,
        sub: options.sub || claims.uid || 'uid_test',
        auth_time: options.authTime ?? now,
        iat: now,
        exp: options.exp ?? now + 3600,
        email: claims.email || 'tester@example.com',
        email_verified: claims.emailVerified ?? true,
        name: claims.name || 'Test User',
        firebase: { sign_in_provider: claims.provider || 'password', identities: {} },
        user_id: options.sub || claims.uid || 'uid_test',
      };
      const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
      const unsigned = `${b64(header)}.${b64(payload)}`;
      const signature = crypto.sign('RSA-SHA256', Buffer.from(unsigned), privateKey).toString('base64url');
      return `${unsigned}.${signature}`;
    },
    /** Sign a token with a different (untrusted) key but the same kid. */
    forge(claims = {}) {
      const other = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
      const now = Math.floor(Date.now() / 1000);
      const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
      const unsigned = `${b64({ alg: 'RS256', kid, typ: 'JWT' })}.${b64({
        iss: 'https://securetoken.google.com/general-database-4cb1c',
        aud: 'general-database-4cb1c',
        sub: claims.uid || 'uid_test',
        iat: now,
        exp: now + 3600,
        auth_time: now,
        email: 'tester@example.com',
        firebase: { sign_in_provider: 'password' },
      })}`;
      return `${unsigned}.${crypto.sign('RSA-SHA256', Buffer.from(unsigned), other.privateKey).toString('base64url')}`;
    },
  };
}

/* ── environment ──────────────────────────────────────────────────────────── */

export function makeEnv(overrides = {}) {
  const signer = makeSigner();
  const env = {
    FIREBASE_PROJECT_ID: 'general-database-4cb1c',
    KEY_PEPPER: 'test-pepper-0123456789abcdefghij',
    BYOK_ENCRYPTION_KEY: 'test-byok-secret-0123456789abcdef',
    __signer: signer,
    __requests: [],
    __fetch: async (url, init) => {
      env.__requests.push({ url: String(url), init });
      if (String(url).includes('service_accounts')) return Response.json(signer.jwks);
      if (String(url).includes('api.groq.com/openai/v1/models')) {
        return env.__groqModelsResponse || Response.json({ data: [{ id: 'llama-3.3-70b-versatile' }] });
      }
      if (String(url).includes('api.groq.com')) {
        if (env.__groqHandler) return env.__groqHandler(url, init);
        return Response.json({ error: { message: 'unexpected groq call' } }, { status: 500 });
      }
      throw new Error(`Unexpected network call in test: ${url}`);
    },
    ...overrides,
  };
  const gateway = makeGateway(env);
  env.GATEWAY = gateway.namespace;
  env.AI = overrides.AI || makeAI(() => ({ response: 'Hello from the mock model.', usage: { prompt_tokens: 12, completion_tokens: 6, total_tokens: 18 } }));
  env.__gateway = gateway;
  return env;
}

export function makeCtx() {
  const pending = [];
  return {
    pending,
    waitUntil(promise) { pending.push(Promise.resolve(promise)); },
    async settle() { await Promise.allSettled(pending); },
  };
}

export function apiRequest(path, { method = 'GET', token, key, body, origin, headers = {} } = {}) {
  const h = { origin: origin ?? 'https://htmltools.me', ...headers };
  if (token) h.authorization = `Bearer ${token}`;
  if (key) h.authorization = `Bearer ${key}`;
  if (body !== undefined) h['content-type'] = 'application/json';
  return new Request(`https://gateway.test${path}`, {
    method,
    headers: h,
    body: body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)),
  });
}

/** Create an account key through the real HTTP surface and return the plaintext key. */
export async function createAccountKey(worker, env, ctx, token, label = 'test key') {
  const res = await worker.fetch(apiRequest('/account/keys', { method: 'POST', token, body: { label } }), env, ctx);
  const body = await res.json();
  if (res.status !== 201) throw new Error(`key creation failed: ${res.status} ${JSON.stringify(body)}`);
  return body.key;
}

export async function readSSE(response) {
  const text = await response.text();
  return text
    .split('\n\n')
    .map(block => block.trim())
    .filter(Boolean)
    .map(block => {
      const line = block.startsWith('data:') ? block.slice(5).trim() : block;
      if (line === '[DONE]') return { done: true };
      try { return JSON.parse(line); } catch { return { raw: line }; }
    });
}
