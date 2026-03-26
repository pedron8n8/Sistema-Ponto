const WINDOW_MS = Math.max(1_000, Number(process.env.RATE_LIMIT_WINDOW_MS || 60_000));
const MAX_REQUESTS = Math.max(1, Number(process.env.RATE_LIMIT_MAX_REQUESTS || 120));

const requestLog = new Map();

const buildClientKey = (req) => {
  const forwardedFor = req.headers['x-forwarded-for'];
  if (typeof forwardedFor === 'string' && forwardedFor.trim()) {
    return forwardedFor.split(',')[0].trim();
  }

  return req.ip || req.socket?.remoteAddress || 'unknown';
};

const rateLimitMiddleware = (req, res, next) => {
  const key = buildClientKey(req);
  const now = Date.now();
  const entry = requestLog.get(key) || { count: 0, resetAt: now + WINDOW_MS };

  if (now > entry.resetAt) {
    entry.count = 0;
    entry.resetAt = now + WINDOW_MS;
  }

  entry.count += 1;
  requestLog.set(key, entry);

  const retryAfterSeconds = Math.max(1, Math.ceil((entry.resetAt - now) / 1000));
  res.setHeader('X-RateLimit-Limit', String(MAX_REQUESTS));
  res.setHeader('X-RateLimit-Remaining', String(Math.max(0, MAX_REQUESTS - entry.count)));
  res.setHeader('X-RateLimit-Reset', String(Math.ceil(entry.resetAt / 1000)));

  if (entry.count > MAX_REQUESTS) {
    res.setHeader('Retry-After', String(retryAfterSeconds));
    return res.status(429).json({
      error: 'Too Many Requests',
      message: 'Muitas requisições. Tente novamente em instantes.',
    });
  }

  return next();
};

module.exports = rateLimitMiddleware;