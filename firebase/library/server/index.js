import { initializeApp, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getDatabase } from 'firebase-admin/database';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { defineString } from 'firebase-functions/params';
import { randomUUID } from 'node:crypto';
import { parseTotals, catalogIds, newPreview, publicPreview, applyToEngagement, counter, RequestError, MAX_BOOKS } from './engagement.js';

if (!getApps().length) initializeApp({ databaseURL: 'https://htmltools2-default-rtdb.firebaseio.com' });
const oldAuthApp = getApps().find(app => app.name === 'library-auth') || initializeApp({ projectId: 'htmltools-library' }, 'library-auth');
const db = getDatabase();
const ownerUid = defineString('LIBRARY_OWNER_UID');
const catalogUrl = defineString('LIBRARY_CATALOG_URL', { default: 'https://black-field-f5e8.bozhetarnikmatthew.workers.dev/github/index.json' });
const OWNER_EMAIL = 'matthewbozhe@gmail.com';
let catalogCache = { ids: null, expires: 0 };
const CATALOG_CACHE_MS = 60 * 1000;
// Callable functions must be reachable by the browser before Firebase Auth can
// run inside the handler. `invoker: 'public'` only opens the Cloud Run IAM gate;
// every handler still verifies a Firebase ID token and the librarySession claim.
// If an existing Cloud Run service was made private, redeploying alone may not
// repair IAM — see firebase/library/README.md ("Callable CORS / invoker").
const LIBRARY_ORIGINS = ['https://htmltools.me', 'https://www.htmltools.me'];
const opts = {
  region: 'us-central1',
  maxInstances: 10,
  timeoutSeconds: 60,
  memory: '256MiB',
  cors: LIBRARY_ORIGINS,
  invoker: 'public',
  ingressSettings: 'ALLOW_ALL',
  // App Check is optional anti-abuse, not authorization. Keep callables usable
  // while the site's reCAPTCHA/App Check registration is being repaired.
  enforceAppCheck: false
};

function fail(error) {
  if (error instanceof RequestError) return new HttpsError(error.code, error.message);
  if (error instanceof HttpsError) return error;
  console.error(error);
  return new HttpsError('internal', 'The Library service could not complete this request.');
}
function validId(id) {
  if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(id)) throw new HttpsError('invalid-argument', 'Invalid book or request ID.');
  return id;
}
async function verifiedOld(request) {
  // The browser signs into the legacy Auth project, but this function lives in
  // the data project. Accept the legacy ID token in the body and verify it with
  // the legacy Admin SDK; never trust uid/email fields supplied by the browser.
  const raw = request.data?.idToken;
  if (typeof raw !== 'string' || raw.length > 8192) throw new HttpsError('unauthenticated', 'Sign in first.');
  try { return await getAuth(oldAuthApp).verifyIdToken(raw, true); }
  catch { throw new HttpsError('unauthenticated', 'Your session expired. Sign in again.'); }
}
async function verifiedNew(request) {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in first.');
  const raw = request.rawRequest.headers.authorization?.replace(/^Bearer\s+/i, '');
  if (!raw) throw new HttpsError('unauthenticated', 'Sign in first.');
  let token;
  try { token = await getAuth().verifyIdToken(raw, true); }
  catch { throw new HttpsError('unauthenticated', 'Your session expired. Sign in again.'); }
  if (token.librarySession !== true) throw new HttpsError('permission-denied', 'A Library session is required.');
  return token;
}
function requireOwner(token) {
  const configured = ownerUid.value();
  if (!configured || token.uid !== configured || token.libraryOwner !== true) throw new HttpsError('permission-denied', 'Only the verified Library owner can use this control.');
}
async function requireActive(token) {
  const banned = await db.ref(`bannedUsers/${token.uid}`).get();
  if (banned.exists()) throw new HttpsError('permission-denied', 'This account cannot change Library engagement.');
}
async function fetchCatalog(force = false) {
  if (!force && catalogCache.ids && Date.now() < catalogCache.expires) return catalogCache.ids;
  const url = new URL(catalogUrl.value());
  if (url.protocol !== 'https:' || url.hostname !== 'black-field-f5e8.bozhetarnikmatthew.workers.dev' || url.pathname !== '/github/index.json') throw new HttpsError('failed-precondition', 'The catalog source is not configured correctly.');
  const response = await fetch(url, { signal: AbortSignal.timeout(15000), headers: { Accept: 'application/json' }, redirect: 'error' });
  if (!response.ok) throw new HttpsError('unavailable', 'The book catalog is temporarily unavailable.');
  const length = Number(response.headers.get('content-length') || 0);
  if (length > 8 * 1024 * 1024) throw new HttpsError('failed-precondition', 'The catalog is too large.');
  const text = await response.text();
  if (text.length > 8 * 1024 * 1024) throw new HttpsError('failed-precondition', 'The catalog is too large.');
  let payload;
  try { payload = JSON.parse(text); } catch { throw new HttpsError('failed-precondition', 'The catalog returned invalid JSON.'); }
  const ids = catalogIds(payload.games);
  catalogCache = { ids, expires: Date.now() + CATALOG_CACHE_MS };
  return ids;
}

