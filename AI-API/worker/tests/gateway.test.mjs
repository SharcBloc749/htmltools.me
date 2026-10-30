import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.mjs';
import { GatewayState } from '../src/state.mjs';
import {
  apiRequest, createAccountKey, makeAI, makeCtx, makeEnv, makeGateway, readSSE, sseStream,
} from './helpers.mjs';

const CHAT = '/v1/chat/completions';

async function withKey(extraEnv = {}) {
  const env = makeEnv(extraEnv);
  const ctx = makeCtx();
  const token = env.__signer.sign({ uid: 'uid_1', name: 'Test User', email: 'tester@example.com' });
  const key = await createAccountKey(worker, env, ctx, token);
  return { env, ctx, token, key };
}

/* ── surface ──────────────────────────────────────────────────────────────── */

test('unknown and legacy paths return 404 and never touch the AI binding', async () => {
  const env = makeEnv();
  const ctx = makeCtx();
  const paths = ['/', '/api/chat', '/v1/completions', '/v1/embeddings', '/chat', '/ai', '/test', '/v1/chat'];
  for (const path of paths) {
    const isGet = path === '/v1/chat';
    const res = await worker.fetch(apiRequest(path, isGet ? {} : { method: 'POST', body: { messages: [] } }), env, ctx);
    assert.equal(res.status, 404, path);
    const body = await res.json();
    assert.equal(body.error.code, 'not_found');
  }
  assert.equal(env.AI.calls.length, 0, 'no unauthenticated AI route may exist');
});

test('chat completions and models reject requests without a bearer key', async () => {
  const env = makeEnv();
  const ctx = makeCtx();
  for (const path of ['/v1/models', CHAT]) {
    const res = await worker.fetch(apiRequest(path, { method: path === CHAT ? 'POST' : 'GET', body: path === CHAT ? { messages: [{ role: 'user', content: 'hi' }] } : undefined }), env, ctx);
    assert.equal(res.status, 401);
    const body = await res.json();
    assert.equal(body.error.code, 'invalid_api_key');
    assert.equal(body.error.type, 'invalid_request_error');
  }
  assert.equal(env.AI.calls.length, 0);
});

test('health and public status expose no AI work and no secrets', async () => {
  const env = makeEnv();
  const ctx = makeCtx();
  const health = await worker.fetch(apiRequest('/health'), env, ctx);
  assert.equal(health.status, 200);
  const status = await worker.fetch(apiRequest('/public/status'), env, ctx);
  assert.equal(status.status, 200);
  const text = await status.text();
  assert.ok(!text.includes(env.KEY_PEPPER));
  assert.ok(!text.includes('hash'));
  assert.equal(env.AI.calls.length, 0);
});

test('GET /v1/models requires a live key and lists the allowlist', async () => {
  const { env, ctx, key } = await withKey();
  const res = await worker.fetch(apiRequest('/v1/models', { key }), env, ctx);
  assert.equal(res.status, 200);
  const body = await res.json();
  const ids = body.data.map(m => m.id);
  assert.ok(ids.includes('@cf/meta/llama-3.1-8b-instruct'));
  assert.ok(ids.includes('llama-3.3-70b-versatile'));
  assert.ok(ids.includes('auto'));
  assert.ok(!ids.includes('@cf/qwen/qwen2.5-coder-32b-instruct'), 'disabled models stay out of the catalogue');
  const groq = body.data.find(m => m.id === 'llama-3.3-70b-versatile');
  assert.equal(groq.x_ht.available, false, 'BYOK models are unavailable until a key is connected');
});

/* ── OpenAI compatibility ─────────────────────────────────────────────────── */

