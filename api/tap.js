import { parse as parseCookies } from 'cookie';
import { queryOne } from '../db/client.js';
import { sessionState } from '../lib/auth.js';
import { logTap } from '../lib/audit.js';

const APP_URL = process.env.APP_URL ?? '';

export default async function handler(req, res) {
  const { d: deviceCode, uid } = req.query;
  const ip = req.headers['x-forwarded-for']?.split(',')[0] ?? req.socket?.remoteAddress;
  const userAgent = req.headers['user-agent'];

  // --- 1. Validate device code + UID together (neither alone is sufficient) ---
  if (!deviceCode || !uid) {
    await logTap({ uid, deviceCode, outcome: 'stranger', ip, userAgent });
    return redirectToContact(res);
  }

  const device = await queryOne(
    `SELECT d.id, d.uid, d.active, d.owner_id,
            o.session_window_mins, o.challenge_style, o.challenge_phrase
     FROM devices d
     JOIN owner_config o ON o.id = d.owner_id
     WHERE d.device_code = ? AND d.uid = ? AND d.active = 1`,
    [deviceCode, uid]
  );

  if (!device) {
    // Unknown device or UID mismatch — treat as stranger, no challenge offered
    await logTap({ uid, deviceCode, outcome: 'stranger', ip, userAgent });
    return redirectToContact(res);
  }

  // --- 2. Check for existing session cookie ---
  const cookies = parseCookies(req.headers.cookie ?? '');
  const token = cookies['ea_session'];

  if (token) {
    const session = await queryOne(
      `SELECT token, last_used_at, expires_at, is_shell
       FROM sessions
       WHERE token = ? AND device_id = ? AND owner_id = ?`,
      [token, device.id, device.owner_id]
    );

    if (session) {
      const state = sessionState(session.last_used_at, device.session_window_mins);

      if (state === 'active') {
        // Refresh last_used_at
        await updateLastUsed(token);
        await logTap({ uid, deviceCode, outcome: 'ea_direct', ip, userAgent });
        return redirectToEA(res, session.is_shell);
      }

      if (state === 'warm' || state === 'cold') {
        await logTap({ uid, deviceCode, outcome: 'challenge', ip, userAgent });
        return redirectToChallenge(res, {
          deviceCode,
          uid,
          sessionState: state,
          challengeStyle: device.challenge_style,
          challengePhrase: device.challenge_phrase,
        });
      }
    }
  }

  // --- 3. No valid session — send to challenge (known device) ---
  await logTap({ uid, deviceCode, outcome: 'challenge', ip, userAgent });
  return redirectToChallenge(res, {
    deviceCode,
    uid,
    sessionState: 'cold',
    challengeStyle: device.challenge_style,
    challengePhrase: device.challenge_phrase,
  });
}

// --- Helpers ---

async function updateLastUsed(token) {
  const { execute } = await import('../db/client.js');
  await execute(
    `UPDATE sessions SET last_used_at = datetime('now') WHERE token = ?`,
    [token]
  );
}

function redirectToContact(res) {
  res.redirect(302, `${APP_URL}/contact`);
}

function redirectToEA(res, isShell) {
  res.redirect(302, `${APP_URL}/ea${isShell ? '?shell=1' : ''}`);
}

function redirectToChallenge(res, { deviceCode, uid, sessionState, challengeStyle, challengePhrase }) {
  const params = new URLSearchParams({
    d: deviceCode,
    uid,
    state: sessionState,
    style: challengeStyle,
    phrase: encodeURIComponent(challengePhrase),
  });
  res.redirect(302, `${APP_URL}/challenge?${params}`);
}
