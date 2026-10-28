// Run locally with Application Default Credentials; never deploy credentials.
import { readFile } from 'node:fs/promises';
import { initializeApp, applicationDefault, deleteApp } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const file = args.find(a => !a.startsWith('--'));
if (!file || args.some(a => a.startsWith('--') && a !== '--apply')) {
  console.error('Usage: node import-data.mjs approved-data.json [--apply]');
  process.exit(1);
}
const data = JSON.parse(await readFile(file, 'utf8'));
if (!data || typeof data !== 'object' || Array.isArray(data)) throw Error('Expected a JSON root object');
const keyOK = key => key.length > 0 && !/[.#$\[\]/\u0000-\u001f\u007f]/.test(key);
function validate(value, depth = 0) {
  if (depth > 30) throw Error('Data too deeply nested');
  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      if (!keyOK(key)) throw Error('Invalid Firebase key: ' + key);
      validate(child, depth + 1);
    }
  }
}
validate(data);
const app = initializeApp({ credential: applicationDefault(), projectId: 'general-database-4cb1c', databaseURL: 'https://general-database-4cb1c-default-rtdb.firebaseio.com' });
const db = getDatabase(app);
let conflicts = 0, imported = 0, planned = 0;
try {
  for (const [collection, children] of Object.entries(data)) {
    // Treat a non-object collection as one record, without flattening arrays.
    const entries = children && typeof children === 'object' && !Array.isArray(children)
      ? Object.entries(children).map(([id, value]) => [collection + '/' + id, value])
      : [[collection, children]];
    for (const [path, value] of entries) {
      if (value === null) { console.log('SKIP null (would delete):', path); continue; }
      if (Buffer.byteLength(JSON.stringify(value)) > 15 * 1024 * 1024) throw Error('Record exceeds safe transaction size: ' + path);
      const ref = db.ref(path);
      if (!apply) {
        if ((await ref.get()).exists()) { conflicts++; console.log('CONFLICT — will preserve:', path); }
        else { planned++; console.log('WOULD COPY:', path); }
      } else {
        // Atomic create-only: never overwrite a concurrent write or existing account.
        const result = await ref.transaction(current => current === null ? value : undefined, undefined, false);
        if (result.committed) { imported++; console.log('COPIED:', path); }
        else { conflicts++; console.log('CONFLICT — preserved:', path); }
      }
    }
  }
  console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', imported, planned, conflicts }));
  if (conflicts) process.exitCode = 2;
} finally { await deleteApp(app); }
