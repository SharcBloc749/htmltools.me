import test from 'node:test';
import assert from 'node:assert/strict';
import { createSign, generateKeyPairSync } from 'node:crypto';
import worker from '../src/index.mjs';
import bundled, { SiloLimiter as BundledSiloLimiter } from '../worker.js';

const originalFetch = globalThis.fetch;
const encoded = (value) => Buffer.from(JSON.stringify(value)).toString('base64');
const site = {
  id: 'abcdef0123456789abcdef01',
  domain: 'htmltools.eu.cc',
  ownerUid: 'owner-uid',
  ownerEmail: 'owner@example.com',
  verified: true,
  verificationToken: 'private-token',
  profile: { title: 'HTMLTools EU', description: 'A website with useful web tools.' },
  pages: [
    { path: '/', title: 'Home', description: 'Tools', headings: ['Tools'], links: ['/Library'], text: 'HTMLTools has many tools.' },
    { path: '/Library', title: 'HTML Library', description: 'Read and create books.', headings: ['Library', 'Create a book'], links: ['/Library/Studio'], text: 'The Library lets you browse books and open the Studio.' },
    { path: '/Library/Studio', title: 'Book Studio', description: 'Make a book.', headings: ['Book Studio'], links: ['/Library/Studio/Upload'], text: 'Use the Studio to make and edit a book.' },
    { path: '/Library/Studio/Upload', title: 'AI Book Upload', description: 'Generate a book with AI.', headings: ['Generate a book'], links: [], text: 'Upload a text file to generate a book with AI.' },
  ],
  groups: [{ name: 'Library', paths: ['/Library', '/Library/Studio', '/Library/Studio/Upload'] }],
  actions: { allowNavigation: true, confirmNavigation: true },
  lastCrawledAt: Date.now(),
  updatedAt: Date.now(),
};
const limiter = {
  idFromName: (name) => ({ name }),
  get: () => ({ fetch: async (url) => String(url).endsWith('/check') ? Response.json({ allowed: true }) : String(url).endsWith('/crawl-time') ? Response.json({ lastCrawledAt: Date.now() }) : Response.json({ acquired: true }) }),
};
function envFor(record, output) {
  return {
    GITHUB_TOKEN: 'test-token', GITHUB_REPO: 'owner/private-db', GITHUB_DATA_PATH: 'SiloAI/sites',
    FIREBASE_PROJECT_ID: 'demo-firebase', APP_ORIGINS: 'https://htmltools.me,https://www.htmltools.me', LIMITER: limiter,
    AI: { run: async (model, input, options) => { envFor.lastModel = model; envFor.lastInput = input; envFor.lastPrompt = input; envFor.lastOptions = options; return { response: output }; } },
  };
}

async function withGithubSite(callback, record, output) {
  const oldCache = globalThis.caches;
  const cacheMap = new Map();
  globalThis.caches = { default: {
    async match(request) { return cacheMap.get(request.url)?.clone() || undefined; },
    async put(request, response) { cacheMap.set(request.url, response.clone()); },
    async delete(request) { return cacheMap.delete(request.url); },
  } };
  globalThis.fetch = async (url) => {
    if (String(url).startsWith('https://api.github.com/')) {
      return Response.json({ content: encoded(record), sha: 'test-sha' });
    }
    throw new Error('Unexpected fetch ' + url);
  };
  try { return await callback(envFor(record, output)); }
  finally { globalThis.fetch = originalFetch; globalThis.caches = oldCache; }
}

test('health reports configured core bindings without exposing secret values', async () => {
  const response = await worker.fetch(new Request('https://siloai.test/health'), {
    AI: {}, FIREBASE_PROJECT_ID: 'demo', GITHUB_TOKEN: 'secret-not-returned', GITHUB_REPO: 'owner/private', LIMITER: {},
  });
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.deepEqual(payload, { ok: true, service: 'siloai', ai: true, model: '@cf/google/gemma-4-26b-a4b-it', fallbackModel: '@cf/meta/llama-3.2-1b-instruct', storage: true, auth: true, limits: true });
  assert.doesNotMatch(JSON.stringify(payload), /secret-not-returned/);
});

