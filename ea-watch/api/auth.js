import { parse as parseCookies, serialize as serializeCookie } from 'cookie';
import { queryOne, execute } from '../db/client.js';
import {
  verifyCredential,
  detectCredentialType,
  generateToken,
  sessionExpiresAt,
} from '../lib/auth.js';
import {
  checkLockout,
  recordFailedAttempt,
  recordSuccess,
} from '../lib/ratelimit.js';
import { logTap } from '../lib/audit.js';

const APP_URL = process.env.APP_URL ?? '';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { d: deviceCode, uid, credential } = req.body ?? {};
  const ip = req.headers['x-forwarded-for']?.split(',')[0];

  if (!deviceCode || !uid || !credential) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  // --- Fetch device + owner config ---
  const device = await queryOne(
    `SELECT d.id, d.owner_id,
            o.pin_hash, o.access_word_hash, o.danger_word_hash,
            o.session_window_mins, o.challenge_style
     FROM devices d
     JOIN owner_config o ON o.id = d.owner_id
     WHERE d.device_code = ? AND d.uid = ? AND d.active = 1`,
    [deviceCode, uid]
  );

  if (!device) {
    // UID+code mismatch — silent redirect, no info leak
    return redirectToContact(res);
  }

  // --- Check lockout BEFORE verifying credential ---
  const lockout = await checkLockout(device.id);
  if (lockout.locked) {
    await logTap({ uid, deviceCode, outcome: 'lockout', ip });
    // Silent redirect — same behaviour as wrong answer
    return redirectToContact(res);
  }

  // --- Determine credential type and verify ---
  // Auto-detect: PIN = 4-6 digits, anything else = word
  const credType = detectCredentialType(credential);

  // Check danger word first — must respond identically to a real auth (timing safe)
  const isDanger = device.danger_word_hash
    ? await verifyCredential(credential, device.danger_word_hash)
    : false;

  let isValid = false;

  if (credType === 'pin') {
    isValid = device.pin_hash
      ? await verifyCredential(credential, device.pin_hash)
      : false;
  } else {
    isValid = device.access_word_hash
      ? await verifyCredential(credential, device.access_word_hash)
      : false;
  }

  // --- Handle outcome ---

  if (isDanger) {
    // Authenticates normally — shell mode + silent alert
    await recordSuccess(device.id);
    const token = await createSession(device, isShell = true);
    setSessionCookie(res, token, device.session_window_mins);

    // Fire alert async — do not await (must not delay the response)
    fireAlert(device.owner_id, ip).catch(err =>
      console.error('[danger] alert failed:', err.message)
    );

    await logTap({ uid, deviceCode, outcome: 'ea_direct_shell', ip });
    return res.redirect(302, `${APP_URL}/ea?shell=1`);
  }

  if (isValid) {
    await recordSuccess(device.id);
    const token = await createSession(device, isShell = false);
    setSessionCookie(res, token, device.session_window_mins);
    await logTap({ uid, deviceCode, outcome: 'ea_direct', ip });
    return res.redirect(302, `${APP_URL}/ea`);
  }

  // --- Wrong credential ---
  const { lockedOut, attemptsRemaining } = await recordFailedAttempt(device.id);
  await logTap({ uid, deviceCode, outcome: 'auth_failed', ip });

  // Silent redirect — no indication of what was wrong or how many attempts remain
  if (lockedOut) {
    return redirectToContact(res);
  }

  // Bounce back to challenge page — still silent about attempt count
  const params = new URLSearchParams({ d: deviceCode, uid, failed: '1' });
  return res.redirect(302, `${APP_URL}/challenge?${params}`);
}

// --- Helpers ---

async function createSession(device, isShell) {
  const token = generateToken();
  const expiresAt = sessionExpiresAt(device.session_window_mins);

  await execute(
    `INSERT INTO sessions (token, device_id, owner_id, expires_at, is_shell)
     VALUES (?, ?, ?, ?, ?)`,
    [token, device.id, device.owner_id, expiresAt, isShell ? 1 : 0]
  );

  return token;
}

function setSessionCookie(res, token, windowMins) {
  const maxAge = (windowMins ?? 60) * 60 * 8; // keep cookie for 8x the session window (warm zone)
  const cookie = serializeCookie('ea_session', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge,
    path: '/',
  });
  res.setHeader('Set-Cookie', cookie);
}

function redirectToContact(res) {
  return res.redirect(302, `${APP_URL}/contact`);
}

async function fireAlert(ownerId, ip) {
  const { dispatchAlert } = await import('../lib/alert.js');
  await dispatchAlert(ownerId, ip);
}
