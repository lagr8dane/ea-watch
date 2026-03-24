// lib/debug-log.js — verbose server logs only when explicitly enabled.

/**
 * True when:
 * - Request URL has ?debug=1, or
 * - JSON body has debug: true | 1 | "1", or
 * - LOG_DEBUG=1 / true in environment (local dev).
 */
export function parseDebugFlag(req, body = {}) {
  try {
    const host = req.headers?.host || 'localhost';
    const u = new URL(req.url || '/', `http://${host}`);
    if (u.searchParams.get('debug') === '1') return true;
  } catch {
    /* ignore */
  }
  const d = body.debug;
  if (d === true || d === 1 || d === '1') return true;
  const env = process.env.LOG_DEBUG;
  if (env === '1' || env === 'true') return true;
  return false;
}

/** Console.log only when debug is on — no PII; use for fetch diagnostics. */
export function debugLog(enabled, tag, message, meta) {
  if (!enabled) return;
  if (meta !== undefined) console.log(`[debug:${tag}]`, message, meta);
  else console.log(`[debug:${tag}]`, message);
}
