import { execute } from '../db/client.js';

// outcome values: 'ea_direct' | 'challenge' | 'stranger' | 'invalid' | 'lockout'

export async function logTap({ uid, deviceCode, outcome, ip, userAgent }) {
  try {
    await execute(
      `INSERT INTO tap_log (uid, device_code, outcome, ip, user_agent)
       VALUES (?, ?, ?, ?, ?)`,
      [uid ?? 'unknown', deviceCode ?? 'unknown', outcome, ip ?? null, userAgent ?? null]
    );
  } catch (err) {
    // Log failure must never break the tap flow
    console.error('[audit] logTap failed:', err.message);
  }
}
