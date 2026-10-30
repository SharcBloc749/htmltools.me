#!/usr/bin/env node
/**
 * Checks a deployed gateway and prints exactly what is broken.
 *
 *   npm run doctor                       # uses the workers.dev URL from config.js
 *   npm run doctor -- https://api.htmltools.me
 *
 * Read-only: no key is created, no AI call is made, nothing is charged.
 */
const raw = process.argv[2] || process.env.GATEWAY_URL || 'https://htmltools-me-ai-api.bozhetarnikmatthew.workers.dev';
const base = raw.replace(/\/+$/, '');

const line = (ok, label, detail = '') =>
  console.log(`${ok === 'skip' ? '  –' : ok ? '  ✓' : '  ✗'} ${label}${detail ? `  ${detail}` : ''}`);

let failures = 0;

async function call(path, init = {}) {
  const started = Date.now();
  const res = await fetch(base + path, { ...init, headers: { origin: 'https://htmltools.me', ...(init.headers || {}) } });
  const ms = Date.now() - started;
  const text = await res.text();
  let body = null;
  try { body = JSON.parse(text); } catch { body = null; }
  return { res, body, text, ms };
}

console.log(`\nGateway doctor — ${base}\n`);
try {
  const health = await call('/health');
  const h = health.body || {};
  const ready = health.res.status === 200 && h.status === 'ready';
  line(ready, `reachable (${health.ms} ms)`, `version ${h.version || '?'}`);
  if (!ready) {
    failures++;
    line(false, 'configuration complete', h.missing?.length ? `missing: ${h.missing.join(', ')}` : 'health endpoint did not report readiness');
    for (const [name, fix] of Object.entries(h.fixes || {})) console.log(`      ${name}: ${fix}`);
  } else {
    line(true, 'configuration complete');
  }

  const status = await call('/public/status');
  line(status.res.status === 200 && status.body?.pool, 'pool status readable',
    status.body?.pool ? `${status.body.pool.remaining}/${status.body.pool.budget} neurons left today` : '');
  if (!status.body?.pool) failures++;

  const anon = await call('/v1/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'auto', messages: [{ role: 'user', content: 'ping' }] }),
  });
  const blocked = anon.res.status === 401 && anon.body?.error?.code === 'invalid_api_key';
  line(blocked, 'anonymous traffic refused', blocked ? '' : `got ${anon.res.status}`);
  if (!blocked) failures++;

  const account = await call('/account/me');
  line(account.res.status === 401, 'account endpoints require sign-in', account.res.status === 401 ? '' : `got ${account.res.status}`);
  if (account.res.status !== 401) failures++;

  const notFound = await call('/test');
  line(notFound.res.status === 404, 'no legacy or test routes', notFound.res.status === 404 ? '' : `got ${notFound.res.status}`);

  const preflight = await call('/v1/models', { method: 'OPTIONS', headers: { 'access-control-request-method': 'GET' } });
  line(preflight.res.status === 204, 'CORS preflight answered');

  const cors = status.res.headers.get('access-control-allow-origin');
  line(Boolean(cors), 'CORS header on API responses', cors || '');
  if (!cors) failures++;
} catch (error) {
  failures++;
  console.log(`  ✗ could not reach the gateway: ${error.message}`);
  console.log('    Check the URL, and that the Worker is deployed (npx wrangler deploy).');
}

console.log(failures === 0 ? '\nAll checks passed.\n' : `\n${failures} check(s) failed — see the fixes above.\n`);
process.exit(failures === 0 ? 0 : 1);
