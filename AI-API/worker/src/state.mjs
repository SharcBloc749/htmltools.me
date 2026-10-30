/**
 * GatewayState — the strongly consistent authority for keys, quotas and revocations.
 *
 * Why a Durable Object: the GitHub roster and Firebase RTDB are fine for durable
 * records and dashboards, but neither gives a linearisable "reserve budget, then
 * call the provider" step. Every API request takes a short round-trip to this
 * single object, which:
 *
 *   • authenticates the presented key against its salted hash,
 *   • enforces per-key, per-user and global per-minute limits,
 *   • reserves estimated Neurons from the shared daily pool before inference,
 *   • records actual usage after the provider call settles,
 *   • flips revocations immediately (in-memory + persisted before replying).
 *
 * It is one instance for the whole site, which serialises quota decisions. At the
 * expected ~10 req/min that is far below any object throughput limit. Counters are
 * checkpointed to DO storage every ~20 s; a crash/eviction can therefore lose at
 * most a few seconds of accounting, so the Neuron budget keeps a safety margin
 * (default 6,000 of Cloudflare's 10,000 free Neurons/day).
 */

import { DAY_MS, utcDay, nextUtcMidnight } from './util.mjs';
import { estimateNeurons, resolveModel } from './models.mjs';
import { verifyKey } from './keys.mjs';
import {
  githubConfigured, readRepoFile, writeRepoFile, renderKeysFile, renderByokFile,
  parseKeysFile, parseByokFile,
} from './github.mjs';

const STORE_VERSION = 1;

