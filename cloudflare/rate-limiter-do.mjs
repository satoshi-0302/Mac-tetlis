import { DurableObject } from 'cloudflare:workers';

export class RateLimiterDO extends DurableObject {
  async fetch(request) {
    const url = new URL(request.url);
    if (request.method !== 'POST' || url.pathname !== '/take') {
      return new Response('Not found', { status: 404 });
    }

    const payload = await request.json().catch(() => ({}));
    const key = String(payload?.key ?? '').trim();
    const limit = Math.max(1, Math.min(100, Number(payload?.limit) || 12));
    const windowMs = Math.max(1_000, Math.min(300_000, Number(payload?.windowMs) || 60_000));
    const now = Date.now();

    const current = await this.ctx.storage.get(key);
    if (!current || current.resetAt <= now) {
      await this.ctx.storage.put(key, { count: 1, resetAt: now + windowMs });
      return Response.json({ limited: false });
    }

    if (current.count >= limit) {
      return Response.json({
        limited: true,
        retryAfterSeconds: Math.max(1, Math.ceil((current.resetAt - now) / 1000))
      });
    }

    await this.ctx.storage.put(key, {
      count: current.count + 1,
      resetAt: current.resetAt
    });
    return Response.json({ limited: false });
  }
}
