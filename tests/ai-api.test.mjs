import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const read = path => readFileSync(root + path, 'utf8');

const PAGES = [
  'AI-API/index.html',
  'AI-API/Docs/index.html',
  'AI-API/Dashboard/index.html',
  'AI-API/Playground/index.html',
];

test('AI-API pages exist and share the site design system', () => {
  for (const page of PAGES) {
    assert.ok(existsSync(root + page), page);
    const html = read(page);
    assert.ok(html.includes('/AI-API/assets/theme.css'), page + ' theme');
    assert.ok(html.includes('/AI-API/assets/config.js'), page + ' config');
    assert.ok(html.includes('https://htmltools.me/logo3.png'), page + ' logo');
    assert.ok(html.includes('DM Sans') || html.includes('theme.css'), page + ' type');
    assert.ok(html.includes('<html lang="en">'), page + ' lang');
    assert.ok(!/localhost|127\.0\.0\.1/.test(html), page + ' must not call localhost');
  }
  const theme = read('AI-API/assets/theme.css');
  assert.ok(theme.includes('--bg: #070709'), 'matches the site background token');
  assert.ok(theme.includes('IBM Plex Mono'));
  assert.ok(theme.includes('.silo-face'), 'HTSilo styling lives in the shared sheet');
});

test('machine-readable contract matches the implemented surface', () => {
  const spec = JSON.parse(read('AI-API/openapi.json'));
  assert.ok(spec.paths['/v1/models'].get);
  assert.ok(spec.paths['/v1/chat/completions'].post);
  assert.equal(spec.components.securitySchemes.bearerAuth.scheme, 'bearer');
  assert.ok(spec.servers[0].url.includes('htmltools-me-ai-api'));

  const llms = read('AI-API/llms.txt');
  assert.ok(llms.includes('https://htmltools-me-ai-api.bozhetarnikmatthew.workers.dev/v1'));
  assert.ok(llms.includes('free_pool_exhausted'));
  assert.ok(llms.includes('@cf/meta/llama-3.1-8b-instruct'));
  // Every model advertised to agents must exist in the Worker allowlist.
  const models = read('AI-API/worker/src/models.mjs');
  for (const line of llms.split('\n')) {
    const match = /^\s{2}(@cf\/[a-z0-9./-]+)\s/.exec(line);
    if (match) assert.ok(models.includes(match[1]), match[1]);
  }
});

test('AI-API is listed in the directory, the home page, Main and the sitemap', () => {
  for (const path of ['Tools/index.html', 'index.html', 'Main/index.html', 'sitemap1.xml']) {
    assert.ok(read(path).includes('https://htmltools.me/AI-API'), path);
  }
});

test('no provider key, private key or GitHub token is committed in AI-API', () => {
  const SKIP = new Set(['node_modules', '.wrangler', '.git']);
  const walk = dir => readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    if (SKIP.has(entry.name)) return [];
    const full = dir + entry.name;
    if (entry.isDirectory()) return walk(full + '/');
    return [full];
  });
  const files = walk(root + 'AI-API/');
  assert.ok(files.length > 10);
  const patterns = [
    /gsk_[A-Za-z0-9]{20,}/,
    /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
    /github_pat_[A-Za-z0-9_]{20,}/,
    /gh[pousr]_[A-Za-z0-9]{20,}/,
    /\bsk-[A-Za-z0-9]{24,}/,
  ];
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    for (const pattern of patterns) assert.ok(!pattern.test(text), `${file} matches ${pattern}`);
    assert.ok(!/GITHUB_TOKEN\s*[:=]\s*["'][A-Za-z0-9_]{10,}["']/.test(text), `${file} embeds a GitHub token`);
  }
});

test('browser config uses the Website Encryption project and holds no admin credential', () => {
  const config = read('AI-API/assets/config.js');
  assert.ok(config.includes('general-database-4cb1c'));
  assert.ok(config.includes('https://htmltools-me-ai-api.bozhetarnikmatthew.workers.dev'));
  assert.ok(!/private_key|refresh_token|client_secret/i.test(config));
});

