// lib/action-log.js
// Writes permanent records to the action_log table.
// Called by chain-engine.js for every step executed, skipped, failed, or aborted.
// Also callable directly from ea.js for standalone atomic actions (not part of a chain).

import { query, execute } from '../db/client.js';

/**
 * Log a single action execution.
 */
export async function logAction({
  sessionId,
  chainStateId = null,
  actionType,
  actionConfig = {},
  outcome,
  errorDetail = null,
}) {
  if (!sessionId)  throw new Error('logAction: sessionId is required');
  if (!actionType) throw new Error('logAction: actionType is required');
  if (!outcome)    throw new Error('logAction: outcome is required');

  const validOutcomes = ['success', 'skipped', 'failed', 'aborted'];
  if (!validOutcomes.includes(outcome)) {
    throw new Error(`logAction: invalid outcome "${outcome}". Must be one of: ${validOutcomes.join(', ')}`);
  }

  try {
    await execute(
      `INSERT INTO action_log (session_id, chain_state_id, action_type, action_config, outcome, error_detail)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        sessionId,
        chainStateId,
        actionType,
        typeof actionConfig === 'string' ? actionConfig : JSON.stringify(actionConfig),
        outcome,
        errorDetail,
      ]
    );
  } catch (err) {
    console.error('[action-log] Failed to write action log:', err.message, {
      sessionId, actionType, outcome,
    });
  }
}

/**
 * Retrieve action log entries for a session, most recent first.
 */
export async function getActionLog(sessionId, limit = 50) {
  const rows = await query(
    `SELECT al.*, cs.chain_id, c.name as chain_name
     FROM action_log al
     LEFT JOIN chain_state cs ON al.chain_state_id = cs.id
     LEFT JOIN chains c ON cs.chain_id = c.id
     WHERE al.session_id = ?
     ORDER BY al.executed_at DESC
     LIMIT ?`,
    [sessionId, limit]
  );
  return rows.map(deserialiseRow);
}

/**
 * Retrieve recent action log entries across all sessions for a device.
 */
export async function getDeviceActionLog(deviceId, limit = 100) {
  const rows = await query(
    `SELECT al.*, cs.chain_id, c.name as chain_name, s.created_at as session_started
     FROM action_log al
     LEFT JOIN chain_state cs ON al.chain_state_id = cs.id
     LEFT JOIN chains c ON cs.chain_id = c.id
     JOIN sessions s ON al.session_id = s.id
     WHERE s.device_id = ?
     ORDER BY al.executed_at DESC
     LIMIT ?`,
    [deviceId, limit]
  );
  return rows.map(deserialiseRow);
}

// ---------------------------------------------------------------------------
// Internal
// ---------------------------------------------------------------------------

function deserialiseRow(row) {
  return {
    ...row,
    action_config: safeJson(row.action_config),
  };
}

function safeJson(val) {
  if (typeof val === 'object' && val !== null) return val;
  try { return JSON.parse(val || '{}'); } catch { return {}; }
}
