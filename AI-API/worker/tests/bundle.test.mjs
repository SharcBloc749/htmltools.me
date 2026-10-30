/* The single-file bundle (worker.js) that can be pasted into the Cloudflare
 * dashboard must expose exactly what wrangler would deploy and behave the same
 * as the modular source. */
import test from 'node:test';
import assert from 'node:assert/strict';

import bundled, { GatewayState } from '../worker.js';
import { makeEnv, makeCtx, apiRequest, createAccountKey } from './helpers.mjs';

test('the bundle exports the fetch handler and the Durable Object class', () => {
  assert.equal(typeof bundled.fetch, 'function');
  assert.equal(typeof GatewayState, 'function');
  assert.equal(typeof GatewayState.prototype.fetch, 'function');
});

test('the bundle serves health, models and a keyed completion', async () => {
  const env = makeEnv();
  const ctx = makeCtx();

  const health = await bundled.fetch(apiRequest('/health'), env, ctx);
  assert.equal(health.status, 200);

  const models = await bundled.fetch(apiRequest('/v1/models', { key: 'ht_invalid' }), env, ctx);
  assert.ok([401, 403].includes(models.status), 'models rejects an unknown key');

  const token = env.__signer.sign({ uid: 'uid_bundle' });
  const key = await createAccountKey(bundled, env, ctx, token);

  const list = await bundled.fetch(apiRequest('/v1/models', { key }), env, ctx);
  assert.equal(list.status, 200);
  const { data } = await list.json();
  assert.ok(data.length > 0 && data.every(m => typeof m.id === 'string'));

  const chat = await bundled.fetch(apiRequest('/v1/chat/completions', {
    method: 'POST', key, body: { model: 'auto', messages: [{ role: 'user', content: 'hi' }] },
  }), env, ctx);
  assert.equal(chat.status, 200);
  const body = await chat.json();
  assert.equal(body.object, 'chat.completion');
  assert.ok(body.choices[0].message.content.length > 0);
});

test('the bundle refuses anonymous traffic and unknown routes', async () => {
  const env = makeEnv();
  const ctx = makeCtx();
  const anon = await bundled.fetch(apiRequest('/v1/chat/completions', {
    method: 'POST', body: { model: 'auto', messages: [{ role: 'user', content: 'hi' }] },
  }), env, ctx);
  assert.equal(anon.status, 401);
  assert.equal(env.AI.calls.length, 0);

  const missing = await bundled.fetch(apiRequest('/.well-known/nope'), env, ctx);
  assert.equal(missing.status, 404);
});
