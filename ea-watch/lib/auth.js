import crypto from 'crypto';
import bcrypt from 'bcrypt';

const BCRYPT_ROUNDS = 12;

// --- Session tokens ---

export function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

// --- Credential hashing ---

export async function hashCredential(plaintext) {
  return bcrypt.hash(plaintext, BCRYPT_ROUNDS);
}

export async function verifyCredential(plaintext, hash) {
  if (!hash) return false;
  return bcrypt.compare(plaintext, hash);
}

// --- Challenge type detection ---
// Determines whether a raw input looks like a PIN (4-6 digits) or an access word.
// Used when challenge_style = 'word_then_pin' and input arrives ambiguously.

export function detectCredentialType(input) {
  if (/^\d{4,6}$/.test(input.trim())) return 'pin';
  return 'word';
}

// --- Session expiry ---

export function sessionExpiresAt(windowMins) {
  const ms = (windowMins ?? 60) * 60 * 1000;
  return new Date(Date.now() + ms).toISOString();
}

// Active  < session_window_mins
// Warm    1–8 hours past expiry (still challengeable)
// Cold    8+ hours — full challenge required
// The session record expires_at is the active window boundary.
// Warm/cold is computed at tap time from last_used_at.

export function sessionState(lastUsedAt, windowMins) {
  const now = Date.now();
  const last = new Date(lastUsedAt).getTime();
  const elapsedMins = (now - last) / 60000;
  const window = windowMins ?? 60;

  if (elapsedMins <= window)        return 'active';
  if (elapsedMins <= window + 480)  return 'warm';   // up to 8 hours past window
  return 'cold';
}