test('the Worker has no unauthenticated AI path and no wildcard proxy', () => {
  const index = read('AI-API/worker/src/index.mjs');
  // The AI binding is only invoked from the provider module.
  assert.ok(!/env\.AI\.run/.test(index));
  const providers = read('AI-API/worker/src/providers.mjs');
  assert.ok(providers.includes('env.AI.run'));
  // No generic proxy helper.
  assert.ok(!/fetch\(\s*url\s*,/.test(index));
  // Every /v1 route is listed explicitly.
  for (const route of ["'/v1/models'", "'/v1/chat/completions'"]) assert.ok(index.includes(route), route);
  assert.ok(index.includes("return finalize(apiError(404"));
  // Provider allowlist is a closed table.
  const models = read('AI-API/worker/src/models.mjs');
  assert.ok(!/startsWith\('@cf\/'\)/.test(models), 'no prefix pass-through');
  assert.ok(models.includes('export function resolveModel'));
});

test('wrangler config declares the AI binding, the Durable Object and no secrets', () => {
  const toml = read('AI-API/worker/wrangler.toml');
  assert.ok(toml.includes('[ai]'));
  assert.ok(toml.includes('binding = "AI"'));
  assert.ok(toml.includes('class_name = "GatewayState"'));
  assert.ok(toml.includes('new_sqlite_classes'));
  assert.ok(!/KEY_PEPPER\s*=/.test(toml));
  assert.ok(!/GITHUB_TOKEN\s*=/.test(toml));
  assert.ok(!/BYOK_ENCRYPTION_KEY\s*=/.test(toml));
});

test('documentation names the exact base URL and the tested/untested boundary', () => {
  const docs = read('AI-API/Docs/index.html');
  assert.ok(docs.includes('https://htmltools-me-ai-api.bozhetarnikmatthew.workers.dev/v1'));
  assert.ok(docs.includes('GET /v1/models'));
  assert.ok(docs.includes('POST /v1/chat/completions'));
  assert.ok(docs.includes('free_pool_exhausted'));
  assert.ok(docs.includes('verify after deploy'));
  assert.ok(read('AI-API/index.html').includes('never falls back to a paid model'));
});

test('gateway worker test suite passes', () => {
  const dir = root + 'AI-API/worker/tests/';
  const files = readdirSync(dir).filter(name => name.endsWith('.test.mjs')).map(name => 'tests/' + name);
  const childEnv = { ...process.env };
  // Node marks nested test runs; clear it so the gateway suite runs as its own process.
  delete childEnv.NODE_TEST_CONTEXT;
  const result = spawnSync('node', ['--test', ...files], {
    cwd: root + 'AI-API/worker',
    encoding: 'utf8',
    timeout: 180_000,
    env: childEnv,
  });
  const output = (result.stdout || '') + (result.stderr || '');
  assert.equal(result.status, 0, output);
  assert.match(output, /# fail 0/);
  assert.match(output, /# pass 3\d/);
});

test('the single-file worker bundle is committed and self-contained', () => {
  const file = path.join(root, 'AI-API/worker/worker.js');
  assert.ok(existsSync(file), 'worker.js bundle exists');
  const code = readFileSync(file, 'utf8');
  assert.ok(code.length > 40_000, 'bundle contains the whole worker');
  assert.ok(!/from\s+['"]\.\//.test(code), 'bundle has no relative imports');
  assert.match(code, /export\s*\{[^}]*GatewayState/);
  assert.match(code, /generated file, do not edit/);
  assert.ok(!/KEY_PEPPER\s*=\s*['"][^'"]{8,}/.test(code), 'no pepper in the bundle');
  assert.ok(!/sb_secret|sk_live|ghp_[A-Za-z0-9]{20,}/.test(code), 'no credentials in the bundle');
});
