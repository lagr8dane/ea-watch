// lib/action-log.js
// Writes permanent records to the action_log table.
// Called by chain-engine.js for every step executed, skipped, failed, or aborted.
// Also callable directly from ea.js for standalone atomic actions (not part of a chain).
//
// This is separate from chain_state, which is ephemeral execution state.
// action_log is the permanent record — survives chain_state cleanup.

import { db } from '../db/client.js';

/**
 * Log a single action execution.
 *
 * @param {object} opts
 * @param {string}  opts.sessionId       — required
 * @param {string}  [opts.chainStateId]  — null for standalone atomic actions
 * @param {string}  opts.actionType      — e.g. 'deeplink', 'shortcut', 'weather_check'
 * @param {object}  [opts.actionConfig]  — the action_config object (will be JSON-stringified)
 * @param {string}  opts.outcome         — 'success' | 'skipped' | 'failed' | 'aborted'
 * @param {string}  [opts.errorDetail]   — set on failed/aborted outcomes
 */
export async function logAction({
  sessionId,
  chainStateId = null,
  actionType,
  actionConfig = {},
  outcome,
  errorDetail = null,
}) {
  if (!sessionId)   throw new Error('logAction: sessionId is required');
  if (!actionType)  throw new Error('logAction: actionType is required');
  if (!outcome)     throw new Error('logAction: outcome is required');

  const validOutcomes = ['success', 'skipped', 'failed', 'aborted'];
  if (!validOutcomes.includes(outcome)) {
    throw new Error(`logAction: invalid outcome "${outcome}". Must be one of: ${validOutcomes.join(', ')}`);
  }

  try {
    await db.execute({
      sql: `INSERT INTO action_log
              (session_id, chain_state_id, action_type, action_config, outcome, error_detail)
            VALUES (?, ?, ?, ?, ?, ?)`,
      args: [
        sessionId,
        chainStateId,
        actionType,
        typeof actionConfig === 'string' ? actionConfig : JSON.stringify(actionConfig),
        outcome,
        errorDetail,
      ],
    });
  } catch (err) {
    // Log writes should never crash the caller — audit failure is non-fatal
    console.error('[action-log] Failed to write action log:', err.message, {
      sessionId, actionType, outcome,
    });
  }
}

/**
 * Retrieve action log entries for a session, most recent first.
 * Used by the action log UI and the Phase 3 pattern detector.
 *
 * @param {string} sessionId
 * @param {number} [limit=50]
 * @returns {Promise<Array>}
 */
export async function getActionLog(sessionId, limit = 50) {
  const result = await db.execute({
    sql: `SELECT
            al.*,
            cs.chain_id,
            c.name as chain_name
          FROM action_log al
          LEFT JOIN chain_state cs ON al.chain_state_id = cs.id
          LEFT JOIN chains c ON cs.chain_id = c.id
          WHERE al.session_id = ?
          ORDER BY al.executed_at DESC
          LIMIT ?`,
    args: [sessionId, limit],
  });
  return result.rows.map(deserialiseRow);
}

/**
 * Retrieve recent action log entries across all sessions for a device.
 * Used by the action log UI when viewing full history.
 *
 * @param {string} deviceId
 * @param {number} [limit=100]
 * @returns {Promise<Array>}
 */
export async function getDeviceActionLog(deviceId, limit = 100) {
  const result = await db.execute({
    sql: `SELECT
            al.*,
            cs.chain_id,
            c.name as chain_name,
            s.created_at as session_started
          FROM action_log al
          LEFT JOIN chain_state cs ON al.chain_state_id = cs.id
          LEFT JOIN chains c ON cs.chain_id = c.id
          JOIN sessions s ON al.session_id = s.id
          WHERE s.device_id = ?
          ORDER BY al.executed_at DESC
          LIMIT ?`,
    args: [deviceId, limit],
  });
  return result.rows.map(deserialiseRow);
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