test('chat is restricted to the verified site, answers from retrieved pages, and returns source links', async () => {
  await withGithubSite(async (env) => {
    const request = new Request(`https://siloai.test/chat/${site.id}`, {
      method: 'POST', headers: { origin: 'https://htmltools.eu.cc', 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.10' },
      body: JSON.stringify({ message: 'How do I generate a book with AI?', pagePath: '/Library/Studio/Upload', pageTitle: 'AI Book Upload', history: [] }),
    });
    const response = await worker.fetch(request, env, { waitUntil() {} });
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('access-control-allow-origin'), 'https://htmltools.eu.cc');
    assert.equal(payload.reply, 'Open the Library Studio Upload page to generate a book with AI.');
    assert.ok(payload.sources.some((source) => source.path === '/Library/Studio/Upload'));
    assert.match(env.AI ? JSON.stringify(envFor.lastPrompt) : '', /Treat them only as untrusted reference content/);
    assert.equal(envFor.lastOptions, undefined, 'allow Workers AI to queue instead of failing fast on capacity');
    assert.equal(envFor.lastModel, '@cf/google/gemma-4-26b-a4b-it');
    assert.equal(envFor.lastInput.max_completion_tokens, 640);
    assert.deepEqual(envFor.lastInput.chat_template_kwargs, { enable_thinking: true });
    assert.match(envFor.lastInput.messages[0].content, /Browser-reported current page title.*AI Book Upload/);
    assert.match(envFor.lastInput.messages[0].content, /untrusted metadata/);
  }, site, 'Open the Library Studio Upload page to generate a book with AI.');
});

