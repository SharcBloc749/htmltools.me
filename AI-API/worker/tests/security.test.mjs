import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import worker from '../src/index.mjs';
import { encryptSecret, decryptSecret, byokContext, escrowContext } from '../src/crypto.mjs';
import { renderKeysFile } from '../src/github.mjs';
import { hashKey, newSalt } from '../src/keys.mjs';
import { apiRequest, createAccountKey, makeCtx, makeEnv } from './helpers.mjs';

const CHAT = '/v1/chat/completions';
const root = fileURLToPath(new URL('../../', import.meta.url));

/* ── Firebase identity ────────────────────────────────────────────────────── */

test('account endpoints require a verified Firebase ID token', async () => {
  const env = makeEnv();
  const ctx = makeCtx();
  const res = await worker.fetch(apiRequest('/account/keys'), env, ctx);
  assert.equal(res.status, 401);
  assert.equal((await res.json()).error.code, 'auth_missing');

  const forged = await worker.fetch(apiRequest('/account/keys', { token: env.__signer.forge() }), env, ctx);
  assert.equal(forged.status, 401);
  assert.equal((await forged.json()).error.code, 'auth_bad_signature');

  const expired = env.__signer.sign({ uid: 'uid_1' }, { exp: Math.floor(Date.now() / 1000) - 30 });
  const expRes = await worker.fetch(apiRequest('/account/keys', { token: expired }), env, ctx);
  assert.equal(expRes.status, 401);
  assert.equal((await expRes.json()).error.code, 'auth_expired');

  const wrongProject = env.__signer.sign({ uid: 'uid_1' }, { projectId: 'htmltools-library', iss: 'https://securetoken.google.com/htmltools-library', aud: 'htmltools-library' });
  const wrongRes = await worker.fetch(apiRequest('/account/keys', { token: wrongProject }), env, ctx);
  assert.equal(wrongRes.status, 401);
  assert.equal((await wrongRes.json()).error.code, 'auth_wrong_project');
});

/* ── key display and storage ──────────────────────────────────────────────── */

test('keys are shown once, stored as salted hashes, and never echoed by list endpoints', async () => {
  const env = makeEnv();
  const ctx = makeCtx();
  const token = env.__signer.sign({ uid: 'uid_1', name: 'Test User', email: 'tester@example.com' });
  const created = await worker.fetch(apiRequest('/account/keys', { method: 'POST', token, body: { label: 'laptop' } }), env, ctx);
  assert.equal(created.status, 201);
  const createdBody = await created.json();
  const key = createdBody.key;
  assert.match(key, /^ht-[a-z0-9]{30}$/);
  assert.equal(createdBody.id, key.slice(0, 13));
  assert.match(createdBody.notice, /cannot be shown again/i);

  const raw = JSON.stringify(await (await worker.fetch(apiRequest('/account/keys', { token }), env, ctx)).json());
  assert.ok(!raw.includes(key), 'the plaintext key must not come back from the list endpoint');
  assert.ok(!raw.includes('"hash"'));
  assert.ok(!raw.includes('"salt"'));

  // Stored record is a salted hash that verifies, and a different salt changes it.
  const stored = await env.__gateway.storage.get(`key:${createdBody.id}`);
  assert.equal(stored.hash.length, 64);
  assert.equal(stored.salt.length, 32);
  assert.equal(stored.hash, await hashKey(key, stored.salt, env.KEY_PEPPER));
  const salt2 = newSalt();
  assert.notEqual(await hashKey(key, stored.salt, env.KEY_PEPPER), await hashKey(key, salt2, env.KEY_PEPPER));
});

test('active-key and per-day creation limits are enforced', async () => {
  const env = makeEnv({ MAX_ACTIVE_KEYS: '1', MAX_KEYS_PER_DAY: '5' });
  const ctx = makeCtx();
  const token = env.__signer.sign({ uid: 'uid_limited' });
  await createAccountKey(worker, env, ctx, token);
  const second = await worker.fetch(apiRequest('/account/keys', { method: 'POST', token, body: {} }), env, ctx);
  assert.equal(second.status, 400);
  assert.equal((await second.json()).error.code, 'key_limit');
});

