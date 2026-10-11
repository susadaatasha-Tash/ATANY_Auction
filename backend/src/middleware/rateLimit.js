// backend/src/middleware/rateLimit.js
// Minimal in-memory sliding-window rate limiter (no extra dependencies).
// Per-process only — for multi-instance deployments pair with edge/WAF limits
// or a shared store. Sufficient to blunt credential stuffing / chat spam.

const buckets = new Map();

/** Periodically drop idle buckets so the map cannot grow unbounded. */
const sweeper = setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of buckets) {
    if (now - bucket.start > 10 * 60 * 1000) buckets.delete(key);
  }
}, 5 * 60 * 1000);
if (sweeper.unref) sweeper.unref();

export function rateLimit({ windowMs = 60_000, max = 60, name = 'default' } = {}) {
  return function rateLimitMiddleware(req, res, next) {
    const ip = req.ip || req.socket?.remoteAddress || 'unknown';
    const key = `${name}:${ip}`;
    const now = Date.now();
    let bucket = buckets.get(key);
    if (!bucket || now - bucket.start >= windowMs) {
      bucket = { start: now, count: 0 };
      buckets.set(key, bucket);
    }
    bucket.count += 1;
    if (bucket.count > max) {
      const retryAfterSec = Math.max(1, Math.ceil((bucket.start + windowMs - now) / 1000));
      res.setHeader('Retry-After', String(retryAfterSec));
      return res.status(429).json({ message: 'Too many requests. Please try again shortly.' });
    }
    next();
  };
}

/** Test helper — clear all buckets. */
export function resetRateLimitBuckets() {
  buckets.clear();
}

export default rateLimit;
