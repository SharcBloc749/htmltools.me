import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';

test('local admin UI requires a private session, validates origin and refuses invalid projects', async () => {
  const port = 18787;
  const proc = spawn(process.execPath, ['auth-server.mjs'], { cwd: new URL('.', import.meta.url), env: { ...process.env, PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  const ready = new Promise((resolve, reject) => {
    proc.stdout.on('data', chunk => { log += chunk; if (log.includes('Keep this terminal')) resolve(); });
    proc.once('exit', code => reject(Error('Server exited: ' + code)));
    proc.stderr.on('data', chunk => reject(Error(String(chunk))));
  });
  try {
    await Promise.race([ready, new Promise((_, reject) => { const timer = setTimeout(() => reject(Error('Startup timeout')), 10000); timer.unref(); })]);
    const origin = `http://localhost:${port}`;
    assert.equal((await fetch(origin + '/auth')).status, 403);
    const key = log.match(/key=([a-f0-9]+)/)[1];
    const login = await fetch(origin + '/?key=' + key, { redirect: 'manual' });
    assert.equal(login.status, 303);
    const cookie = login.headers.get('set-cookie').split(';')[0];
    const page = await fetch(origin + '/auth', { headers: { Cookie: cookie } });
    assert.equal(page.status, 200); assert.match(await page.text(), /Transfer Firebase accounts/);
    const post = (path, data, requestOrigin = origin) => fetch(origin + path, { method: 'POST', headers: { Cookie: cookie, Origin: requestOrigin, 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    assert.equal((await post('/clear', {}, 'https://evil.example')).status, 403);
    const invalid = await post('/prepare', { source: { project_id: 'wrong' }, target: {} });
    assert.equal(invalid.status, 400); assert.match((await invalid.json()).error, /exact source/);
    assert.equal((await post('/transfer', { confirm: 'general-database-4cb1c' })).status, 400);
    assert.deepEqual(await (await post('/clear', {})).json(), { cleared: true });
  } finally { const exited = once(proc, 'exit'); proc.kill('SIGINT'); await exited; }
});

test('auth HTML has valid inline JavaScript and no external resources', async () => {
  const html = await readFile(new URL('./auth-transfer.html', import.meta.url), 'utf8');
  const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  assert.doesNotThrow(() => new Function(script));
  assert.ok(!/<(?:script|link|img)[^>]+(?:src|href)=/i.test(html));
  assert.ok(!script.includes('innerHTML'));
});
