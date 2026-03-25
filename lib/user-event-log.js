// lib/user-event-log.js — user-meaningful rows in action_log (non-chain EA activity).

import { logAction } from './action-log.js';

/**
 * Record something the owner did that should appear on /action-log.
 * Never throws to callers.
 */
export async function logUserEvent(sessionId, actionType, actionConfig = {}, outcome = 'success', errorDetail = null) {
  if (!sessionId || !actionType) return;
  if (outcome === 'error') outcome = 'failed';
  try {
    await logAction({
      sessionId,
      chainStateId: null,
      actionType,
      actionConfig,
      outcome,
      errorDetail,
    });
  } catch (err) {
    console.error('[user-event-log]', err.message);
  }
}