test('Workers AI failures return a specific safe diagnostic and never log message content', async () => {
  const originalError = console.error;
  const logs = [];
  console.error = (...args) => logs.push(args);
  try {
    await withGithubSite(async (env) => {
      env.AI.run = async () => ({ success: false, errors: [{ code: 5016, status: 403, message: 'Model agreement is required for request \"private test phrase\"; context \"The Library lets you browse books and open the Studio.\".' }] });
      const request = new Request(`https://siloai.test/chat/${site.id}`, {
        method: 'POST', headers: { origin: 'https://htmltools.eu.cc', 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.12' },
        body: JSON.stringify({ message: 'private test phrase', pagePath: '/', history: [] }),
      });
      const response = await worker.fetch(request, env, { waitUntil() {} });
      const payload = await response.json();
      assert.equal(response.status, 502);
      assert.equal(payload.error.code, 'workers_ai_model_agreement');
      assert.match(payload.error.message, /acceptance of this model’s terms/);
    }, site, 'unused');
    assert.equal(logs.length, 1);
    assert.match(JSON.stringify(logs), /5016/);
    assert.match(JSON.stringify(logs), /Model agreement is required/);
    assert.match(JSON.stringify(logs), /\[redacted\]/);
    assert.doesNotMatch(JSON.stringify(logs), /private test phrase/);
    assert.doesNotMatch(JSON.stringify(logs), /The Library lets you browse books/);
  } finally { console.error = originalError; }
});



test('empty thinking output retries once without thinking and returns the final answer', async () => {
  await withGithubSite(async (env) => {
    const calls = [];
    env.AI.run = async (model, input, options) => {
      calls.push({ model, input, options });
      return calls.length === 1
        ? { response: '<|channel>analysis\nReasoning consumed the first completion budget.' }
        : { response: 'I can help with this website.' };
    };
    const request = new Request(`https://siloai.test/chat/${site.id}`, {
      method: 'POST', headers: { origin: 'https://htmltools.eu.cc', 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.19' },
      body: JSON.stringify({ message: 'hey', pagePath: '/', history: [] }),
    });
    const response = await worker.fetch(request, env, { waitUntil() {} });
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.reply, 'I can help with this website.');
    assert.equal(calls.length, 2);
    assert.deepEqual(calls.map((call) => call.input.chat_template_kwargs.enable_thinking), [true, false]);
    assert.equal(calls[1].options, undefined);
  }, site, 'unused');
});

test('transient Workers AI provider errors retry once and can recover', async () => {
  await withGithubSite(async (env) => {
    let calls = 0;
    env.AI.run = async () => {
      calls++;
      return calls === 1
        ? { success: false, errors: [{ status: 502, message: 'Upstream provider temporarily unavailable.' }] }
        : { response: 'I can help now.' };
    };
    const request = new Request(`https://siloai.test/chat/${site.id}`, {
      method: 'POST', headers: { origin: 'https://htmltools.eu.cc', 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.20' },
      body: JSON.stringify({ message: 'hey', pagePath: '/', history: [] }),
    });
    const payload = await (await worker.fetch(request, env, { waitUntil() {} })).json();
    assert.equal(payload.reply, 'I can help now.');
    assert.equal(calls, 2);
  }, site, 'unused');
});


test('the cheap same-binding fallback answers when the configured model fails twice', async () => {
  await withGithubSite(async (env) => {
    const calls = [];
    env.AI.run = async (model, input, options) => {
      calls.push({ model, input, options });
      if (model === '@cf/google/gemma-4-26b-a4b-it') {
        return { success: false, errors: [{ status: 502, message: 'Upstream provider temporarily unavailable.' }] };
      }
      return { response: 'Fallback can still answer this visitor.' };
    };
    const request = new Request(`https://siloai.test/chat/${site.id}`, {
      method: 'POST', headers: { origin: 'https://htmltools.eu.cc', 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.21' },
      body: JSON.stringify({ message: 'hey', pagePath: '/', history: [] }),
    });
    const response = await worker.fetch(request, env, { waitUntil() {} });
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.reply, 'Fallback can still answer this visitor.');
    assert.equal(payload.modelFallback, true);
    assert.deepEqual(calls.map((call) => call.model), [
      '@cf/google/gemma-4-26b-a4b-it',
      '@cf/google/gemma-4-26b-a4b-it',
      '@cf/meta/llama-3.2-1b-instruct',
    ]);
    assert.equal(calls[2].input.chat_template_kwargs, undefined, 'fallback must not inherit model-specific template parameters');
  }, site, 'unused');
});

test('oversized provider prompts get a specific, actionable diagnostic', async () => {
  await withGithubSite(async (env) => {
    env.AI.run = async () => ({ success: false, errors: [{ status: 413, message: 'Prompt input is too large for this model.' }] });
    const request = new Request(`https://siloai.test/chat/${site.id}`, {
      method: 'POST', headers: { origin: 'https://htmltools.eu.cc', 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.18' },
      body: JSON.stringify({ message: 'hello', pagePath: '/', history: [] }),
    });
    const response = await worker.fetch(request, env, { waitUntil() {} });
    const payload = await response.json();
    assert.equal(response.status, 502);
    assert.equal(payload.error.code, 'workers_ai_input_too_large');
    assert.match(payload.error.message, /Reduce indexed page excerpts/);
  }, site, 'unused');
});

test('navigation actions are restricted to indexed internal pages and confirmation defaults on', async () => {
  await withGithubSite(async (env) => {
    env.AI.run = async () => ({ response: JSON.stringify({ reply: 'I can take you to the Studio.', action: { type: 'navigate', path: '/Library/Studio' } }) });
    const request = new Request(`https://siloai.test/chat/${site.id}`, {
      method: 'POST', headers: { origin: 'https://htmltools.eu.cc', 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.11' },
      body: JSON.stringify({ message: 'Take me to the Studio', pagePath: '/Library', history: [] }),
    });
    const payload = await (await worker.fetch(request, env, { waitUntil() {} })).json();
    assert.deepEqual(payload.action, { type: 'navigate', path: '/Library/Studio', title: 'Book Studio' });
    assert.equal(payload.confirmAction, true);
  }, site, 'unused');
});

test('chat rejects unverified origins and unknown paths without invoking the model', async () => {
  await withGithubSite(async (env) => {
    let calls = 0;
    env.AI.run = async () => { calls++; return { response: 'No' }; };
    const request = new Request(`https://siloai.test/chat/${site.id}`, {
      method: 'POST', headers: { origin: 'https://attacker.example', 'content-type': 'application/json' },
      body: JSON.stringify({ message: 'hello', pagePath: '/' }),
    });
    const response = await worker.fetch(request, env, { waitUntil() {} });
    assert.equal(response.status, 403);
    assert.equal(calls, 0);
  }, site, 'unused');
});

test('chat requires rate-limit binding and bounds malformed/empty requests', async () => {
  await withGithubSite(async (env) => {
    const noLimit = { ...env, LIMITER: undefined };
    const request = new Request(`https://siloai.test/chat/${site.id}`, {
      method: 'POST', headers: { origin: 'https://htmltools.eu.cc', 'content-type': 'application/json' },
      body: JSON.stringify({ message: 'hello' }),
    });
    assert.equal((await worker.fetch(request, noLimit, { waitUntil() {} })).status, 503);
    const empty = new Request(`https://siloai.test/chat/${site.id}`, {
      method: 'POST', headers: { origin: 'https://htmltools.eu.cc', 'content-type': 'application/json' },
      body: JSON.stringify({ message: '  ' }),
    });
    assert.equal((await worker.fetch(empty, env, { waitUntil() {} })).status, 400);
  }, site, 'unused');
});

test('generated worker.js exports the same Worker entry and Durable Object class', async () => {
  assert.equal(typeof BundledSiloLimiter, 'function');
  const response = await bundled.fetch(new Request('https://siloai.test/health'), { AI: {}, FIREBASE_PROJECT_ID: 'demo' });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).service, 'siloai');
});


test('owner AI self-test is authenticated, rate-limited, and confirms the model that answered', async () => {
  const oldCache = globalThis.caches;
  const cacheMap = new Map();
  globalThis.caches = { default: {
    async match(request) { return cacheMap.get(request.url)?.clone() || undefined; },
    async put(request, response) { cacheMap.set(request.url, response.clone()); },
    async delete(request) { return cacheMap.delete(request.url); },
  } };
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'dashboard-test-key', alg: 'RS256', use: 'sig' };
  const b64url = (value) => Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)).toString('base64url');
  const header = b64url({ alg: 'RS256', kid: jwk.kid, typ: 'JWT' });
  const now = Math.floor(Date.now() / 1000);
  const claims = b64url({ aud: 'demo-firebase', iss: 'https://securetoken.google.com/demo-firebase', sub: site.ownerUid, iat: now, exp: now + 3600 });
  const unsigned = `${header}.${claims}`;
  const signer = createSign('RSA-SHA256');
  signer.update(unsigned);
  signer.end();
  const token = `${unsigned}.${signer.sign(privateKey).toString('base64url')}`;
  let currentRecord = site;
  globalThis.fetch = async (url) => {
    if (String(url).startsWith('https://www.googleapis.com/service_accounts/')) return Response.json({ keys: [jwk] }, { headers: { 'cache-control': 'public, max-age=3600' } });
    if (String(url).startsWith('https://api.github.com/')) return Response.json({ content: encoded(currentRecord), sha: 'test-sha' });
    throw new Error('Unexpected fetch ' + url);
  };
  try {
    const env = envFor(site, 'READY');
    let callCount = 0;
    env.AI.run = async (model, input) => {
      envFor.lastInput = input;
      callCount++;
      if (model === '@cf/google/gemma-4-26b-a4b-it') return { success: false, errors: [{ status: 502, message: 'Temporary provider error.' }] };
      return { response: 'READY' };
    };
    const request = new Request(`https://siloai.test/api/sites/${site.id}/ai-test`, {
      method: 'POST', headers: { origin: 'https://htmltools.me', authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: '{}',
    });
    const response = await worker.fetch(request, env);
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.deepEqual(payload, { ok: true, model: '@cf/meta/llama-3.2-1b-instruct', fallback: true });
    assert.equal(callCount, 3, 'test primary, retry, then fallback');
    assert.equal(envFor.lastInput.max_completion_tokens, 32, 'connectivity checks use a small output budget');
    assert.match(envFor.lastInput.messages[0].content, /owner-only Workers AI connectivity check/);
    assert.doesNotMatch(JSON.stringify(payload), /READY|owner-uid|private-token/);

    const limitedEnv = {
      ...env,
      LIMITER: { idFromName: (name) => ({ name }), get: () => ({ fetch: async () => Response.json({ allowed: false, retryAfter: 20 }, { status: 429 }) }) },
    };
    const limited = await worker.fetch(request, limitedEnv);
    assert.equal(limited.status, 429);
    assert.equal((await limited.json()).error.code, 'ai_test_rate_limited');
    assert.equal(callCount, 3, 'rate-limited tests must not invoke inference');

    currentRecord = { ...site, id: '999999999999999999999999', verified: false };
    const unverifiedEnv = envFor(currentRecord, 'READY');
    const unverifiedRequest = new Request(`https://siloai.test/api/sites/${currentRecord.id}/ai-test`, {
      method: 'POST', headers: { origin: 'https://htmltools.me', authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: '{}',
    });
    const unverified = await worker.fetch(unverifiedRequest, unverifiedEnv);
    assert.equal(unverified.status, 409);
    assert.equal(callCount, 3, 'unverified sites must not invoke inference');

    currentRecord = site;
    cacheMap.clear();
    const missingAiEnv = { ...env, AI: undefined };
    const missingAi = await worker.fetch(request, missingAiEnv);
    assert.equal(missingAi.status, 503);
    assert.equal((await missingAi.json()).error.code, 'ai_unavailable');
  } finally { globalThis.fetch = originalFetch; globalThis.caches = oldCache; }
});

test('dashboard endpoints reject unsigned requests and bad origins', async () => {
  const badOrigin = new Request('https://siloai.test/api/sites', { method: 'POST', headers: { origin: 'https://evil.example', 'content-type': 'application/json' }, body: '{}' });
  assert.equal((await worker.fetch(badOrigin, { APP_ORIGINS: 'https://htmltools.me' })).status, 403);
  const unsigned = new Request('https://siloai.test/api/sites', { method: 'POST', headers: { origin: 'https://htmltools.me', 'content-type': 'application/json' }, body: '{}' });
  assert.equal((await worker.fetch(unsigned, { APP_ORIGINS: 'https://htmltools.me', FIREBASE_PROJECT_ID: 'demo' })).status, 401);
});


test('chat sends current-route identity and refuses to mislabel homepage context as an unindexed page', async () => {
  await withGithubSite(async (env) => {
    const request = new Request(`https://siloai.test/chat/${site.id}`, {
      method: 'POST', headers: { origin: 'https://htmltools.eu.cc', 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.14' },
      body: JSON.stringify({ message: 'What is on this page?', pagePath: '/HTML-Runner/', pageTitle: 'HTML Runner', history: [] }),
    });
    const response = await worker.fetch(request, env, { waitUntil() {} });
    assert.equal(response.status, 200);
    const system = envFor.lastInput.messages[0].content;
    assert.match(system, /Visitor is currently on: \/HTML-Runner\//);
    assert.match(system, /Current route has an indexed excerpt: no/);
    assert.match(system, /do not describe another route as this page/);
    assert.match(system, /HTML Runner/);
  }, site, 'The route is not indexed yet, so I can’t confirm its contents.');
});

test('chat returns only Gemma final answer text when thinking markers are included', async () => {
  await withGithubSite(async (env) => {
    env.AI.run = async () => ({ response: '<|channel>thought\nprivate chain of thought must not reach visitors\n<|channel>final\nThe indexed page explains the tool.' });
    const request = new Request(`https://siloai.test/chat/${site.id}`, {
      method: 'POST', headers: { origin: 'https://htmltools.eu.cc', 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.15' },
      body: JSON.stringify({ message: 'What does this page do?', pagePath: '/Library', history: [] }),
    });
    const payload = await (await worker.fetch(request, env, { waitUntil() {} })).json();
    assert.equal(payload.reply, 'The indexed page explains the tool.');
    assert.doesNotMatch(payload.reply, /private chain of thought|thought/);
  }, site, 'unused');
});
