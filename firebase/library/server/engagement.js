import { randomInt, randomUUID } from 'node:crypto';

export const MAX_BOOKS = 5000;
export const LIMITS = Object.freeze({ views: 10000000, likes: 1000000, hours: 100000 });
export const METRICS = Object.freeze(['views', 'likes', 'playtimeSeconds']);

export class RequestError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

export function parseTotals(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new RequestError('invalid-argument', 'Enter views, likes and hours.');
  const out = {};
  for (const key of ['views', 'likes', 'hours']) {
    const value = input[key];
    if (!Number.isSafeInteger(value) || value < 0 || value > LIMITS[key]) {
      throw new RequestError('invalid-argument', `${key} must be a whole number from 0 to ${LIMITS[key].toLocaleString('en-US')}.`);
    }
    out[key] = value;
  }
  if (!out.views && !out.likes && !out.hours) throw new RequestError('invalid-argument', 'Enter at least one positive total.');
  if (out.likes > out.views) throw new RequestError('invalid-argument', 'Likes cannot exceed views for the same Share.');
  return out;
}

export function catalogIds(games) {
  if (!games || typeof games !== 'object' || Array.isArray(games)) throw new RequestError('failed-precondition', 'The book catalog is unavailable.');
  const ids = Object.keys(games).filter(id => /^[A-Za-z0-9_-]{1,128}$/.test(id) && games[id] && typeof games[id].title === 'string' && games[id].title.trim()).sort();
  if (!ids.length) throw new RequestError('failed-precondition', 'There are no published books to share across.');
  if (ids.length > MAX_BOOKS) throw new RequestError('failed-precondition', `The catalog exceeds the ${MAX_BOOKS}-book safety limit.`);
  return ids;
}

// Bounded jitter around the mean, then largest-remainder rounding. Every book
// receives a share when the total is at least the book count; no book receives
// more than twice the equal-share amount (plus rounding). The sum is exact.
export function allocate(total, count, rng = randomInt) {
  if (!Number.isSafeInteger(total) || total < 0 || total > Number.MAX_SAFE_INTEGER) throw new RequestError('invalid-argument', 'Invalid total.');
  if (!Number.isSafeInteger(count) || count < 1 || count > MAX_BOOKS) throw new RequestError('invalid-argument', 'Invalid book count.');
  if (total === 0) return Array(count).fill(0);
  const weights = Array.from({ length: count }, () => 75 + rng(0, 51)); // 0.75..1.25
  const weightSum = weights.reduce((a, b) => a + b, 0);
  const exact = weights.map(w => total * w / weightSum);
  const shares = exact.map(Math.floor);
  let remainder = total - shares.reduce((a, b) => a + b, 0);
  const order = exact.map((value, index) => ({ index, fraction: value - shares[index], tie: rng(0, 1000000) }))
    .sort((a, b) => b.fraction - a.fraction || b.tie - a.tie || a.index - b.index);
  for (let i = 0; i < remainder; i++) shares[order[i % count].index]++;
  // Guarantee coverage when mathematically possible without breaking the sum.
  if (total >= count) {
    for (let i = 0; i < count; i++) {
      while (shares[i] === 0) {
        const donor = shares.findIndex((value, j) => j !== i && value > Math.max(1, Math.floor(total / count)));
        if (donor < 0) break;
        shares[donor]--; shares[i]++;
      }
    }
  }
  return shares;
}

export function buildAllocation(totals, ids) {
  const views = allocate(totals.views, ids.length);
  const likes = allocate(totals.likes, ids.length);
  // Keep likes <= views per book while preserving both exact totals.
  for (let i = 0; i < ids.length; i++) {
    while (likes[i] > views[i]) {
      const to = likes.findIndex((value, j) => j !== i && value < views[j]);
      if (to < 0) throw new RequestError('failed-precondition', 'Cannot allocate likes without exceeding per-book views.');
      likes[i]--; likes[to]++;
    }
  }
  const seconds = allocate(totals.hours * 3600, ids.length);
  return Object.fromEntries(ids.map((id, i) => [id, { views: views[i], likes: likes[i], playtimeSeconds: seconds[i] }]));
}

export function newPreview(totals, ids) {
  return { id: randomUUID(), totals, allocations: buildAllocation(totals, ids), bookCount: ids.length, createdAt: Date.now(), expiresAt: Date.now() + 10 * 60 * 1000 };
}

export function publicPreview(preview) {
  return { id: preview.id, totals: preview.totals, bookCount: preview.bookCount, expiresAt: preview.expiresAt, allocations: preview.allocations };
}

export function counter(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

export function applyToEngagement(current, delta, shareId) {
  const base = current && typeof current === 'object' ? current : {};
  if (base.appliedShares && base.appliedShares[shareId]) return base;
  const next = {
    ...base,
    views: counter(base.views) + counter(delta.views),
    likes: counter(base.likes) + counter(delta.likes),
    playtimeSeconds: counter(base.playtimeSeconds) + counter(delta.playtimeSeconds),
    adjustedViews: counter(base.adjustedViews) + counter(delta.views),
    adjustedLikes: counter(base.adjustedLikes) + counter(delta.likes),
    adjustedPlaytimeSeconds: counter(base.adjustedPlaytimeSeconds) + counter(delta.playtimeSeconds),
    appliedShares: { ...(base.appliedShares || {}), [shareId]: true }
  };
  for (const metric of METRICS) if (!Number.isSafeInteger(next[metric]) || next[metric] < 0) throw new RequestError('failed-precondition', 'Counter overflow.');
  return next;
}
