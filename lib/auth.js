import crypto from 'crypto';
import bcrypt from 'bcryptjs';

const BCRYPT_ROUNDS = 12;

export function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

export async function hashCredential(plaintext) {
  return bcrypt.hash(plaintext, BCRYPT_ROUNDS);
}

export async function verifyCredential(plaintext, hash) {
  if (!hash) return false;
  return bcrypt.compare(plaintext, hash);
}

export function detectCredentialType(input) {
  if (/^\d{4,6}$/.test(input.trim())) return 'pin';
  return 'word';
}

export function sessionExpiresAt(windowMins) {
  const ms = (windowMins ?? 60) * 60 * 1000;
  return new Date(Date.now() + ms).toISOString();
}

export function sessionState(lastUsedAt, windowMins) {
  const now = Date.now();
  const last = new Date(lastUsedAt).getTime();
  const elapsedMins = (now - last) / 60000;
  const window = windowMins ?? 60;

  if (elapsedMins <= window)        return 'active';
  if (elapsedMins <= window + 480)  return 'warm';
  return 'cold';
}