export const createLibrarySession = onCall(opts, async request => {
  try {
    const token = await verifiedOld(request);
    const configured = ownerUid.value();
    const isOwner = !!configured && token.uid === configured && token.email_verified === true && typeof token.email === 'string' && token.email.toLowerCase() === OWNER_EMAIL;
    const customToken = await getAuth().createCustomToken(token.uid, { librarySession: true, ...(isOwner ? { libraryOwner: true } : {}) });
    return { customToken, owner: isOwner };
  } catch (error) { throw fail(error); }
});

async function seedEngagement(id) {
  const ref = db.ref(`bookEngagement/${id}`);
  const snap = await ref.get();
  if (snap.exists()) return;
  const stats = (await db.ref(`bookStats/${id}`).get()).val() || {};
  await ref.transaction(current => current || {
    views: counter(stats.views), likes: counter(stats.likes), playtimeSeconds: counter(stats.playtimeSeconds),
    adjustedViews: 0, adjustedLikes: 0, adjustedPlaytimeSeconds: 0,
    likedBy: stats.likedBy && typeof stats.likedBy === 'object' ? stats.likedBy : {}, appliedShares: {}
  });
}
async function mirror(id, engagement) {
  await db.ref().update({
    [`bookStats/${id}/views`]: counter(engagement.views),
    [`bookStats/${id}/likes`]: counter(engagement.likes),
    [`bookStats/${id}/playtimeSeconds`]: counter(engagement.playtimeSeconds),
    [`books/${id}/views`]: counter(engagement.views),
    [`books/${id}/likes`]: counter(engagement.likes),
    [`books/${id}/playtimeSeconds`]: counter(engagement.playtimeSeconds)
  });
}

export const toggleBookLike = onCall(opts, async request => {
  try {
    const token = await verifiedNew(request); await requireActive(token);
    const id = validId(request.data?.bookId);
    const catalog = await fetchCatalog();
    if (!catalog.includes(id)) throw new HttpsError('not-found', 'This book is no longer published.');
    await seedEngagement(id);
    const result = await db.ref(`bookEngagement/${id}`).transaction(current => {
      const value = current || { views: 0, likes: 0, playtimeSeconds: 0, likedBy: {} };
      const likedBy = { ...(value.likedBy || {}) };
      const liked = !!likedBy[token.uid];
      if (liked) delete likedBy[token.uid]; else likedBy[token.uid] = true;
      return { ...value, likedBy, likes: Math.max(0, counter(value.likes) + (liked ? -1 : 1)) };
    });
    const engagement = result.snapshot.val();
    const liked = !!engagement.likedBy?.[token.uid];
    await db.ref().update({
      [`userLikes/${token.uid}/${id}`]: liked ? true : null,
      [`bookStats/${id}/likes`]: engagement.likes, [`books/${id}/likes`]: engagement.likes,
      [`bookStats/${id}/likedBy/${token.uid}`]: liked ? true : null, [`books/${id}/likedBy/${token.uid}`]: liked ? true : null
    });
    return { liked, likes: engagement.likes };
  } catch (error) { throw fail(error); }
});

export const recordBookView = onCall(opts, async request => {
  try {
    const token = await verifiedNew(request); await requireActive(token);
    const id = validId(request.data?.bookId);
    const catalog = await fetchCatalog();
    if (!catalog.includes(id)) throw new HttpsError('not-found', 'This book is no longer published.');
    await seedEngagement(id);
    const result = await db.ref(`bookEngagement/${id}`).transaction(current => ({ ...(current || {}), views: counter(current?.views) + 1 }));
    const value = result.snapshot.val();
    await db.ref().update({ [`bookStats/${id}/views`]: value.views, [`books/${id}/views`]: value.views });
    return { views: value.views };
  } catch (error) { throw fail(error); }
});

