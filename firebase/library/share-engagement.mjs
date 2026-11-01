// Owner-only utility: spread engagement totals across ALL published books in
// htmltools2, randomly and bounded (exact sums; no book gets more than ~2x the
// even share; every book gets a share when the total allows). Reuses the exact
// allocation algorithm from the server engagement module (server/engagement.js).
//
// Server-side only — uses the Admin SDK, so it cannot be forged from devtools.
//
// Usage:
//   $env:GOOGLE_APPLICATION_CREDENTIALS="C:\...\htmltools2-firebase-adminsdk-....json"
//   node share-engagement.mjs <views> <likes> <hours>
//   e.g. node share-engagement.mjs 10000 1000 100
import { initializeApp, cert } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';
import { readFileSync } from 'node:fs';
import { parseTotals, catalogIds, buildAllocation } from './server/engagement.js';

const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
if (!credPath) { console.error('Set GOOGLE_APPLICATION_CREDENTIALS to the htmltools2 service-account JSON first.'); process.exit(1); }
const [, , v, l, h] = process.argv;
let totals;
try { totals = parseTotals({ views: Number(v), likes: Number(l), hours: Number(h) }); }
catch (e) { console.error(e.message); process.exit(1); }

const app = initializeApp({ credential: cert(JSON.parse(readFileSync(credPath, 'utf8'))), databaseURL: 'https://htmltools2-default-rtdb.firebaseio.com' });
const db = getDatabase(app);
const snap = await db.ref('bookStats').get();
const ids = catalogIds(snap.val() || {});
const allocation = buildAllocation(totals, ids);

const update = {};
for (const [id, delta] of Object.entries(allocation)) {
  const cur = (snap.val() || {})[id] || {};
  for (const [k, dv] of Object.entries(delta)) {
    update[`bookStats/${id}/${k}`] = (cur[k] || 0) + dv;
    update[`books/${id}/${k}`] = ((await db.ref(`books/${id}/${k}`).get()).val() || 0) + dv;
  }
}
await db.ref().update(update);
const summary = Object.entries(allocation).slice(0, 5)
  .map(([id, d]) => `${id}: +${d.views}v/+${d.likes}l`).join(', ');
console.log(`Shared ${totals.views} views, ${totals.likes} likes, ${totals.hours} hours across ${ids.length} books (exact sums, bounded random split).`);
console.log('Sample:', summary, '…');
process.exit(0);