function num(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

export function limits(env) {
  return {
    dailyNeurons: num(env.FREE_DAILY_NEURONS, 6000),
    dailyRequests: num(env.FREE_DAILY_REQUESTS, 1200),
    globalRpm: num(env.GLOBAL_RPM, 60),
    perKeyRpm: num(env.PER_KEY_RPM, 10),
    perUserRpm: num(env.PER_USER_RPM, 10),
    perUserDailyRequests: num(env.PER_USER_DAILY_REQUESTS, 150),
    perUserDailyNeurons: num(env.PER_USER_DAILY_NEURONS, 1200),
    byokDailyRequests: num(env.BYOK_DAILY_REQUESTS, 2000),
    maxActiveKeys: num(env.MAX_ACTIVE_KEYS, 5),
    maxKeysPerDay: num(env.MAX_KEYS_PER_DAY, 10),
    htsiloDaily: num(env.HTSILO_DAILY_MESSAGES, 15),
    htsiloRpm: num(env.HTSILO_RPM, 4),
  };
}

const emptyCounters = day => ({
  day,
  requests: 0,
  neurons: 0,
  reserved: 0,
  pending: [],
  tokensIn: 0,
  tokensOut: 0,
  byKey: {},
  byUser: {},
  minutes: {},
  history: {},
});

const MINUTE = 60_000;

export class GatewayState {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.loaded = false;
    this.keys = new Map();      // id -> record
    this.byok = new Map();      // uid -> {provider, blob, updated, verified, ref}
    this.counters = emptyCounters(utcDay());
    this.limitWindows = new Map(); // ephemeral fixed-window counters (account/reveal)
    this.dirtyCounters = false;
    this.dirtyKeys = false;
    this.dirtyByok = false;
    this.lastSync = 0;
    this.lastSyncError = '';
    this.state.blockConcurrencyWhile(() => this.load());
  }

  /* ── lifecycle ─────────────────────────────────────────────────────────── */

  async load() {
    const [meta, counters] = await Promise.all([
      this.state.storage.get('meta'),
      this.state.storage.get('counters'),
    ]);
    if (counters && counters.day) {
      this.counters = { ...emptyCounters(counters.day), ...counters };
    }
    const stored = await this.state.storage.list({ prefix: 'key:' });
    for (const [, record] of stored) {
      if (record?.id) this.keys.set(record.id, record);
    }
    const storedByok = await this.state.storage.list({ prefix: 'byok:' });
    for (const [, record] of storedByok) {
      if (record?.uid) this.byok.set(record.uid, record);
    }

    // Seed from the private GitHub roster when this object has no keys yet — that
    // file is the durable copy if the Durable Object storage is ever reset.
    if (!this.keys.size && githubConfigured(this.env)) {
      try {
        const file = await readRepoFile(this.env, this.env.GITHUB_KEYS_PATH || 'keys.js');
        const records = parseKeysFile(file?.content);
        if (records.length) {
          const writes = {};
          for (const record of records) {
            this.keys.set(record.id, record);
            writes[`key:${record.id}`] = record;
          }
          await this.state.storage.put(writes);
        }
        const byokFile = await readRepoFile(this.env, this.env.GITHUB_BYOK_PATH || 'byok.js');
        for (const entry of parseByokFile(byokFile?.content)) {
          if (!entry?.uid) continue;
          const record = {
            uid: entry.uid, ref: entry.ref || '', provider: entry.provider || 'groq',
            blob: entry.blob, updated: Number(entry.updated) || Date.now(), verified: Boolean(entry.verified),
          };
          this.byok.set(record.uid, record);
          await this.state.storage.put(`byok:${record.uid}`, record);
        }
      } catch {
        // Bootstrapping is best-effort; the object still works with what it has.
      }
    }

    this.meta = { version: STORE_VERSION, ...(meta || {}) };
    await this.rollDayIfNeeded();
    this.loaded = true;
    await this.scheduleAlarm();
  }

  async scheduleAlarm() {
    const current = await this.state.storage.getAlarm();
    if (current === null || current === undefined) {
      await this.state.storage.setAlarm(Date.now() + 30_000);
    }
  }

  async saveCounters() {
    await this.state.storage.put('counters', this.counters);
    this.dirtyCounters = false;
  }

  async persistKey(record) {
    await this.state.storage.put(`key:${record.id}`, record);
    this.dirtyKeys = true;
  }

  async persistByok(record) {
    await this.state.storage.put(`byok:${record.uid}`, record);
    this.dirtyByok = true;
  }

  async rollDayIfNeeded() {
    const today = utcDay();
    if (this.counters.day === today) return false;
    const history = this.counters.history || {};
    history[this.counters.day] = {
      requests: this.counters.requests,
      neurons: this.counters.neurons,
      tokensIn: this.counters.tokensIn,
      tokensOut: this.counters.tokensOut,
    };
    // Keep two weeks of daily totals so /account/usage can show a small chart.
    for (const day of Object.keys(history).sort().slice(0, -14)) delete history[day];
    this.counters = { ...emptyCounters(today), history };
    await this.saveCounters();
    return true;
  }

  pruneMinutes(now) {
    const cutoff = Math.floor(now / MINUTE) - 3;
    for (const key of Object.keys(this.counters.minutes)) {
      if (Number(key) < cutoff) delete this.counters.minutes[key];
    }
  }

  minuteBucket(now, create) {
    const key = String(Math.floor(now / MINUTE));
    let bucket = this.counters.minutes[key];
    if (!bucket && create) {
      bucket = { global: 0, keys: {}, users: {}, ips: {} };
      this.counters.minutes[key] = bucket;
    }
    return bucket;
  }

  /**
   * A stream that dies with the isolate, or a provider that never returns, would
   * otherwise hold its reservation for the rest of the UTC day. Expire anything
   * older than ten minutes before every decision.
   */
  pruneReservations(now) {
    if (!Array.isArray(this.counters.pending)) this.counters.pending = [];
    const cutoff = now - 10 * 60_000;
    const kept = [];
    for (const entry of this.counters.pending) {
      if (entry && entry.at >= cutoff) kept.push(entry);
      else this.counters.reserved = Math.max(0, this.counters.reserved - (entry?.amount || 0));
    }
    // Hard bound on the bookkeeping array as well.
    while (kept.length > 500) {
      const dropped = kept.shift();
      this.counters.reserved = Math.max(0, this.counters.reserved - (dropped?.amount || 0));
    }
    this.counters.pending = kept;
  }

  bump(map, key, by = 1) {
    map[key] = (map[key] || 0) + by;
    return map[key];
  }

  deny(status, code, message, extra = {}) {
    return {
      ok: false,
      status,
      code,
      message,
      retryAfter: extra.retryAfter ?? null,
      ...extra,
    };
  }

  pool() {
    const l = limits(this.env);
    const remainingNeurons = Math.max(0, l.dailyNeurons - this.counters.neurons - this.counters.reserved);
    const remainingRequests = Math.max(0, l.dailyRequests - this.counters.requests);
    return {
      day: this.counters.day,
      budget: l.dailyNeurons,
      spent: this.counters.neurons,
      reserved: this.counters.reserved,
      remaining: remainingNeurons,
      requestsToday: this.counters.requests,
      requestCap: l.dailyRequests,
      requestsRemaining: remainingRequests,
      tokensIn: this.counters.tokensIn,
      tokensOut: this.counters.tokensOut,
      resetsAt: new Date(nextUtcMidnight()).toISOString(),
    };
  }

  /* ── request handling ──────────────────────────────────────────────────── */

  async fetch(request) {
    let payload;
    try {
      payload = await request.json();
    } catch {
      return Response.json({ ok: false, code: 'bad_request', message: 'Malformed internal request.' }, { status: 400 });
    }
    const op = new URL(request.url).pathname.replace(/^\//, '');
    try {
      const handler = this[`op_${op}`];
      if (typeof handler !== 'function') {
        return Response.json({ ok: false, code: 'unknown_op', message: 'Unknown operation.' }, { status: 404 });
      }
      const result = await handler.call(this, payload || {});
      return Response.json(result);
    } catch (error) {
      return Response.json(
        { ok: false, code: error?.code || 'internal_error', message: String(error?.message || error).slice(0, 300) },
        { status: 500 },
      );
    }
  }

  async op_authorize({
    key, ip = '', provider = 'workers-ai', modelId = '', maxOutput = 512,
    inputTokens = 0, isFreePool = true, context = 'api',
  }) {
    const now = Date.now();
    await this.rollDayIfNeeded();
    this.pruneMinutes(now);
    this.pruneReservations(now);
    const l = limits(this.env);

    const id = typeof key === 'string' ? key.slice(0, 13) : '';
    const record = this.keys.get(id);
    if (!record) return this.deny(401, 'invalid_api_key', 'That API key is not valid. Create one at https://htmltools.me/AI-API/Dashboard/.');
    if (record.revoked) return this.deny(401, 'key_revoked', 'That API key has been revoked.');
    const valid = await verifyKey(key, record, this.env.KEY_PEPPER);
    if (!valid) return this.deny(401, 'invalid_api_key', 'That API key is not valid.');

    // Per-minute limits. The bucket is created before any await, so concurrent
    // requests for the same minute are counted consistently by this object.
    const bucket = this.minuteBucket(now, true);
    if ((bucket.keys[id] || 0) >= l.perKeyRpm) {
      const retry = Math.ceil((MINUTE - (now % MINUTE)) / 1000);
      return this.deny(429, 'rate_limit_exceeded', `This key allows ${l.perKeyRpm} requests per minute.`, { retryAfter: retry });
    }
    if ((bucket.users[record.uid] || 0) >= l.perUserRpm) {
      const retry = Math.ceil((MINUTE - (now % MINUTE)) / 1000);
      return this.deny(429, 'rate_limit_exceeded', `This account allows ${l.perUserRpm} requests per minute.`, { retryAfter: retry });
    }

    const userUsage = this.counters.byUser[record.uid] || { requests: 0, neurons: 0, tokens: 0 };
    const dailyCap = isFreePool ? l.perUserDailyRequests : l.byokDailyRequests;
    if (userUsage.requests >= dailyCap) {
      return this.deny(429, 'user_daily_limit', `This account allows ${dailyCap} requests per UTC day.`, {
        retryAfter: Math.ceil((nextUtcMidnight() - now) / 1000),
      });
    }

    let reserveNeurons = 0;
    let reservationId = null;
    if (isFreePool) {
      if ((bucket.global || 0) >= l.globalRpm) {
        const retry = Math.ceil((MINUTE - (now % MINUTE)) / 1000);
        return this.deny(429, 'site_rate_limit', 'The shared gateway is at its per-minute limit. Retry shortly or connect your own Groq key.', { retryAfter: retry });
      }
      if (this.counters.requests >= l.dailyRequests) {
        return this.deny(429, 'free_pool_exhausted', 'The shared free pool reached its daily request cap. It resets at 00:00 UTC; connect your own Groq key to keep going.', {
          retryAfter: Math.ceil((nextUtcMidnight() - now) / 1000),
        });
      }
      if (userUsage.neurons >= l.perUserDailyNeurons) {
        return this.deny(429, 'user_daily_limit', 'This account reached its daily share of the shared free pool. Connect your own Groq key or wait for the 00:00 UTC reset.', {
          retryAfter: Math.ceil((nextUtcMidnight() - now) / 1000),
        });
      }
      const model = resolveModel(modelId);
      reserveNeurons = model ? estimateNeurons(model, inputTokens, maxOutput) : 100;
      if (this.counters.neurons + this.counters.reserved + reserveNeurons > l.dailyNeurons) {
        return this.deny(429, 'free_pool_exhausted', 'The shared free pool is out of budget for today. It resets at 00:00 UTC; connect your own Groq key to keep going.', {
          retryAfter: Math.ceil((nextUtcMidnight() - now) / 1000),
          pool: this.pool(),
        });
      }
      this.counters.reserved += reserveNeurons;
      reservationId = crypto.randomUUID();
      this.counters.pending.push({ id: reservationId, amount: reserveNeurons, at: now });
      this.bump(bucket, 'global');
    }

    this.bump(bucket.keys, id);
    this.bump(bucket.users, record.uid);
    if (ip) this.bump(bucket.ips, ip);
    this.bump(this.counters.byKey, id);
    // `GET /v1/models` authenticates but must not burn daily quota, otherwise
    // clients that poll the catalogue would lock their own account out.
    const countsUsage = context !== 'models';
    if (countsUsage) {
      record.usage = record.usage || { requests: 0, tokens: 0 };
      record.usage.requests += 1;
    }
    if (isFreePool && countsUsage) this.counters.requests += 1;
    if (countsUsage) {
      this.counters.byUser[record.uid] = {
        requests: userUsage.requests + 1,
        neurons: userUsage.neurons,
        tokens: userUsage.tokens,
      };
    }
    record.lastUsed = now;
    this.dirtyCounters = true;
    await this.persistKey(record);

    return {
      ok: true,
      keyId: id,
      uid: record.uid,
      name: record.name,
      email: record.email,
      reservation: reserveNeurons,
      reservationId,
      context,
      limits: {
        perKeyRpm: l.perKeyRpm,
        perUserRpm: l.perUserRpm,
        dailyRequests: dailyCap,
        remainingToday: Math.max(0, dailyCap - (userUsage.requests + (context === 'models' ? 0 : 1))),
        freePool: this.pool(),
      },
    };
  }

  async op_settle({
    keyId = '', uid = '', reservation = 0, reservationId = null, isFreePool = true,
    inputTokens = 0, outputTokens = 0, success = true,
  }) {
    const now = Date.now();
    await this.rollDayIfNeeded();
    if (isFreePool) {
      if (Array.isArray(this.counters.pending)) {
        const index = this.counters.pending.findIndex(entry => entry && entry.id === reservationId);
        if (index >= 0) {
          const [entry] = this.counters.pending.splice(index, 1);
          this.counters.reserved = Math.max(0, this.counters.reserved - (entry.amount || 0));
        } else {
          this.counters.reserved = Math.max(0, this.counters.reserved - reservation);
        }
      } else {
        this.counters.reserved = Math.max(0, this.counters.reserved - reservation);
      }
      if (success) this.counters.neurons += Math.max(0, reservation);
    }
    this.counters.tokensIn += Math.max(0, inputTokens);
    this.counters.tokensOut += Math.max(0, outputTokens);

    const record = keyId ? this.keys.get(keyId) : null;
    if (record && success) {
      record.usage = record.usage || { requests: 0, tokens: 0 };
      record.usage.tokens += Math.max(0, inputTokens) + Math.max(0, outputTokens);
      await this.persistKey(record);
    }
    if (uid) {
      const usage = this.counters.byUser[uid] || { requests: 0, neurons: 0, tokens: 0 };
      usage.neurons += isFreePool && success ? Math.max(0, reservation) : 0;
      usage.tokens += Math.max(0, inputTokens) + Math.max(0, outputTokens);
      this.counters.byUser[uid] = usage;
    }
    this.dirtyCounters = true;
    return { ok: true, pool: this.pool() };
  }

  async op_siteAuthorize({ uid, ip = '', provider = 'workers-ai', modelId = '', maxOutput = 320, inputTokens = 0, kind = 'htsilo' }) {
    const now = Date.now();
    await this.rollDayIfNeeded();
    this.pruneMinutes(now);
    this.pruneReservations(now);
    const l = limits(this.env);
    const bucket = this.minuteBucket(now, true);
    const userRpm = kind === 'htsilo' ? l.htsiloRpm : l.perUserRpm;
    if ((bucket.users[uid] || 0) >= userRpm) {
      return this.deny(429, 'rate_limit_exceeded', `Slow down: ${userRpm} requests per minute.`, {
        retryAfter: Math.ceil((MINUTE - (now % MINUTE)) / 1000),
      });
    }
    const usage = this.counters.byUser[uid] || { requests: 0, neurons: 0, tokens: 0 };
    const dailyCap = kind === 'htsilo' ? l.htsiloDaily : l.perUserDailyRequests;
    if (usage.requests >= dailyCap) {
      return this.deny(429, 'user_daily_limit', `Daily limit reached (${dailyCap} messages).`, {
        retryAfter: Math.ceil((nextUtcMidnight() - now) / 1000),
      });
    }
    if ((bucket.global || 0) >= l.globalRpm) {
      return this.deny(429, 'site_rate_limit', 'The gateway is busy right now. Try again in a moment.', {
        retryAfter: Math.ceil((MINUTE - (now % MINUTE)) / 1000),
      });
    }
    const model = resolveModel(modelId);
    const reservation = model ? estimateNeurons(model, inputTokens, maxOutput) : 50;
    if (this.counters.neurons + this.counters.reserved + reservation > l.dailyNeurons) {
      return this.deny(429, 'free_pool_exhausted', 'The free pool is empty for today. It resets at 00:00 UTC.', {
        retryAfter: Math.ceil((nextUtcMidnight() - now) / 1000),
        pool: this.pool(),
      });
    }
    this.counters.reserved += reservation;
    const reservationId = crypto.randomUUID();
    this.counters.pending.push({ id: reservationId, amount: reservation, at: now });
    this.bump(bucket, 'global');
    this.bump(bucket.users, uid);
    if (ip) this.bump(bucket.ips, ip);
    this.counters.requests += 1;
    this.counters.byUser[uid] = {
      requests: usage.requests + 1,
      neurons: usage.neurons,
      tokens: usage.tokens,
    };
    this.dirtyCounters = true;
    return {
      ok: true,
      uid,
      reservation,
      reservationId,
      remaining: Math.max(0, dailyCap - (usage.requests + 1)),
      pool: this.pool(),
    };
  }

  /* ── key management ────────────────────────────────────────────────────── */

  async op_createKey({ uid, name, email, label = '', salt, hash, escrow = null, keyId = '' }) {
    await this.rollDayIfNeeded();
    const l = limits(this.env);
    if (!uid || !salt || !hash || !keyId) return { ok: false, code: 'bad_request', message: 'Missing key material.' };
    const active = [...this.keys.values()].filter(r => r.uid === uid && !r.revoked);
    if (active.length >= l.maxActiveKeys) {
      return { ok: false, code: 'key_limit', message: `You can have ${l.maxActiveKeys} active keys. Revoke one first.` };
    }
    const now = Date.now();
    const createdToday = [...this.keys.values()].filter(r => r.uid === uid && now - r.created < DAY_MS).length;
    if (createdToday >= l.maxKeysPerDay) {
      return { ok: false, code: 'key_limit', message: `Limit of ${l.maxKeysPerDay} new keys per day reached.` };
    }
    if (this.keys.has(keyId)) return { ok: false, code: 'key_collision', message: 'Please retry: identifier collision.' };

    const record = {
      id: keyId,
      salt,
      hash,
      uid,
      name: String(name || 'HTMLTools user').slice(0, 80),
      email: String(email || '').slice(0, 254),
      label: String(label || '').slice(0, 80),
      created: now,
      lastUsed: null,
      revoked: false,
      revokedAt: null,
      usage: { requests: 0, tokens: 0 },
      ...(escrow ? { escrow } : {}),
    };
    this.keys.set(record.id, record);
    await this.persistKey(record);
    await this.syncGithub({ force: true }).catch(() => {});
    return { ok: true, record: this.publicRecord(record) };
  }

  publicRecord(record) {
    return {
      id: record.id,
      label: record.label,
      created: record.created,
      lastUsed: record.lastUsed,
      revoked: Boolean(record.revoked),
      revokedAt: record.revokedAt,
      usage: record.usage || { requests: 0, tokens: 0 },
      recoverable: Boolean(record.escrow),
    };
  }

  async op_ownerForKey({ keyId }) {
    const record = this.keys.get(keyId);
    if (!record || record.revoked) return { ok: false, code: 'invalid_api_key' };
    return { ok: true, hasByok: this.byok.has(record.uid) };
  }

  async op_limitCheck({ scope = 'misc', key = '', limit = 30, windowSec = 60 }) {
    const now = Date.now();
    const id = `${scope}:${key}`;
    let entry = this.limitWindows.get(id);
    if (!entry || entry.reset <= now) {
      entry = { count: 1, reset: now + windowSec * 1000 };
      this.limitWindows.set(id, entry);
      if (this.limitWindows.size > 5000) {
        for (const [k, v] of this.limitWindows) if (v.reset <= now) this.limitWindows.delete(k);
      }
      return { ok: true, remaining: limit - 1 };
    }
    if (entry.count >= limit) {
      return { ok: false, code: 'rate_limit_exceeded', retryAfter: Math.ceil((entry.reset - now) / 1000) };
    }
    entry.count += 1;
    return { ok: true, remaining: Math.max(0, limit - entry.count) };
  }

  async op_listKeys({ uid }) {
    const records = [...this.keys.values()]
      .filter(r => r.uid === uid)
      .sort((a, b) => b.created - a.created)
      .map(r => this.publicRecord(r));
    return { ok: true, keys: records, pool: this.pool() };
  }

  async op_revokeKey({ uid, keyId, asAdmin = false }) {
    const record = this.keys.get(keyId);
    if (!record) return { ok: false, code: 'not_found', message: 'No such key.' };
    if (!asAdmin && record.uid !== uid) return { ok: false, code: 'forbidden', message: 'That key belongs to another account.' };
    if (!record.revoked) {
      record.revoked = true;
      record.revokedAt = Date.now();
      await this.persistKey(record);
      await this.syncGithub({ force: true }).catch(() => {});
    }
    return { ok: true, record: this.publicRecord(record) };
  }

  async op_getKey({ keyId, uid, asAdmin = false }) {
    const record = this.keys.get(keyId);
    if (!record) return { ok: false, code: 'not_found', message: 'No such key.' };
    if (!asAdmin && record.uid !== uid) return { ok: false, code: 'forbidden', message: 'That key belongs to another account.' };
    return { ok: true, record };
  }

  async op_usage({ uid }) {
    const keys = [...this.keys.values()].filter(r => r.uid === uid);
    const user = this.counters.byUser[uid] || { requests: 0, neurons: 0, tokens: 0 };
    const l = limits(this.env);
    return {
      ok: true,
      usage: {
        today: {
          requests: user.requests,
          tokens: user.tokens,
          neurons: user.neurons,
          freePoolRequests: user.requests,
        },
        limits: {
          requestsPerDay: l.perUserDailyRequests,
          requestsPerMinute: l.perUserRpm,
          neuronsPerDay: l.perUserDailyNeurons,
          maxActiveKeys: l.maxActiveKeys,
        },
        keys: keys.length,
        activeKeys: keys.filter(k => !k.revoked).length,
        history: this.counters.history,
        pool: this.pool(),
      },
    };
  }

  /* ── BYOK ──────────────────────────────────────────────────────────────── */

  async op_byokSet({ uid, ref = '', provider = 'groq', blob, verified = false }) {
    if (!uid || !blob) return { ok: false, code: 'bad_request', message: 'Missing key material.' };
    const record = { uid, ref, provider, blob, updated: Date.now(), verified: Boolean(verified) };
    this.byok.set(uid, record);
    await this.persistByok(record);
    await this.syncGithub({ force: true }).catch(() => {});
    return { ok: true, provider, updated: record.updated, verified: record.verified };
  }

  async op_byokGet({ uid }) {
    const record = this.byok.get(uid);
    if (!record) return { ok: false, code: 'no_byok', message: 'No provider key is connected.' };
    return { ok: true, record };
  }

  async op_byokStatus({ uid }) {
    const record = this.byok.get(uid);
    return {
      ok: true,
      connected: Boolean(record),
      provider: record?.provider || null,
      updated: record?.updated || null,
      verified: Boolean(record?.verified),
    };
  }

  async op_byokDelete({ uid }) {
    const record = this.byok.get(uid);
    this.byok.delete(uid);
    await this.state.storage.delete(`byok:${uid}`);
    this.dirtyByok = true;
    await this.syncGithub({ force: true }).catch(() => {});
    return { ok: true, removed: Boolean(record) };
  }

  /* ── admin / public ────────────────────────────────────────────────────── */

  async op_roster() {
    const records = [...this.keys.values()].sort((a, b) => b.created - a.created);
    return {
      ok: true,
      keys: records,
      byok: [...this.byok.values()].map(r => ({ uid: r.uid, ref: r.ref, provider: r.provider, updated: r.updated, verified: r.verified })),
      pool: this.pool(),
      sync: { configured: githubConfigured(this.env), lastSync: this.lastSync, error: this.lastSyncError },
    };
  }

  async op_adminStats() {
    const keys = [...this.keys.values()];
    const users = new Set(keys.map(k => k.uid));
    return {
      ok: true,
      totals: {
        keys: keys.length,
        activeKeys: keys.filter(k => !k.revoked).length,
        users: users.size,
        byokUsers: this.byok.size,
        requestsToday: this.counters.requests,
        neuronsToday: this.counters.neurons,
        tokensIn: this.counters.tokensIn,
        tokensOut: this.counters.tokensOut,
      },
      pool: this.pool(),
      sync: { configured: githubConfigured(this.env), lastSync: this.lastSync, error: this.lastSyncError },
    };
  }

  async op_publicStatus({ models = [] } = {}) {
    const pool = this.pool();
    return {
      ok: true,
      pool: {
        budget: pool.budget,
        spent: pool.spent,
        remaining: pool.remaining,
        percentRemaining: pool.budget ? Math.round((pool.remaining / pool.budget) * 100) : 0,
        requestsToday: pool.requestsToday,
        requestCap: pool.requestCap,
        resetsAt: pool.resetsAt,
        exhausted: pool.remaining <= 0 || pool.requestsRemaining <= 0,
      },
      models,
      updated: new Date().toISOString(),
    };
  }

  async op_syncNow() {
    const result = await this.syncGithub({ force: true });
    return { ok: true, ...result };
  }

  /* ── GitHub mirror ─────────────────────────────────────────────────────── */

  async syncGithub({ force = false } = {}) {
    if (!githubConfigured(this.env)) return { skipped: 'not_configured' };
    if (!this.dirtyKeys && !this.dirtyByok && !force) return { skipped: 'clean' };
    // Coalesce: at most one GitHub write per 15 s unless forced by a create/revoke.
    if (!force && Date.now() - this.lastSync < 15_000) return { skipped: 'coalesced' };
    try {
      if (this.dirtyKeys || force) {
        const records = [...this.keys.values()].sort((a, b) => a.created - b.created);
        const body = renderKeysFile(records, { day: this.counters.day, pool: this.pool() });
        await writeRepoFile(this.env, this.env.GITHUB_KEYS_PATH || 'keys.js', body, 'Update API key roster');
        this.dirtyKeys = false;
      }
      if (this.dirtyByok || force) {
        const body = renderByokFile([...this.byok.values()]);
        await writeRepoFile(this.env, this.env.GITHUB_BYOK_PATH || 'byok.js', body, 'Update BYOK ciphertext store');
        this.dirtyByok = false;
      }
      this.lastSync = Date.now();
      this.lastSyncError = '';
      return { synced: true };
    } catch (error) {
      this.lastSyncError = String(error?.message || error).slice(0, 200);
      return { error: this.lastSyncError };
    }
  }

  /* ── alarm: checkpoint counters, retry the mirror ──────────────────────── */

  async alarm() {
    try {
      await this.rollDayIfNeeded();
      if (this.dirtyCounters) await this.saveCounters();
      await this.syncGithub();
    } catch {
      // Never let a failed alarm stop the next one.
    } finally {
      await this.state.storage.setAlarm(Date.now() + 30_000);
    }
  }
}
