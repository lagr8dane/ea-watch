/**
 * Magic sign-in links: create from an authenticated session (Settings), redeem on a new browser → challenge.
 * POST /api/magic-link — requires ea_session (non-shell). GET /api/magic-link?t= — public, one-time redirect to /challenge.
 */
import { randomBytes } from 'crypto';
import { parse as parseCookies } from 'cookie';
import { queryOne, execute } from '../db/client.js';

const APP_URL = (process.env.APP_URL ?? '').replace(/\/$/, '');
const TTL_MINUTES = 30;
const MAX_PER_OWNER_HOUR = 10;

function publicBaseUrl(req) {
  if (APP_URL) return APP_URL;
  const proto = (req.headers['x-forwarded-proto'] || 'http').split(',')[0].trim();
  const host = (req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
  if (!host) return '';
  return `${proto}://${host}`;
}

async function sessionForMagic(req) {
  const cookies = parseCookies(req.headers.cookie ?? '');
  const token = cookies['ea_session'];
  if (!token) return null;
  const s = await queryOne(
    `SELECT s.device_id, s.owner_id, s.is_shell
     FROM sessions s
     WHERE s.token = ?
       AND datetime(s.expires_at) > datetime('now')`,
    [token]
  );
  if (!s || s.is_shell === 1) return null;
  return s;
}

async function countRecentCreates(ownerId) {
  const row = await queryOne(
    `SELECT COUNT(*) AS c FROM magic_login_tokens
     WHERE owner_id = ?
       AND datetime(created_at) > datetime('now', '-1 hour')`,
    [ownerId]
  );
  return Number(row?.c ?? 0);
}

export default async function handler(req, res) {
  const base = publicBaseUrl(req);
  if (!base) {
    console.error('[magic-link] Set APP_URL for correct sign-in links in production.');
  }

  // --- Redeem (GET, no cookie required) ---
  if (req.method === 'GET') {
    const rawT = req.query?.t ?? req.query?.token;
    const token = typeof rawT === 'string' ? rawT.trim() : '';
    if (!/^[0-9a-f]{32}$/i.test(token)) {
      return res.redirect(302, `${base || ''}/sign-in?error=invalid`);
    }

    try {
      const row = await queryOne(
        `SELECT m.device_id, m.owner_id
         FROM magic_login_tokens m
         WHERE m.token = ?
           AND datetime(m.expires_at) > datetime('now')`,
        [token.toLowerCase()]
      );

      if (!row) {
        await execute(`DELETE FROM magic_login_tokens WHERE token = ?`, [token.toLowerCase()]).catch(() => {});
        return res.redirect(302, `${base || ''}/sign-in?error=invalid`);
      }

      const device = await queryOne(
        `SELECT d.uid, d.device_code, o.challenge_style, o.challenge_phrase
         FROM devices d
         JOIN owner_config o ON o.id = d.owner_id
         WHERE d.id = ? AND d.owner_id = ? AND d.active = 1`,
        [row.device_id, row.owner_id]
      );

      if (!device) {
        await execute(`DELETE FROM magic_login_tokens WHERE token = ?`, [token.toLowerCase()]);
        return res.redirect(302, `${base || ''}/sign-in?error=invalid`);
      }

      await execute(`DELETE FROM magic_login_tokens WHERE token = ?`, [token.toLowerCase()]);

      const phrase = device.challenge_phrase ?? "Hey — it's been a while. What's the word?";
      const params = new URLSearchParams({
        d: device.device_code,
        uid: device.uid,
        state: 'cold',
        style: device.challenge_style || 'word_then_pin',
        phrase: encodeURIComponent(phrase),
      });
      return res.redirect(302, `${base}/challenge?${params}`);
    } catch (err) {
      console.error('[magic-link GET]', err?.message || err);
      const hint = String(err?.message || '').includes('no such table')
        ? 'Run: node --env-file=.env scripts/db-migrate-magic-login.js'
        : '';
      if (hint) console.error(hint);
      return res.redirect(302, `${base || ''}/sign-in?error=invalid`);
    }
  }

  // --- Create (POST, authenticated) ---
  if (req.method === 'POST') {
    const sess = await sessionForMagic(req);
    if (!sess) {
      return res.status(401).json({ error: 'Unauthorised' });
    }

    try {
      const n = await countRecentCreates(sess.owner_id);
      if (n >= MAX_PER_OWNER_HOUR) {
        return res.status(429).json({ error: 'Too many sign-in links. Try again later.' });
      }

      await execute(
        `DELETE FROM magic_login_tokens WHERE datetime(expires_at) < datetime('now')`
      ).catch(() => {});

      const token = randomBytes(16).toString('hex');

      await execute(
        `INSERT INTO magic_login_tokens (token, device_id, owner_id, expires_at)
         VALUES (?, ?, ?, datetime('now', '+${TTL_MINUTES} minutes'))`,
        [token, sess.device_id, sess.owner_id]
      );

      const root = base || publicBaseUrl(req);
      const url = `${root}/sign-in?t=${token}`;
      return res.status(201).json({
        url,
        expires_in_minutes: TTL_MINUTES,
      });
    } catch (err) {
      console.error('[magic-link POST]', err?.message || err);
      return res.status(500).json({ error: 'Could not create sign-in link' });
    }
  }

  res.setHeader('Allow', 'GET, POST');
  return res.status(405).json({ error: 'Method not allowed' });
}