test('non-streaming chat returns an OpenAI-shaped completion and counts usage', async () => {
  const { env, ctx, key } = await withKey();
  const res = await worker.fetch(apiRequest(CHAT, {
    method: 'POST', key, body: { model: '@cf/meta/llama-3.1-8b-instruct', messages: [{ role: 'user', content: 'Say hello' }] },
  }), env, ctx);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('x-request-id')?.startsWith('req_'), true);
  const body = await res.json();
  assert.equal(body.object, 'chat.completion');
  assert.equal(body.choices[0].index, 0);
  assert.equal(body.choices[0].message.role, 'assistant');
  assert.equal(body.choices[0].message.content, 'Hello from the mock model.');
  assert.equal(body.choices[0].finish_reason, 'stop');
  assert.equal(body.usage.prompt_tokens, 12);
  assert.equal(body.usage.completion_tokens, 6);
  assert.equal(env.AI.calls.length, 1);
  assert.equal(env.AI.calls[0].input.stream, false);

  const usage = await (await worker.fetch(apiRequest('/account/usage', { token: env.__signer.sign({ uid: 'uid_1', name: 'Test User' }) }), env, ctx)).json();
  assert.equal(usage.today.requests, 1);
  assert.ok(usage.pool.spent > 0, 'Neuron reservation settles into the pool');
});

test('streaming chat is translated to OpenAI chunk events', async () => {
  const env = makeEnv({
    AI: makeAI(() => sseStream([
      'data: {"response":"Hel"}\n\n',
      'data: {"response":"lo"}\n\n',
      'data: [DONE]\n\n',
    ])),
  });
  const ctx = makeCtx();
  const token = env.__signer.sign({ uid: 'uid_stream' });
  const key = await createAccountKey(worker, env, ctx, token);
  const res = await worker.fetch(apiRequest(CHAT, {
    method: 'POST', key, body: { model: '@cf/meta/llama-3.1-8b-instruct', stream: true, messages: [{ role: 'user', content: 'hi' }] },
  }), env, ctx);

  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/event-stream/);
  const events = await readSSE(res);
  assert.equal(events.at(-1).done, true);
  const chunks = events.slice(0, -1);
  assert.equal(chunks[0].object, 'chat.completion.chunk');
  assert.equal(chunks[0].choices[0].delta.role, 'assistant');
  const text = chunks.map(c => c.choices?.[0]?.delta?.content || '').join('');
  assert.equal(text, 'Hello');
  const finals = chunks.filter(c => c.choices?.[0]?.finish_reason);
  assert.equal(finals.at(-1).choices[0].finish_reason, 'stop');

  await ctx.settle();
  const usage = await (await worker.fetch(apiRequest('/account/usage', { token }), env, ctx)).json();
  assert.ok(usage.pool.spent > 0, 'streamed usage settles after the stream closes');
  assert.ok(usage.today.tokens > 0);
});

test('allowlist, content and parameter guards reject unsupported requests', async () => {
  const { env, ctx, key } = await withKey();
  const cases = [
    [{ model: 'gpt-4o', messages: [{ role: 'user', content: 'x' }] }, 'model_not_found'],
    [{ model: '@cf/qwen/qwen2.5-coder-32b-instruct', messages: [{ role: 'user', content: 'x' }] }, 'model_not_found'],
    [{ model: '@cf/meta/llama-3.1-8b-instruct', messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: 'https://x/y.png' } }] }] }, 'unsupported_content'],
    [{ model: '@cf/meta/llama-3.1-8b-instruct', messages: [{ role: 'user', content: 'x' }], n: 2 }, 'unsupported_parameter'],
    [{ model: '@cf/meta/llama-3.1-8b-instruct', messages: [{ role: 'user', content: 'x' }], logprobs: true }, 'unsupported_parameter'],
    [{ model: '@cf/meta/llama-3.1-8b-instruct', messages: [] }, 'invalid_request'],
    [{ model: '@cf/meta/llama-3.2-3b-instruct', messages: [{ role: 'user', content: 'x' }], tools: [{ type: 'function', function: { name: 'a', parameters: {} } }] }, 'unsupported_feature'],
  ];
  for (const [body, code] of cases) {
    const res = await worker.fetch(apiRequest(CHAT, { method: 'POST', key, body }), env, ctx);
    assert.equal(res.status, 400, JSON.stringify(body).slice(0, 80));
    assert.equal((await res.json()).error.code, code);
  }
  assert.equal(env.AI.calls.length, 0);
});