export const recordBookPlaytime = onCall(opts, async request => {
  try {
    const token = await verifiedNew(request); await requireActive(token);
    const id = validId(request.data?.bookId);
    const seconds = request.data?.seconds;
    if (!Number.isSafeInteger(seconds) || seconds < 1 || seconds > 300) throw new HttpsError('invalid-argument', 'Playtime must be between 1 and 300 seconds per update.');
    const catalog = await fetchCatalog();
    if (!catalog.includes(id)) throw new HttpsError('not-found', 'This book is no longer published.');
    await seedEngagement(id);
    const result = await db.ref(`bookEngagement/${id}`).transaction(current => ({ ...(current || {}), playtimeSeconds: counter(current?.playtimeSeconds) + seconds }));
    const value = result.snapshot.val();
    await db.ref().update({ [`bookStats/${id}/playtimeSeconds`]: value.playtimeSeconds, [`books/${id}/playtimeSeconds`]: value.playtimeSeconds });
    return { playtimeSeconds: value.playtimeSeconds };
  } catch (error) { throw fail(error); }
});

export const rateBook = onCall(opts, async request => {
  try {
    const token = await verifiedNew(request); await requireActive(token);
    const id = validId(request.data?.bookId);
    const rating = request.data?.rating;
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) throw new HttpsError('invalid-argument', 'Rating must be a whole number from 1 to 5.');
    const catalog = await fetchCatalog();
    if (!catalog.includes(id)) throw new HttpsError('not-found', 'This book is no longer published.');
    const stats = (await db.ref(`bookStats/${id}`).get()).val();
    if (stats?.ownerId === token.uid) throw new HttpsError('permission-denied', 'Owners cannot rate their own books.');
    await db.ref(`ratings/${id}/${token.uid}`).set({ rating, ratedAt: Date.now() });
    const snap = await db.ref(`ratings/${id}`).get();
    const values = Object.values(snap.val() || {}).map(r => Number(r?.rating)).filter(v => Number.isInteger(v) && v >= 1 && v <= 5);
    const ratingCount = values.length;
    const ratingAvg = ratingCount ? Math.round(values.reduce((a, b) => a + b, 0) / ratingCount * 10) / 10 : 0;
    await db.ref().update({ [`bookStats/${id}/ratingAvg`]: ratingAvg, [`bookStats/${id}/ratingCount`]: ratingCount, [`books/${id}/ratingAvg`]: ratingAvg, [`books/${id}/ratingCount`]: ratingCount });
    return { ratingAvg, ratingCount };
  } catch (error) { throw fail(error); }
});

export const previewLibraryEngagement = onCall(opts, async request => {
  try {
    const token = await verifiedNew(request); requireOwner(token);
    const totals = parseTotals(request.data);
    const ids = await fetchCatalog();
    const preview = newPreview(totals, ids);
    await db.ref(`engagementPreviews/${preview.id}`).set({ ...preview, ownerUid: token.uid });
    return publicPreview(preview);
  } catch (error) { throw fail(error); }
});

export const shareLibraryEngagement = onCall({ ...opts, timeoutSeconds: 540 }, async request => {
  try {
    const token = await verifiedNew(request); requireOwner(token);
    const id = validId(request.data?.previewId);
    const previewRef = db.ref(`engagementPreviews/${id}`);
    const preview = (await previewRef.get()).val();
    if (!preview || preview.ownerUid !== token.uid) throw new HttpsError('not-found', 'Preview not found. Generate a new preview.');
    const ledgerRef = db.ref(`engagementShares/${id}`);
    const existing = (await ledgerRef.get()).val();
    if (existing?.status === 'complete') return { ok: true, duplicate: true, bookCount: preview.bookCount, totals: preview.totals };
    if (Date.now() > preview.expiresAt && !existing) throw new HttpsError('deadline-exceeded', 'This preview expired. Generate a new preview.');
    const ids = await fetchCatalog(true);
    const previewIds = Object.keys(preview.allocations || {}).sort();
    if (ids.length !== previewIds.length || ids.some((bookId, i) => bookId !== previewIds[i])) throw new HttpsError('failed-precondition', 'The catalog changed after preview. Generate a new preview.');
    await ledgerRef.transaction(current => current || { ownerUid: token.uid, status: 'processing', startedAt: Date.now(), totals: preview.totals, bookCount: preview.bookCount });
    for (const bookId of ids) {
      await seedEngagement(bookId);
      const result = await db.ref(`bookEngagement/${bookId}`).transaction(current => applyToEngagement(current, preview.allocations[bookId], id));
      await mirror(bookId, result.snapshot.val());
    }
    await ledgerRef.update({ status: 'complete', completedAt: Date.now() });
    await db.ref('activityLog').push({ type: 'engagement', message: `Owner shared ${preview.totals.views} views, ${preview.totals.likes} likes and ${preview.totals.hours} hours across ${ids.length} books.`, uid: token.uid, ts: Date.now(), shareId: id });
    return { ok: true, duplicate: false, bookCount: ids.length, totals: preview.totals };
  } catch (error) { throw fail(error); }
});
