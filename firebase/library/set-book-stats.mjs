// Owner-only utility: set exact engagement counters for a book in htmltools2.
// Uses the Admin SDK (service-account key), so it bypasses client rules the
// same way the old server-side engagement tool did. Never run this from the
// browser — it must stay a server-side/owner action.
//
// Usage:
//   $env:GOOGLE_APPLICATION_CREDENTIALS="C:\...\htmltools2-firebase-adminsdk-....json"
//   node set-book-stats.mjs <bookId> [likes] [views] [playtimeSeconds]
//   node set-book-stats.mjs <bookId> 300000 100000000000000000000000000 0
import { initializeApp, cert } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';
import { readFileSync } from 'node:fs';

const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
if (!credPath) { console.error('Set GOOGLE_APPLICATION_CREDENTIALS to the htmltools2 service-account JSON first.'); process.exit(1); }
const [, , bookId, likes, views, playtime] = process.argv;
if (!bookId || !/^[A-Za-z0-9_-]{1,128}$/.test(bookId)) { console.error('Usage: node set-book-stats.mjs <bookId> [likes] [views] [playtimeSeconds]'); process.exit(1); }

const app = initializeApp({ credential: cert(JSON.parse(readFileSync(credPath, 'utf8'))), databaseURL: 'https://htmltools2-default-rtdb.firebaseio.com' });
const db = getDatabase(app);
const patch = {};
if (likes !== undefined) patch.likes = Number(likes);
if (views !== undefined) patch.views = Number(views);
if (playtime !== undefined) patch.playtimeSeconds = Number(playtime);
if (!Object.keys(patch).length) { console.error('Nothing to set.'); process.exit(1); }
for (const [k, v] of Object.entries(patch)) {
  if (!Number.isSafeInteger(v) || v < 0) { console.error(`Invalid ${k}: ${v}`); process.exit(1); }
}
await db.ref().update({
  ...Object.fromEntries(Object.entries(patch).map(([k, v]) => [`bookStats/${bookId}/${k}`, v])),
  ...Object.fromEntries(Object.entries(patch).map(([k, v]) => [`books/${bookId}/${k}`, v])),
});
console.log(`Set ${bookId}:`, patch);
process.exit(0);
