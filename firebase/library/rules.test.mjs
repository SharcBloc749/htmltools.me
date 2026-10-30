import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { ref, get, set, update } from 'firebase/database';
const rules = readFileSync(new URL('database.rules.json', import.meta.url), 'utf8');
let env;
test.before(async () => {
  if (!process.env.FIREBASE_DATABASE_EMULATOR_HOST) return;
  env = await initializeTestEnvironment({ projectId: 'demo-htmltools-library', database: { rules, host: '127.0.0.1', port: 9000 } });
});
test.after(async () => { if (env) await env.cleanup(); });
test('anonymous and non-owner sessions cannot read admin data or write engagement', async t => {
  if (!env) return t.skip('FIREBASE_DATABASE_EMULATOR_HOST is not set');
  await env.withSecurityRulesDisabled(async ctx => {
    await set(ref(ctx.database(), 'bookStats/book1'), { ownerId: 'author', title: 'Book', likes: 1, views: 10, playtimeSeconds: 60 });
    await set(ref(ctx.database(), 'users/victim'), { email: 'private@example.test' });
    await set(ref(ctx.database(), 'engagementShares/share1'), { status: 'complete' });
  });
  const anon = env.unauthenticatedContext();
  const user = env.authenticatedContext('reader', { librarySession: true });
  const owner = env.authenticatedContext('owner', { librarySession: true, libraryOwner: true });
  await assertSucceeds(get(ref(anon, 'bookStats/book1')));
  await assertFails(get(ref(anon, 'users/victim')));
  await assertFails(get(ref(user, 'users/victim')));
  await assertSucceeds(get(ref(owner, 'users/victim')));
  await assertFails(set(ref(user, 'bookEngagement/book1'), { likes: 999 }));
  await assertFails(set(ref(user, 'engagementShares/share1'), { status: 'complete' }));
  await assertFails(update(ref(user, 'bookStats/book1'), { likes: 999 }));
  await assertFails(update(ref(owner, 'bookStats/book1'), { likes: 999 }));
  await assertFails(set(ref(user, 'siteConfig/adminEmails/evil'), 'evil@example.test'));
  await assertFails(set(ref(user, 'userLikes/reader/book1'), true));
});