test('escrowed keys can be revealed only after a recent password/Google sign-in', async () => {
  const env = makeEnv({ KEY_ESCROW_SECRET: 'test-escrow-secret-0123456789' });
  const ctx = makeCtx();
  const token = env.__signer.sign({ uid: 'uid_escrow' });
  const key = await createAccountKey(worker, env, ctx, token);
  const id = key.slice(0, 13);

  const fresh = env.__signer.sign({ uid: 'uid_escrow' });
  const revealed = await worker.fetch(apiRequest(`/account/keys/${id}/reveal`, { method: 'POST', token: fresh }), env, ctx);
  assert.equal(revealed.status, 200);
  assert.equal((await revealed.json()).key, key);

  const stale = env.__signer.sign({ uid: 'uid_escrow' }, { authTime: Math.floor(Date.now() / 1000) - 900 });
  const blocked = await worker.fetch(apiRequest(`/account/keys/${id}/reveal`, { method: 'POST', token: stale }), env, ctx);
  assert.equal(blocked.status, 403);
  assert.equal((await blocked.json()).error.code, 'reauth_required');

  const other = env.__signer.sign({ uid: 'uid_other' });
  const foreign = await worker.fetch(apiRequest(`/account/keys/${id}/reveal`, { method: 'POST', token: other }), env, ctx);
  assert.equal(foreign.status, 403);
});

test('without escrow, reveal explains that keys are one-way hashes', async () => {
  const env = makeEnv();
  const ctx = makeCtx();
  const token = env.__signer.sign({ uid: 'uid_noescrow' });
  const key = await createAccountKey(worker, env, ctx, token);
  const res = await worker.fetch(apiRequest(`/account/keys/${key.slice(0, 13)}/reveal`, { method: 'POST', token }), env, ctx);
  assert.equal(res.status, 409);
  assert.equal((await res.json()).error.code, 'key_not_recoverable');
});

test('private roster file lists key ids with owner and keeps no plaintext key', async () => {
  const plaintext = 'ht-3jhnnuj2tgabcdefghjkmnpqrs2345';
  const salt = newSalt();
  const record = {
    id: plaintext.slice(0, 13),
    salt,
    hash: await hashKey(plaintext, salt, 'pepper-0123456789abcdefghij'),
    uid: 'uid_1',
    name: 'John Doe',
    email: 'johndoe@example.com',
    created: 1_700_000_000_000,
    lastUsed: null,
    revoked: false,
    usage: { requests: 2, tokens: 30 },
  };
  const file = renderKeysFile([record]);
  assert.ok(file.includes(`// ${record.id} - John Doe - johndoe@example.com`));
  assert.ok(!file.includes(plaintext));
  assert.ok(file.includes(record.hash));
  assert.ok(file.includes('module.exports ='));
});

/* ── BYOK ─────────────────────────────────────────────────────────────────── */

test('BYOK ciphertext is bound to the owning Firebase uid', async () => {
  const secret = 'test-byok-secret-0123456789abcdef';
  const blob = await encryptSecret('gsk_example', secret, byokContext('uid_a', 'groq'));
  assert.equal(await decryptSecret(blob, secret, byokContext('uid_a', 'groq')), 'gsk_example');
  await assert.rejects(() => decryptSecret(blob, secret, byokContext('uid_b', 'groq')), /could not be decrypted|not be decrypted/);
  await assert.rejects(() => decryptSecret(blob, 'another-secret-0123456789abcdef', byokContext('uid_a', 'groq')));
});

