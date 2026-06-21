import { Request, Response, NextFunction } from 'express';

/**
 * Tiny dependency-free fixed-window rate limiter.
 *
 * Tracks request counts per client key (default: req.ip) in an in-memory Map,
 * keyed by `${keyPrefix}:${ip}`. Each entry stores the count and the window's
 * reset timestamp. When the window expires the entry is reset on the next hit.
 * An exceeded limit returns HTTP 429 with a Korean error message.
 *
 * IMPORTANT (scaling): state lives in this process's memory, so the limit is
 * PER INSTANCE. Behind a load balancer with N app instances the effective
 * limit is up to N x max. For multi-instance deployments replace this with a
 * shared store (e.g. a Redis-backed limiter using INCR + EXPIRE) so the window
 * is global. For a single instance this is correct and has zero dependencies.
 *
 * Requires `app.set('trust proxy', 1)` so req.ip reflects the real client IP
 * (X-Forwarded-For) when running behind a reverse proxy / load balancer.
 */

interface RateLimitOptions {
  /** Window length in milliseconds. */
  windowMs: number;
  /** Max requests allowed per key within a window. */
  max: number;
  /** Namespace so different routes don't share a counter for the same IP. */
  keyPrefix: string;
}

interface WindowEntry {
  count: number;
  /** Epoch ms at which the current window resets. */
  resetAt: number;
}

const TOO_MANY_REQUESTS_MESSAGE = '요청이 너무 많습니다. 잠시 후 다시 시도하세요';

export function rateLimit(options: RateLimitOptions) {
  const { windowMs, max, keyPrefix } = options;
  const store = new Map<string, WindowEntry>();

  // Periodically evict expired entries so the Map can't grow unbounded from
  // one-off IPs. unref() so this timer never keeps the process alive.
  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of store) {
      if (entry.resetAt <= now) store.delete(key);
    }
  }, windowMs);
  if (typeof sweep.unref === 'function') sweep.unref();

  return function rateLimitMiddleware(req: Request, res: Response, next: NextFunction) {
    // Rate limiting is a production protection. In development the operator and
    // any local test traffic share one IP (localhost), so a strict per-IP login
    // limit would lock everyone out. Skip entirely outside production.
    if (process.env.NODE_ENV !== 'production') {
      return next();
    }

    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const key = `${keyPrefix}:${ip}`;
    const now = Date.now();

    let entry = store.get(key);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + windowMs };
      store.set(key, entry);
    }

    entry.count += 1;

    const remaining = Math.max(0, max - entry.count);
    const resetSeconds = Math.ceil((entry.resetAt - now) / 1000);

    // Standard-ish RateLimit headers (draft IETF style) for client visibility.
    res.setHeader('RateLimit-Limit', String(max));
    res.setHeader('RateLimit-Remaining', String(remaining));
    res.setHeader('RateLimit-Reset', String(resetSeconds));

    if (entry.count > max) {
      res.setHeader('Retry-After', String(resetSeconds));
      res.status(429).json({ error: TOO_MANY_REQUESTS_MESSAGE });
      return;
    }

    next();
  };
}
