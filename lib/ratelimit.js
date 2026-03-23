import { query, queryOne, execute } from '../db/client.js';

const MAX_ATTEMPTS = 5;
const LOCKOUT_MINS = 30;

// Returns { locked: true, until: ISOString } or { locked: false }
export async function checkLockout(deviceId) {
  const row = await queryOne(
    `SELECT locked_until FROM auth_lockouts WHERE device_id = ?`,
    [deviceId]
  );
  if (!row) return { locked: false };

  const until = new Date(row.locked_until);
  if (until > new Date()) {
    return { locked: true, until: until.toISOString() };
  }

  // Lockout expired — clean it up
  await execute(`DELETE FROM auth_lockouts WHERE device_id = ?`, [deviceId]);
  return { locked: false };
}

// Records a failed attempt. Locks out the device if MAX_ATTEMPTS reached.
export async function recordFailedAttempt(deviceId) {
  await execute(
    `INSERT INTO auth_attempts (device_id, success) VALUES (?, 0)`,
    [deviceId]
  );

  // Count recent failures (within the lockout window)
  const windowStart = new Date(Date.now() - LOCKOUT_MINS * 60 * 1000).toISOString();
  const rows = await query(
    `SELECT COUNT(*) as cnt FROM auth_attempts
     WHERE device_id = ? AND success = 0 AND attempted_at > ?`,
    [deviceId, windowStart]
  );

  const count = rows[0]?.cnt ?? 0;
  if (count >= MAX_ATTEMPTS) {
    const lockedUntil = new Date(Date.now() + LOCKOUT_MINS * 60 * 1000).toISOString();
    await execute(
      `INSERT INTO auth_lockouts (device_id, locked_until, attempt_count)
       VALUES (?, ?, ?)
       ON CONFLICT(device_id) DO UPDATE SET locked_until = ?, attempt_count = ?`,
      [deviceId, lockedUntil, count, lockedUntil, count]
    );
    return { lockedOut: true, until: lockedUntil };
  }

  return { lockedOut: false, attemptsRemaining: MAX_ATTEMPTS - count };
}

// Records a successful attempt — clears recent failures
export async function recordSuccess(deviceId) {
  await execute(
    `INSERT INTO auth_attempts (device_id, success) VALUES (?, 1)`,
    [deviceId]
  );
  // Clear any active lockout on success
  await execute(`DELETE FROM auth_lockouts WHERE device_id = ?`, [deviceId]);
}
