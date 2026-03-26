// lib/pending-command.js — one queued handoff per owner (cross-device continuation)

import { queryOne, execute } from '../db/client.js';

export const MAX_PAYLOAD_BYTES = 2048;
const ALLOWED_TARGETS = new Set(['phone', 'this_device', 'any']);

function expiresAtIso(ttlMinutes) {
  const m = Math.min(120, Math.max(1, Number(ttlMinutes) || 15));
  // Compute in JS for predictable ISO
  const d = new Date();
  d.setMinutes(d.getMinutes() + m);
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/**
 * @param {unknown} payload
 * @returns {object} normalized small object
 */
export function validatePayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('payload must be a JSON object');
  }
  const kind = payload.kind;
  if (kind === 'chat_send') {
    const text = String(payload.text ?? '').trim().slice(0, 2000);
    if (!text) throw new Error('chat_send requires non-empty text');
    return { kind: 'chat_send', text };
  }
  if (kind === 'routine_trigger') {
    const trigger = String(payload.trigger ?? '').trim().slice(0, 200);
    if (!trigger) throw new Error('routine_trigger requires trigger');
    return { kind: 'routine_trigger', trigger };
  }
  if (kind === 'spotify_play') {
    const query = String(payload.query ?? '').trim().slice(0, 200);
    if (!query) throw new Error('spotify_play requires query');
    return { kind: 'spotify_play', query };
  }
  throw new Error('Unknown or unsupported payload.kind');
}

export function payloadSummary(payload) {
  if (payload.kind === 'chat_send') return payload.text.slice(0, 120);
  if (payload.kind === 'routine_trigger') return `Routine: “${payload.trigger}”`;
  if (payload.kind === 'spotify_play') return `Play: “${payload.query}”`;
  return 'Queued action';
}

/**
 * @returns {Promise<{ payload: object, target_surface: string, version: number, expires_at: string } | null>}
 */
export async function getActivePending(ownerId) {
  const row = await queryOne(
    `SELECT payload, target_surface, version, expires_at
     FROM pending_commands
     WHERE owner_id = ?
       AND datetime(expires_at) > datetime('now')`,
    [ownerId]
  );
  if (!row) return null;
  let payload;
  try {
    payload = JSON.parse(row.payload);
  } catch {
    await execute(`DELETE FROM pending_commands WHERE owner_id = ?`, [ownerId]);
    return null;
  }
  return {
    payload,
    target_surface: row.target_surface,
    version: row.version,
    expires_at: row.expires_at,
  };
}

export async function setPending(ownerId, payload, targetSurface = 'phone', ttlMinutes = 15) {
  const normalized = validatePayload(payload);
  const json = JSON.stringify(normalized);
  if (json.length > MAX_PAYLOAD_BYTES) {
    throw new Error(`payload exceeds ${MAX_PAYLOAD_BYTES} bytes`);
  }
  const surf = ALLOWED_TARGETS.has(targetSurface) ? targetSurface : 'phone';
  const exp = expiresAtIso(ttlMinutes);

  await execute(
    `INSERT INTO pending_commands (owner_id, payload, target_surface, version, expires_at, created_at)
     VALUES (?, ?, ?, 1, ?, datetime('now'))
     ON CONFLICT(owner_id) DO UPDATE SET
       payload = excluded.payload,
       target_surface = excluded.target_surface,
       version = pending_commands.version + 1,
       expires_at = excluded.expires_at,
       created_at = datetime('now')`,
    [ownerId, json, surf, exp]
  );
  return { payload: normalized, target_surface: surf, expires_at: exp };
}

export async function clearPending(ownerId) {
  await execute(`DELETE FROM pending_commands WHERE owner_id = ?`, [ownerId]);
}