test('max_tokens is clamped to the model ceiling and oversized bodies are refused', async () => {
  const { env, ctx, key } = await withKey();
  const res = await worker.fetch(apiRequest(CHAT, {
    method: 'POST', key,
    body: { model: '@cf/meta/llama-3.1-8b-instruct', max_tokens: 99999, messages: [{ role: 'user', content: 'hi' }] },
  }), env, ctx);
  assert.equal(res.status, 200);
  assert.equal(env.AI.calls[0].input.max_tokens, 1024);

  const huge = { model: '@cf/meta/llama-3.1-8b-instruct', messages: [{ role: 'user', content: 'x'.repeat(200_000) }] };
  const big = await worker.fetch(apiRequest(CHAT, { method: 'POST', key, body: JSON.stringify(huge) }), env, ctx);
  assert.equal(big.status, 413);
});

test('tool calling is forwarded only to tool-capable models', async () => {
  const env = makeEnv({
    AI: makeAI(() => ({
      response: '',
      tool_calls: [{ id: 'call_1', name: 'get_weather', arguments: { city: 'Halifax' } }],
    })),
  });
  const ctx = makeCtx();
  const token = env.__signer.sign({ uid: 'uid_tools' });
  const key = await createAccountKey(worker, env, ctx, token);
  const res = await worker.fetch(apiRequest(CHAT, {
    method: 'POST', key,
    body: {
      model: '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
      messages: [{ role: 'user', content: 'weather?' }],
      tools: [{ type: 'function', function: { name: 'get_weather', description: 'weather', parameters: { type: 'object', properties: { city: { type: 'string' } } } } }],
    },
  }), env, ctx);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.choices[0].finish_reason, 'tool_calls');
  assert.equal(body.choices[0].message.tool_calls[0].function.name, 'get_weather');
  assert.equal(body.choices[0].message.tool_calls[0].function.arguments, '{"city":"Halifax"}');
  assert.ok(env.AI.calls[0].input.tools);
});

/* ── quotas ───────────────────────────────────────────────────────────────── */

test('per-key rate limit returns 429 with retry-after', async () => {
  const { env, ctx, key } = await withKey({ PER_KEY_RPM: '1' });
  const first = await worker.fetch(apiRequest(CHAT, { method: 'POST', key, body: { model: '@cf/meta/llama-3.1-8b-instruct', messages: [{ role: 'user', content: 'a' }] } }), env, ctx);
  assert.equal(first.status, 200);
  const second = await worker.fetch(apiRequest(CHAT, { method: 'POST', key, body: { model: '@cf/meta/llama-3.1-8b-instruct', messages: [{ role: 'user', content: 'b' }] } }), env, ctx);
  assert.equal(second.status, 429);
  assert.ok(Number(second.headers.get('retry-after')) > 0);
  const body = await second.json();
  assert.equal(body.error.code, 'rate_limit_exceeded');
  assert.equal(env.AI.calls.length, 1);
});

test('free pool exhaustion fails closed with a useful error and no provider call', async () => {
  const { env, ctx, key } = await withKey({ FREE_DAILY_NEURONS: '10' });
  const res = await worker.fetch(apiRequest(CHAT, {
    method: 'POST', key, body: { model: '@cf/meta/llama-3.1-8b-instruct', messages: [{ role: 'user', content: 'hi' }] },
  }), env, ctx);
  assert.equal(res.status, 429);
  assert.ok(Number(res.headers.get('retry-after')) > 0);
  const body = await res.json();
  assert.equal(body.error.code, 'free_pool_exhausted');
  assert.match(body.error.message, /00:00 UTC/);
  assert.equal(env.AI.calls.length, 0, 'budget checks happen before the provider call');
});

test('global per-minute limit protects the shared pool', async () => {
  const { env, ctx, key } = await withKey({ GLOBAL_RPM: '1', PER_KEY_RPM: '10', PER_USER_RPM: '10' });
  await worker.fetch(apiRequest(CHAT, { method: 'POST', key, body: { model: '@cf/meta/llama-3.1-8b-instruct', messages: [{ role: 'user', content: 'a' }] } }), env, ctx);
  const second = await worker.fetch(apiRequest(CHAT, { method: 'POST', key, body: { model: '@cf/meta/llama-3.1-8b-instruct', messages: [{ role: 'user', content: 'b' }] } }), env, ctx);
  assert.equal(second.status, 429);
  assert.equal((await second.json()).error.code, 'site_rate_limit');
});

