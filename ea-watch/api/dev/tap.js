import { serialize as serializeCookie } from 'cookie';
import { queryOne, execute } from '../../db/client.js';
import { generateToken, sessionExpiresAt } from '../../lib/auth.js';

export default async function handler(req, res) {
  // Hard gate — never active in production
  if (process.env.ENABLE_STUB !== 'true') {
    return res.status(404).json({ error: 'Not found' });
  }

  const { d: deviceCode, uid, scenario } = req.query;

  if (!deviceCode || !uid) {
    return res.status(400).json({ error: 'Missing d or uid parameters' });
  }

  const APP_URL = process.env.APP_URL ?? '';

  // --- Stranger scenario: skip device lookup, go straight to contact ---
  if (scenario === 'stranger') {
    return res.redirect(302, `${APP_URL}/contact`);
  }

  // --- Look up device ---
  const device = await queryOne(
    `SELECT d.id, d.owner_id, o.session_window_mins, o.challenge_style, o.challenge_phrase, o.danger_word_hash
     FROM devices d
     JOIN owner_config o ON o.id = d.owner_id
     WHERE d.device_code = ? AND d.uid = ? AND d.active = 1`,
    [deviceCode, uid]
  );

  if (!device) {
    return res.status(404).json({
      error: 'Device not found. Register the device first via POST /api/device.',
      hint: 'Use the device code and UID you configured in the stub UI.'
    });
  }

  // --- Danger scenario: create shell session + redirect ---
  if (scenario === 'danger') {
    const token     = generateToken();
    const expiresAt = sessionExpiresAt(device.session_window_mins);

    await execute(
      `INSERT INTO sessions (token, device_id, owner_id, expires_at, is_shell)
       VALUES (?, ?, ?, ?, 1)`,
      [token, device.id, device.owner_id, expiresAt]
    );

    const cookie = serializeCookie('ea_session', token, {
      httpOnly: true,
      secure: false, // dev only
      sameSite: 'lax',
      maxAge: 60 * 60 * 8,
      path: '/',
    });

    res.setHeader('Set-Cookie', cookie);
    return res.redirect(302, `${APP_URL}/ea?shell=1`);
  }

  // --- Owner active: create real session + redirect to EA ---
  if (scenario === 'owner-active') {
    const token     = generateToken();
    const expiresAt = sessionExpiresAt(device.session_window_mins);

    await execute(
      `INSERT INTO sessions (token, device_id, owner_id, expires_at, is_shell)
       VALUES (?, ?, ?, ?, 0)`,
      [token, device.id, device.owner_id, expiresAt]
    );

    const cookie = serializeCookie('ea_session', token, {
      httpOnly: true,
      secure: false,
      sameSite: 'lax',
      maxAge: 60 * 60 * 8,
      path: '/',
    });

    res.setHeader('Set-Cookie', cookie);
    return res.redirect(302, `${APP_URL}/ea`);
  }

  // --- Owner expired: create expired session + redirect to challenge ---
  if (scenario === 'owner-expired') {
    const token     = generateToken();
    const expiresAt = new Date(Date.now() - 1000).toISOString(); // already expired

    await execute(
      `INSERT INTO sessions (token, device_id, owner_id, expires_at, is_shell, last_used_at)
       VALUES (?, ?, ?, ?, 0, datetime('now', '-2 hours'))`,
      [token, device.id, device.owner_id, expiresAt]
    );

    const cookie = serializeCookie('ea_session', token, {
      httpOnly: true,
      secure: false,
      sameSite: 'lax',
      maxAge: 60 * 60 * 8,
      path: '/',
    });

    res.setHeader('Set-Cookie', cookie);

    const params = new URLSearchParams({
      d: deviceCode,
      uid,
      state: 'warm',
      style: device.challenge_style ?? 'word_then_pin',
      phrase: encodeURIComponent(device.challenge_phrase ?? "Hey — it's been a while. What's the word?"),
    });

    return res.redirect(302, `${APP_URL}/challenge?${params}`);
  }

  return res.status(400).json({ error: 'Unknown scenario' });
}
