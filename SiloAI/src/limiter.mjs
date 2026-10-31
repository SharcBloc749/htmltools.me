export class SiloLimiter {
  constructor(state) { this.state = state; }

  async fetch(request) {
    const body = await request.json().catch(() => ({}));
    const url = new URL(request.url);
    if (url.pathname === '/crawl-time' && request.method === 'GET') {
      return Response.json({ lastCrawledAt: await this.state.storage.get('lastCrawledAt') || 0 });
    }
    if (url.pathname === '/crawl-time' && request.method === 'POST') {
      const stamp = Number(body.at);
      if (!Number.isFinite(stamp) || stamp < 0) return new Response('Invalid timestamp', { status: 400 });
      await this.state.storage.put('lastCrawledAt', stamp);
      return Response.json({ lastCrawledAt: stamp });
    }
    if (url.pathname === '/lock') {
      const now = Date.now();
      return this.state.storage.transaction(async (tx) => {
        const existing = await tx.get('crawlLease');
        if (existing && existing > now) return Response.json({ acquired: false });
        await tx.put('crawlLease', now + 10 * 60 * 1000);
        return Response.json({ acquired: true });
      });
    }
    if (url.pathname === '/unlock') {
      await this.state.storage.delete('crawlLease');
      return Response.json({ released: true });
    }
    if (url.pathname === '/crawl-check') {
      const day = new Date().toISOString().slice(0, 10);
      const bucket = String(body.bucket || 'crawl-global').replace(/[^a-z0-9:_-]/gi, '').slice(0, 100);
      const key = `crawl:${bucket}:${day}`;
      return this.state.storage.transaction(async (tx) => {
        const count = await tx.get(key) || 0;
        const limit = bucket === 'crawl-global' ? 100 : 12;
        if (count >= limit) return Response.json({ allowed: false, retryAfter: 3600 }, { status: 429 });
        await tx.put(key, count + 1, { expirationTtl: 48 * 3600 });
        return Response.json({ allowed: true });
      });
    }
    if (url.pathname !== '/check') return new Response('Not found', { status: 404 });

    const now = Date.now();
    const minute = Math.floor(now / 60_000);
    const day = new Date(now).toISOString().slice(0, 10);
    const bucket = String(body.bucket || 'site').replace(/[^a-z0-9:_-]/gi, '').slice(0, 100);
    const isIp = bucket.startsWith('ip:');
    const isGlobal = bucket === 'global';
    const minuteKey = `minute:${bucket}:${minute}`;
    const dayKey = `day:${bucket}:${day}`;
    return this.state.storage.transaction(async (tx) => {
      const minuteCount = await tx.get(minuteKey) || 0;
      const dayCount = await tx.get(dayKey) || 0;
      const minuteLimit = isIp ? 12 : isGlobal ? 120 : 60;
      const dayLimit = isIp ? 80 : isGlobal ? 500 : 1_000;
      if (minuteCount >= minuteLimit) return Response.json({ allowed: false, retryAfter: 60 - Math.floor((now % 60_000) / 1000) }, { status: 429 });
      if (dayCount >= dayLimit) return Response.json({ allowed: false, retryAfter: 3600 }, { status: 429 });
      await tx.put(minuteKey, minuteCount + 1, { expirationTtl: 120 });
      await tx.put(dayKey, dayCount + 1, { expirationTtl: 48 * 3600 });
      return Response.json({ allowed: true });
    });
  }
}
