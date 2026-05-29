const isDev = process.env.NODE_ENV !== 'production';

const COLORS = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
};

function statusColor(code) {
  if (code >= 500) return COLORS.red;
  if (code >= 400) return COLORS.yellow;
  if (code >= 300) return COLORS.cyan;
  return COLORS.green;
}

module.exports = function requestLogger(req, res, next) {
  const start = Date.now();
  const { method, originalUrl } = req;

  res.on('finish', () => {
    const duration = Date.now() - start;
    const status = res.statusCode;

    if (isDev) {
      console.log(
        `${COLORS.dim}${method}${COLORS.reset} ${originalUrl} ${statusColor(status)}${status}${COLORS.reset} ${COLORS.dim}${duration}ms${COLORS.reset}`
      );
    } else {
      // Production: single-line, parseable format
      const line = `${new Date().toISOString()} ${method} ${originalUrl} ${status} ${duration}ms ${req.ip}`;
      if (status >= 400) {
        console.warn(line);
      } else {
        console.log(line);
      }
    }
  });

  next();
};