test('a user Groq key is verified, encrypted, used for Groq models, and removable', async () => {
  const env = makeEnv();
  const ctx = makeCtx();
  const token = env.__signer.sign({ uid: 'uid_byok' });
  const key = await createAccountKey(worker, env, ctx, token);

  const notConnected = await worker.fetch(apiRequest(CHAT, {
    method: 'POST', key, body: { model: 'llama-3.3-70b-versatile', messages: [{ role: 'user', content: 'hi' }] },
  }), env, ctx);
  assert.equal(notConnected.status, 400);
  assert.equal((await notConnected.json()).error.code, 'provider_not_connected');

  const bad = await worker.fetch(apiRequest('/account/byok', { method: 'POST', token, body: { provider: 'groq', key: 'not-a-key' } }), env, ctx);
  assert.equal(bad.status, 400);
  assert.equal((await bad.json()).error.code, 'invalid_provider_key');

  const groqKey = 'gsk_' + 'a'.repeat(40);
  const saved = await worker.fetch(apiRequest('/account/byok', { method: 'POST', token, body: { provider: 'groq', key: groqKey } }), env, ctx);
  assert.equal(saved.status, 200);
  assert.equal((await saved.json()).connected, true);

  const stored = await env.__gateway.storage.get('byok:uid_byok');
  assert.ok(stored.blob.ct.length > 10);
  assert.ok(!JSON.stringify(stored).includes(groqKey), 'the provider key must not be stored in plaintext');

  env.__groqHandler = () => Response.json({
    id: 'chatcmpl-groq',
    object: 'chat.completion',
    model: 'llama-3.3-70b-versatile',
    choices: [{ index: 0, message: { role: 'assistant', content: 'groq says hi' }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 4, completion_tokens: 3, total_tokens: 7 },
  });

  const chat = await worker.fetch(apiRequest(CHAT, {
    method: 'POST', key, body: { model: 'llama-3.3-70b-versatile', messages: [{ role: 'user', content: 'hi' }] },
  }), env, ctx);
  assert.equal(chat.status, 200);
  assert.equal((await chat.json()).choices[0].message.content, 'groq says hi');
  assert.equal(env.AI.calls.length, 0, 'BYOK requests must not touch the Workers AI allowance');

  const groqCall = env.__requests.find(r => r.url.includes('api.groq.com') && r.url.includes('chat'));
  assert.equal(groqCall.init.headers.authorization, `Bearer ${groqKey}`);

  const removed = await worker.fetch(apiRequest('/account/byok', { method: 'DELETE', token }), env, ctx);
  assert.equal(removed.status, 200);
  assert.equal(await env.__gateway.storage.get('byok:uid_byok'), undefined);
});

test('auto model prefers a connected Groq key and falls back to the free pool', async () => {
  const env = makeEnv();
  const ctx = makeCtx();
  const token = env.__signer.sign({ uid: 'uid_auto' });
  const key = await createAccountKey(worker, env, ctx, token);

  const free = await worker.fetch(apiRequest(CHAT, {
    method: 'POST', key, body: { model: 'auto', messages: [{ role: 'user', content: 'hi' }] },
  }), env, ctx);
  assert.equal(free.status, 200);
  assert.equal(env.AI.calls.at(-1).model, '@cf/meta/llama-3.1-8b-instruct');

  await worker.fetch(apiRequest('/account/byok', {
    method: 'POST', token, body: { provider: 'groq', key: 'gsk_' + 'b'.repeat(40) },
  }), env, ctx);
  env.__groqHandler = () => Response.json({
    object: 'chat.completion',
    choices: [{ index: 0, message: { role: 'assistant', content: 'auto groq' }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  });
  const byok = await worker.fetch(apiRequest(CHAT, {
    method: 'POST', key, body: { model: 'auto', messages: [{ role: 'user', content: 'hi' }] },
  }), env, ctx);
  assert.equal(byok.status, 200);
  assert.equal((await byok.json()).choices[0].message.content, 'auto groq');
});

/* ── SiloAI ───────────────────────────────────────────────────────────────── */

test('SiloAI needs a signed-in user, is rate limited, and draws from the shared pool', async () => {
  const env = makeEnv({ HTSILO_RPM: '1' });
  const ctx = makeCtx();

  const anonymous = await worker.fetch(apiRequest('/siloai/chat', { method: 'POST', body: { messages: [{ role: 'user', content: 'hi' }] } }), env, ctx);
  assert.equal(anonymous.status, 401);
  assert.equal(env.AI.calls.length, 0);

  const tokenA = env.__signer.sign({ uid: 'uid_silo_a' });
  const ok = await worker.fetch(apiRequest('/siloai/chat', {
    method: 'POST', token: tokenA, body: { messages: [{ role: 'user', content: 'How do I use the API?' }] },
  }), env, ctx);
  assert.equal(ok.status, 200);
  const body = await ok.json();
  assert.equal(body.reply, 'Hello from the mock model.');
  assert.equal(body.remaining, 14);
  assert.match(env.AI.calls[0].input.messages[0].content, /SiloAI/);
  assert.equal(env.AI.calls[0].input.max_tokens, 320);

  const tokenB = env.__signer.sign({ uid: 'uid_silo_b' });
  await worker.fetch(apiRequest('/siloai/chat', { method: 'POST', token: tokenB, body: { messages: [{ role: 'user', content: 'one' }] } }), env, ctx);
  const blocked = await worker.fetch(apiRequest('/siloai/chat', { method: 'POST', token: tokenB, body: { messages: [{ role: 'user', content: 'two' }] } }), env, ctx);
  assert.equal(blocked.status, 429);
  assert.equal((await blocked.json()).error.code, 'rate_limit_exceeded');
});

/* ── admin ────────────────────────────────────────────────────────────────── */

test('admin roster requires an allowlisted uid, fresh sign-in and the passphrase', async () => {
  const env = makeEnv({ ADMIN_UIDS: 'uid_admin', ADMIN_PASSPHRASE: 'correct horse battery staple' });
  const ctx = makeCtx();
  const userToken = env.__signer.sign({ uid: 'uid_1', email: 'tester@example.com' });
  const userKey = await createAccountKey(worker, env, ctx, userToken);

  const notAdmin = await worker.fetch(apiRequest('/admin/roster', { token: userToken }), env, ctx);
  assert.equal(notAdmin.status, 403);

  const adminToken = env.__signer.sign({ uid: 'uid_admin' });
  const noPass = await worker.fetch(apiRequest('/admin/roster', { token: adminToken }), env, ctx);
  assert.equal(noPass.status, 403);
  assert.equal((await noPass.json()).error.code, 'bad_passphrase');

  const staleAdmin = env.__signer.sign({ uid: 'uid_admin' }, { authTime: Math.floor(Date.now() / 1000) - 900 });
  const stale = await worker.fetch(apiRequest('/admin/roster', { token: staleAdmin, headers: { 'x-ht-admin-passphrase': 'correct horse battery staple' } }), env, ctx);
  assert.equal(stale.status, 403);
  assert.equal((await stale.json()).error.code, 'reauth_required');

  const roster = await worker.fetch(apiRequest('/admin/roster', {
    token: adminToken, headers: { 'x-ht-admin-passphrase': 'correct horse battery staple' },
  }), env, ctx);
  assert.equal(roster.status, 200);
  const body = await roster.json();
  assert.equal(body.keys.length, 1);
  assert.equal(body.keys[0].id, userKey.slice(0, 13));
  assert.equal(body.keys[0].email, 'tester@example.com');
  const raw = JSON.stringify(body);
  assert.ok(!raw.includes(userKey));
  assert.ok(!raw.includes('"hash"'));
  assert.ok(!raw.includes('"salt"'));
});

test('the operator can recover an escrowed key only with every admin control', async () => {
  const env = makeEnv({
    ADMIN_UIDS: 'uid_admin',
    ADMIN_PASSPHRASE: 'correct horse battery staple',
    KEY_ESCROW_SECRET: 'test-escrow-secret-0123456789',
  });
  const ctx = makeCtx();
  const userToken = env.__signer.sign({ uid: 'uid_1', name: 'Test User', email: 'tester@example.com' });
  const key = await createAccountKey(worker, env, ctx, userToken);
  const id = key.slice(0, 13);

  const userAttempt = await worker.fetch(apiRequest(`/admin/keys/${id}/reveal`, {
    method: 'POST', token: userToken, headers: { 'x-ht-admin-passphrase': 'correct horse battery staple' },
  }), env, ctx);
  assert.equal(userAttempt.status, 403);

  const adminToken = env.__signer.sign({ uid: 'uid_admin' });
  const noPassphrase = await worker.fetch(apiRequest(`/admin/keys/${id}/reveal`, { method: 'POST', token: adminToken }), env, ctx);
  assert.equal(noPassphrase.status, 403);

  const recovered = await worker.fetch(apiRequest(`/admin/keys/${id}/reveal`, {
    method: 'POST', token: adminToken, headers: { 'x-ht-admin-passphrase': 'correct horse battery staple' },
  }), env, ctx);
  assert.equal(recovered.status, 200);
  const body = await recovered.json();
  assert.equal(body.key, key);
  assert.equal(body.owner.email, 'tester@example.com');

  // A deployment without the escrow secret cannot recover anything.
  const noEscrow = makeEnv({ ADMIN_UIDS: 'uid_admin', ADMIN_PASSPHRASE: 'correct horse battery staple' });
  const plainKey = await createAccountKey(worker, noEscrow, makeCtx(), noEscrow.__signer.sign({ uid: 'uid_2' }));
  const blockedEnv = await worker.fetch(apiRequest(`/admin/keys/${plainKey.slice(0, 13)}/reveal`, {
    method: 'POST',
    token: noEscrow.__signer.sign({ uid: 'uid_admin' }),
    headers: { 'x-ht-admin-passphrase': 'correct horse battery staple' },
  }), noEscrow, makeCtx());
  assert.equal(blockedEnv.status, 409);
  assert.equal((await blockedEnv.json()).error.code, 'key_not_recoverable');
});

/* ── transport / privacy ─────────────────────────────────────────────────── */

test('CORS allows third-party API clients but restricts account origins', async () => {
  const env = makeEnv();
  const ctx = makeCtx();
  const apiPreflight = await worker.fetch(apiRequest('/v1/chat/completions', { method: 'OPTIONS', origin: 'https://thirdparty.example' }), env, ctx);
  assert.equal(apiPreflight.headers.get('access-control-allow-origin'), '*');

  const accountPreflight = await worker.fetch(apiRequest('/account/me', { method: 'OPTIONS', origin: 'https://evil.example' }), env, ctx);
  assert.equal(accountPreflight.headers.get('access-control-allow-origin'), null);

  const sitePreflight = await worker.fetch(apiRequest('/account/me', { method: 'OPTIONS', origin: 'https://htmltools.me' }), env, ctx);
  assert.equal(sitePreflight.headers.get('access-control-allow-origin'), 'https://htmltools.me');
});

test('prompt text is never logged', async () => {
  const env = makeEnv();
  const ctx = makeCtx();
  const token = env.__signer.sign({ uid: 'uid_logs' });
  const key = await createAccountKey(worker, env, ctx, token);
  const marker = 'PROMPT-MARKER-9f3a-secret-sentence';
  const lines = [];
  const original = console.log;
  console.log = value => { lines.push(String(value)); };
  try {
    await worker.fetch(apiRequest(CHAT, {
      method: 'POST', key, body: { model: '@cf/meta/llama-3.1-8b-instruct', messages: [{ role: 'user', content: marker }] },
    }), env, ctx);
  } finally {
    console.log = original;
  }
  const joined = lines.join('\n');
  assert.ok(joined.includes('"event":"chat"'), 'metadata is logged');
  assert.ok(!joined.includes(marker), 'prompt content is not logged');
  assert.ok(!joined.includes('Hello from the mock model'), 'completion content is not logged');
});

test('no provider key, private key or access token is committed anywhere in the Worker', () => {
  const dir = fileURLToPath(new URL('../src/', import.meta.url));
  const files = readdirSync(dir).map(f => `${dir}${f}`);
  files.push(fileURLToPath(new URL('../wrangler.toml', import.meta.url)));
  const patterns = [
    /gsk_[A-Za-z0-9]{20,}/,
    /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
    /AIza[0-9A-Za-z_-]{30,}/,
    /\bsk-[A-Za-z0-9]{20,}/,
    /gh[pousr]_[A-Za-z0-9]{20,}/,
    /github_pat_[A-Za-z0-9_]{20,}/,
    /FIREBASE_PRIVATE_KEY/,
  ];
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    for (const pattern of patterns) assert.ok(!pattern.test(text), `${file} contains ${pattern}`);
    assert.ok(!/GITHUB_TOKEN\s*=\s*["'][^"']+["']/.test(text), `${file} contains a GitHub token value`);
  }
  assert.ok(statSync(dir).isDirectory());
  assert.ok(root.endsWith('/'));
});
