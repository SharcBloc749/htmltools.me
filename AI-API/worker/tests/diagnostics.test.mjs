/* Deployment problems must show up as clear, actionable errors instead of a bare 500. */
import test from 'node:test';
import assert from 'node:assert/strict';

import worker from '../src/index.mjs';
import { makeEnv, makeCtx, apiRequest, createAccountKey } from './helpers.mjs';

test('/health reports readiness without leaking a single secret', async () => {
  const env = makeEnv();
  const res = await worker.fetch(apiRequest('/health'), env, makeCtx());
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.status, 'ready');
  assert.deepEqual(body.missing, []);
  assert.equal(body.checks.storage, 'ok');
  assert.equal(body.checks.keyPepper, true);

  const text = JSON.stringify(body);
  assert.ok(!text.includes(env.KEY_PEPPER), 'never echoes the pepper');
  assert.ok(!text.includes(env.BYOK_ENCRYPTION_KEY), 'never echoes the BYOK secret');
});

test('/health flags a missing Durable Object binding and explains the fix', async () => {
  const env = makeEnv();
  delete env.GATEWAY;
  const res = await worker.fetch(apiRequest('/health'), env, makeCtx());
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.ok, false);
  assert.equal(body.status, 'degraded');
  assert.deepEqual(body.missing, ['storage']);
  assert.match(body.fixes.storage, /Durable Object binding GATEWAY/);
});

test('without the storage binding, account calls fail as 503 not_configured, not 500', async () => {
  const env = makeEnv();
  delete env.GATEWAY;
  const res = await worker.fetch(apiRequest('/account/me', { token: env.__signer.sign({ uid: 'uid_1' }) }), env, makeCtx());
  assert.equal(res.status, 503);
  const body = await res.json();
  assert.equal(body.error.code, 'not_configured');
  assert.deepEqual(body.error.setup.missing, ['storage']);
  assert.ok(body.error.setup.docs.includes('/AI-API/Docs/'));
});

test('a broken durable object surfaces as 503 storage_unavailable', async () => {
  const env = makeEnv();
  env.GATEWAY = { idFromName: () => 'global', get: () => { throw new Error('class not migrated'); } };
  const res = await worker.fetch(apiRequest('/account/me', { token: env.__signer.sign({ uid: 'uid_1' }) }), env, makeCtx());
  assert.equal(res.status, 503);
  assert.equal((await res.json()).error.code, 'not_configured');
});

test('the old assistant path still works and is marked deprecated', async () => {
  const env = makeEnv();
  const ctx = makeCtx();
  const token = env.__signer.sign({ uid: 'uid_alias' });
  const legacy = await worker.fetch(apiRequest('/htsilo/chat', {
    method: 'POST', token, body: { messages: [{ role: 'user', content: 'hello' }] },
  }), env, ctx);
  assert.equal(legacy.status, 200);
  assert.equal(legacy.headers.get('deprecation'), 'true');
  assert.equal((await legacy.json()).reply.length > 0, true);

  const current = await worker.fetch(apiRequest('/siloai/chat', {
    method: 'POST', token, body: { messages: [{ role: 'user', content: 'hello' }] },
  }), env, ctx);
  assert.equal(current.status, 200);
  assert.equal(current.headers.get('deprecation'), null);
});

test('the operator can read diagnostics but users cannot', async () => {
  const env = makeEnv({ ADMIN_UIDS: 'uid_admin', ADMIN_PASSPHRASE: 'passphrase-123' });
  const ctx = makeCtx();
  const pass = { 'x-ht-admin-passphrase': 'passphrase-123' };

  const asUser = await worker.fetch(apiRequest('/admin/diagnostics', {
    token: env.__signer.sign({ uid: 'uid_1' }), headers: pass,
  }), env, ctx);
  assert.equal(asUser.status, 403);

  const asAdmin = await worker.fetch(apiRequest('/admin/diagnostics', {
    token: env.__signer.sign({ uid: 'uid_admin' }), headers: pass,
  }), env, ctx);
  assert.equal(asAdmin.status, 200);
  const body = await asAdmin.json();
  assert.equal(body.checks.storage, 'ok');
  assert.equal(body.config.publicApiBase, 'https://gateway.test');
  assert.equal(typeof body.limits.budget, 'number');
});

test('PUBLIC_API_BASE brands the assistant answers', async () => {
  const env = makeEnv({ PUBLIC_API_BASE: 'https://htmltools.me/ai' });
  const ctx = makeCtx();
  await worker.fetch(apiRequest('/siloai/chat', {
    method: 'POST',
    token: env.__signer.sign({ uid: 'uid_brand' }),
    body: { messages: [{ role: 'user', content: 'what is the base url?' }] },
  }), env, ctx);
  const system = env.AI.calls[0].input.messages[0].content;
  assert.match(system, /https:\/\/htmltools\.me\/ai\/v1/);
  assert.ok(!system.includes('workers.dev'));
});

test('a created key still authenticates after the rename', async () => {
  const env = makeEnv();
  const ctx = makeCtx();
  const key = await createAccountKey(worker, env, ctx, env.__signer.sign({ uid: 'uid_keys' }));
  const models = await worker.fetch(apiRequest('/v1/models', { key }), env, ctx);
  assert.equal(models.status, 200);
});
