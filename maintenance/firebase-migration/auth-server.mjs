import http from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { initializeApp, cert, deleteApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

const SOURCE = 'website-encryption-htmltools', TARGET = 'general-database-4cb1c';
const secret = randomBytes(32).toString('hex');
const port = Number(process.env.PORT || 8787);
let session = null, busy = false;
function equal(a, b) { const x = Buffer.from(a || ''), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); }
function response(res, code, value) { res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(JSON.stringify(value)); }
async function body(req) { let text = ''; for await (const chunk of req) { text += chunk; if (Buffer.byteLength(text) > 1024 * 1024) throw Error('Request too large'); } return JSON.parse(text); }
async function clear() { if (session) { const apps = session.apps; session = null; await Promise.all(apps.map(deleteApp)); } }
function account(u) {
  const data = { uid: u.uid, disabled: u.disabled, emailVerified: u.emailVerified };
  for (const k of ['email', 'displayName', 'photoURL', 'phoneNumber', 'customClaims']) if (u[k] !== undefined) data[k] = u[k];
  if (u.metadata) data.metadata = Object.fromEntries(['creationTime', 'lastSignInTime'].filter(k => u.metadata[k]).map(k => [k, u.metadata[k]]));
  if (u.passwordHash) { data.passwordHash = Buffer.from(u.passwordHash, 'base64'); data.passwordSalt = Buffer.from(u.passwordSalt || '', 'base64'); }
  data.providerData = u.providerData.map(p => Object.fromEntries(['uid', 'providerId', 'email', 'displayName', 'photoURL'].filter(k => p[k] !== undefined).map(k => [k, p[k]])));
  return data;
}
async function all(auth) { const users = []; let page; do { const result = await auth.listUsers(1000, page); users.push(...result.users); page = result.pageToken; } while (page); return users; }
const server = http.createServer(async (req, res) => {
  // This is a local administrative application, not a public website.
  if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress)) return response(res, 403, { error: 'Local connections only' });
  const host = req.headers.host;
  if (![`localhost:${port}`, `127.0.0.1:${port}`].includes(host)) return response(res, 403, { error: 'Invalid host' });
  const url = new URL(req.url, `http://${host}`);
  if (req.method === 'GET' && url.pathname === '/' && equal(url.searchParams.get('key'), secret)) {
    res.writeHead(303, { Location: '/auth', 'Set-Cookie': `migration=${secret}; HttpOnly; SameSite=Strict; Path=/`, 'Cache-Control': 'no-store' }); return res.end();
  }
  const cookie = req.headers.cookie?.split(';').map(s => s.trim()).find(s => s.startsWith('migration='))?.slice(10);
  if (!equal(cookie, secret)) return response(res, 403, { error: 'Open the private URL printed in your terminal.' });
  if (req.method === 'GET' && url.pathname === '/auth') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; form-action 'none'", 'Referrer-Policy': 'no-referrer' });
    return res.end(await readFile(new URL('./auth-transfer.html', import.meta.url)));
  }
  if (req.method !== 'POST' || req.headers.origin !== `http://${host}` || !req.headers['content-type']?.startsWith('application/json')) return response(res, 403, { error: 'Invalid request origin or method' });
  if (busy) return response(res, 409, { error: 'A migration operation is already running. Wait for it to finish.' });
  busy = true;
  try {
    const input = await body(req);
    if (url.pathname === '/prepare') {
      await clear();
      if (input.source?.project_id !== SOURCE || input.target?.project_id !== TARGET) throw Error('Select service-account JSON files for the exact source and destination projects shown.');
      const apps = [];
      try {
        apps.push(initializeApp({ credential: cert(input.source), projectId: SOURCE }, 'source-' + Date.now()));
        apps.push(initializeApp({ credential: cert(input.target), projectId: TARGET }, 'target-' + Date.now()));
        const [users, destination] = await Promise.all(apps.map(a => all(getAuth(a))));
        if (destination.length) throw Error('Destination already contains accounts. This tool only imports into an empty destination to avoid overwrites and email/UID collisions. Back up and reconcile existing users separately.');
        if (!users.length) throw Error('No source users found. Nothing to import.');
        if (users.some(u => u.multiFactor?.enrolledFactors?.length)) throw Error('MFA accounts detected. Use a specialized migration; this tool will not silently drop MFA.');
        const passwordUsers = users.filter(u => u.passwordHash || u.providerData.some(p => p.providerId === 'password'));
        if (passwordUsers.some(u => !u.passwordHash || u.passwordHash === 'UkVEQUNURUQ=')) throw Error('Password hashes are unavailable/redacted. Grant the source service account firebaseauth.configs.getHashConfig permission, then preview again.');
        session = { apps, users };
        response(res, 200, { users: users.length, passwords: passwordUsers.length, disabled: users.filter(u => u.disabled).length, claims: users.filter(u => u.customClaims).length, destinationUsers: 0 });
      } catch (e) { await Promise.all(apps.map(deleteApp)); throw e; }
    } else if (url.pathname === '/transfer') {
      if (!session || input.confirm !== TARGET) throw Error('Preview first, then type the destination project ID to confirm.');
      const destination = getAuth(session.apps[1]);
      if ((await destination.listUsers(1)).users.length) throw Error('Destination is no longer empty. Stop and reconcile accounts before retrying.');
      const config = input.hash || {};
      let hash;
      if (session.users.some(u => u.passwordHash)) {
        const decode = (s, label) => { if (typeof s !== 'string' || !s || s.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(s)) throw Error('Invalid base64 ' + label); return Buffer.from(s, 'base64'); };
        if (!Number.isInteger(config.rounds) || config.rounds < 1 || !Number.isInteger(config.memoryCost) || config.memoryCost < 1) throw Error('Enter the exact source rounds and memory cost.');
        hash = { algorithm: 'SCRYPT', key: decode(config.key, 'signer key'), saltSeparator: decode(config.saltSeparator, 'salt separator'), rounds: config.rounds, memoryCost: config.memoryCost };
      }
      const report = { attempted: 0, imported: 0, failures: [] };
      for (let i = 0; i < session.users.length; i += 1000) {
        const batch = session.users.slice(i, i + 1000).map(account);
        const result = await destination.importUsers(batch, hash ? { hash } : undefined);
        report.attempted += batch.length; report.imported += result.successCount;
        report.failures.push(...result.errors.map(e => ({ uid: batch[e.index].uid, error: e.error.code })));
      }
      report.destinationCount = (await all(destination)).length;
      report.note = 'Source accounts were not modified. Verify original passwords, providers, UIDs, claims and disabled status before cutover. No database data copied.';
      await clear(); response(res, 200, report);
    } else if (url.pathname === '/clear') { await clear(); response(res, 200, { cleared: true }); }
    else response(res, 404, { error: 'Not found' });
  } catch (e) {
    // Do not log credential material or include arbitrary upstream response bodies.
    response(res, 400, { error: e.code ? `Firebase operation failed (${e.code}). Check permissions and configuration. If transfer started, inspect destination for partial imports before retrying.` : e.message });
  } finally { busy = false; }
});
server.listen(port, '0.0.0.0', () => console.log(`Open this PRIVATE URL on this computer:\nhttp://localhost:${port}/?key=${secret}\nKeep this terminal open. Ctrl+C stops the server. Do not publish this service.`));
process.on('SIGINT', async () => { server.close(); await clear(); process.exit(); });
