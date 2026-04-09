const requestCounts = new Map();
const WINDOW_MS = 60000;
const MAX_REQUESTS = 100;

function rateLimiter(req, res, next) {
  const key = req.ip || req.connection.remoteAddress;
  const now = Date.now();

  if (!requestCounts.has(key)) {
    requestCounts.set(key, []);
  }

  const timestamps = requestCounts.get(key).filter((t) => now - t < WINDOW_MS);
  timestamps.push(now);
  requestCounts.set(key, timestamps);

  if (timestamps.length > MAX_REQUESTS) {
    return res.status(429).json({
      error: 'Too many requests',
      retry_after_sec: Math.ceil(WINDOW_MS / 1000),
    });
  }

  next();
}

setInterval(() => {
  const now = Date.now();
  for (const [key, timestamps] of requestCounts) {
    const valid = timestamps.filter((t) => now - t < WINDOW_MS);
    if (valid.length === 0) requestCounts.delete(key);
    else requestCounts.set(key, valid);
  }
}, WINDOW_MS);

module.exports = { rateLimiter };