test('revocation is immediate and survives a storage reload', async () => {
  const { env, ctx, key } = await withKey();
  const id = key.slice(0, 13);
  const revoke = await worker.fetch(apiRequest(`/account/keys/${id}/revoke`, { method: 'POST', token: env.__signer.sign({ uid: 'uid_1' }) }), env, ctx);
  assert.equal(revoke.status, 200);
  const denied = await worker.fetch(apiRequest(CHAT, { method: 'POST', key, body: { model: '@cf/meta/llama-3.1-8b-instruct', messages: [{ role: 'user', content: 'hi' }] } }), env, ctx);
  assert.equal(denied.status, 401);
  assert.equal((await denied.json()).error.code, 'key_revoked');

  // A brand new Durable Object instance built on the same storage still rejects it.
  const fakeState = { storage: env.__gateway.storage, blockConcurrencyWhile(fn) { this.ready = Promise.resolve().then(fn); } };
  const reloaded = new GatewayState(fakeState, env);
  await fakeState.ready;
  const response = await reloaded.fetch(new Request('https://gateway.internal/authorize', {
    method: 'POST', body: JSON.stringify({ key, provider: 'workers-ai', modelId: '@cf/meta/llama-3.1-8b-instruct', maxOutput: 100, inputTokens: 10 }),
  }));
  assert.equal((await response.json()).code, 'key_revoked');
});

test('key rows and quota counters reflect real traffic', async () => {
  const { env, ctx, key } = await withKey();
  const before = await (await worker.fetch(apiRequest('/account/keys', { token: env.__signer.sign({ uid: 'uid_1' }) }), env, ctx)).json();
  assert.equal(before.keys[0].usage.requests, 0);

  // Catalogue reads authenticate but must not consume the daily request quota.
  await worker.fetch(apiRequest('/v1/models', { key }), env, ctx);
  await worker.fetch(apiRequest('/v1/models', { key }), env, ctx);
  const afterModels = await (await worker.fetch(apiRequest('/account/usage', { token: env.__signer.sign({ uid: 'uid_1' }) }), env, ctx)).json();
  assert.equal(afterModels.today.requests, 0);

  await worker.fetch(apiRequest(CHAT, {
    method: 'POST', key, body: { model: '@cf/meta/llama-3.1-8b-instruct', messages: [{ role: 'user', content: 'hi' }] },
  }), env, ctx);
  const afterChat = await (await worker.fetch(apiRequest('/account/keys', { token: env.__signer.sign({ uid: 'uid_1' }) }), env, ctx)).json();
  assert.equal(afterChat.keys[0].usage.requests, 1);
  assert.ok(afterChat.keys[0].usage.tokens > 0);
});

test('abandoned reservations expire instead of starving the pool', async () => {
  const { env, ctx, key } = await withKey();
  const instance = env.__gateway.instance;
  const limitsBudget = Number(env.FREE_DAILY_NEURONS || 6000);
  instance.counters.reserved = limitsBudget - 5;
  instance.counters.pending.push({ id: 'ghost', amount: limitsBudget - 5, at: Date.now() - 11 * 60_000 });

  const res = await worker.fetch(apiRequest(CHAT, {
    method: 'POST', key, body: { model: '@cf/meta/llama-3.1-8b-instruct', messages: [{ role: 'user', content: 'still here?' }] },
  }), env, ctx);
  assert.equal(res.status, 200, 'a reservation that never settled must not block the pool forever');
  assert.ok(instance.counters.reserved < limitsBudget);
});

test('keys persist across a Durable Object restart', async () => {
  const { env, ctx, key } = await withKey();
  const freshEnv = { ...env };
  const gateway = makeGateway(freshEnv, env.__gateway.storage);
  freshEnv.GATEWAY = gateway.namespace;
  const res = await worker.fetch(apiRequest(CHAT, {
    method: 'POST', key, body: { model: '@cf/meta/llama-3.1-8b-instruct', messages: [{ role: 'user', content: 'hi' }] },
  }), freshEnv, ctx);
  assert.equal(res.status, 200);
});
