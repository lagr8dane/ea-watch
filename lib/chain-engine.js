// lib/chain-engine.js
// Core chain sequencer. Owns chain_state lifecycle and step advancement.
// Does NOT know about Claude, EA conversation, or action execution details.
// Callers: api/ea.js (trigger + resume), api/chain-execute.js (abort)
//
// Return shape — engine always returns one of:
//
//   { status: 'actions',   actions: [...], message: string }
//   { status: 'awaiting',  prompt: string, skippable: bool, chainStateId: string }
//   { status: 'completed', message: string, summary: { run, skipped } }
//   { status: 'aborted',   message: string, summary: { run, skipped } }
//   { status: 'error',     message: string }

import { query, queryOne, execute } from '../db/client.js';
import { logAction } from './action-log.js';
import { buildDeeplink } from './actions/deeplinks.js';
import { buildShortcut } from './actions/shortcuts.js';
import { evaluateConditional } from './actions/conditional.js';
import { runSpotifyChainStep } from './spotify.js';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Attempt to match userInput against chain trigger phrases for this device.
 * Returns the matching chain row or null.
 */
export async function matchChain(deviceId, userInput) {
  const chains = await query(`SELECT * FROM chains WHERE device_id = ? AND enabled = 1`, [deviceId]);
  const input = userInput.toLowerCase().trim();
  for (const chain of chains) {
    const trigger = chain.trigger_phrase.toLowerCase().trim();
    if (input === trigger || input.includes(trigger)) return chain;
  }
  return null;
}

/**
 * Check if there is an active or awaiting chain state for this session.
 * Returns the chain_state row or null.
 */
export async function getActiveChainState(sessionId) {
  return await queryOne(
    `SELECT * FROM chain_state WHERE session_id = ? AND status IN ('running', 'awaiting_confirm') ORDER BY started_at DESC LIMIT 1`,
    [sessionId]
  );
}

/**
 * Start a new chain execution for a session.
 * Creates a chain_state row and begins stepping.
 * Returns an engine result object.
 */
export async function startChain(sessionId, chain) {
  // Abort any existing active chain for this session before starting a new one
  await abortExistingChains(sessionId, 'superseded by new chain');

  // Create chain_state
  const stateResult = await execute(
    `INSERT INTO chain_state (session_id, chain_id, current_step, status, context, steps_run, steps_skipped)
     VALUES (?, ?, 0, 'running', '{}', '[]', '[]') RETURNING *`,
    [sessionId, chain.id]
  );
  const state = stateResult.rows[0];

  // Load steps
  const steps = await loadSteps(chain.id);
  if (steps.length === 0) {
    await markState(state.id, 'completed', 'No steps defined');
    return { status: 'completed', message: `"${chain.name}" has no steps configured.`, summary: { run: 0, skipped: 0 } };
  }

  return await advanceChain(state, steps, sessionId);
}

/**
 * Resume a chain after a confirmable/required step was resolved.
 * action: 'continue' | 'skip' | 'abort'
 */
export async function resumeChain(sessionId, chainStateId, action) {
  const state = await queryOne(
    `SELECT * FROM chain_state WHERE id = ? AND session_id = ?`,
    [chainStateId, sessionId]
  );

  if (!state) {
    return { status: 'error', message: 'No active chain found.' };
  }

  if (state.status !== 'awaiting_confirm') {
    return { status: 'error', message: 'Chain is not awaiting confirmation.' };
  }

  if (action === 'abort') {
    return await abortChain(state, 'user requested stop');
  }

  const steps = await loadSteps(state.chain_id);
  const currentStep = steps[state.current_step];

  if (!currentStep) {
    return await completeChain(state);
  }

  if (action === 'skip') {
    if (currentStep.step_type === 'required') {
      // Required steps cannot be skipped — return the prompt again
      return {
        status: 'awaiting',
        prompt: currentStep.prompt_text || 'This step is required to continue.',
        skippable: false,
        chainStateId: state.id,
      };
    }
    // Mark step skipped, advance
    await addSkipped(state.id, currentStep.id, state.steps_skipped);
    await logAction({
      sessionId,
      chainStateId: state.id,
      actionType: currentStep.action_type,
      actionConfig: safeJson(currentStep.action_config),
      outcome: 'skipped',
    });
    await advanceStep(state.id, state.current_step + 1);
    const updatedState = await reloadState(state.id);
    return await advanceChain(updatedState, steps, sessionId);
  }

  // action === 'continue' — execute the current step then advance
  return await executeStepAndAdvance(state, currentStep, steps, sessionId);
}

/**
 * Abort the active chain for a session (called from interrupt handler).
 */
export async function abortActiveChain(sessionId, reason = 'user requested stop') {
  const state = await getActiveChainState(sessionId);
  if (!state) {
    return { status: 'error', message: 'No active chain to stop.' };
  }
  return await abortChain(state, reason);
}

// ---------------------------------------------------------------------------
// Internal — step advancement
// ---------------------------------------------------------------------------

async function advanceChain(state, steps, sessionId) {
  // Collect silent actions to batch-return in a single 'actions' result
  const batchedActions = [];
  let batchMessage = '';

  let currentState = state;

  while (currentState.current_step < steps.length) {
    const step = steps[currentState.current_step];

    if (step.step_type === 'conditional') {
      const condResult = await evaluateConditional(safeJson(step.action_config));
      if (!condResult.proceed) {
        // Conditional says skip
        await addSkipped(currentState.id, step.id, currentState.steps_skipped);
        await logAction({
          sessionId,
          chainStateId: currentState.id,
          actionType: step.action_type,
          actionConfig: safeJson(step.action_config),
          outcome: 'skipped',
          errorDetail: condResult.reason,
        });
        await advanceStep(currentState.id, currentState.current_step + 1);
        currentState = await reloadState(currentState.id);
        continue;
      }
      // Conditional passed — treat as silent, surface any message
      if (condResult.message) batchMessage += condResult.message + ' ';
      await addRun(currentState.id, step.id, currentState.steps_run);
      await logAction({
        sessionId,
        chainStateId: currentState.id,
        actionType: step.action_type,
        actionConfig: safeJson(step.action_config),
        outcome: 'success',
      });
      await advanceStep(currentState.id, currentState.current_step + 1);
      currentState = await reloadState(currentState.id);
      continue;
    }

    if (step.step_type === 'silent') {
      const actionResult = await buildAction(step, sessionId);
      if (actionResult.error && !step.skip_on_fail) {
        await markState(currentState.id, 'error', actionResult.error);
        return { status: 'error', message: `Chain stopped: ${actionResult.error}` };
      }
      if (actionResult.action) batchedActions.push(actionResult.action);
      if (actionResult.message) batchMessage += actionResult.message + ' ';
      await addRun(currentState.id, step.id, currentState.steps_run);
      await logAction({
        sessionId,
        chainStateId: currentState.id,
        actionType: step.action_type,
        actionConfig: safeJson(step.action_config),
        outcome: actionResult.error ? 'failed' : 'success',
        errorDetail: actionResult.error,
      });
      await advanceStep(currentState.id, currentState.current_step + 1);
      currentState = await reloadState(currentState.id);
      continue;
    }

    if (step.step_type === 'confirmable' || step.step_type === 'required') {
      // Flush any batched actions first, then pause
      if (batchedActions.length > 0) {
        // Store pending pause in context so resume knows to re-enter here
        await updateContext(currentState.id, { pendingConfirmStep: currentState.current_step });
        return {
          status: 'actions',
          actions: batchedActions,
          message: batchMessage.trim(),
          // Signal that after client fires actions, the chain is pausing
          then: {
            status: 'awaiting',
            prompt: step.prompt_text || 'Continue?',
            skippable: step.step_type === 'confirmable',
            chainStateId: currentState.id,
          },
        };
      }

      await markState(currentState.id, 'awaiting_confirm');
      return {
        status: 'awaiting',
        prompt: step.prompt_text || 'Continue?',
        skippable: step.step_type === 'confirmable',
        chainStateId: currentState.id,
      };
    }
  }

  // All steps processed
  if (batchedActions.length > 0) {
    // Mark completed, return actions
    await completeChain(currentState);
    return {
      status: 'actions',
      actions: batchedActions,
      message: batchMessage.trim(),
      then: await buildCompletionResult(currentState),
    };
  }

  return await completeChain(currentState);
}

async function executeStepAndAdvance(state, step, steps, sessionId) {
  const actionResult = await buildAction(step, sessionId);
  if (actionResult.error && !step.skip_on_fail) {
    await markState(state.id, 'error', actionResult.error);
    return { status: 'error', message: `Chain stopped: ${actionResult.error}` };
  }
  await addRun(state.id, step.id, state.steps_run);
  await logAction({
    sessionId,
    chainStateId: state.id,
    actionType: step.action_type,
    actionConfig: safeJson(step.action_config),
    outcome: actionResult.error ? 'failed' : 'success',
    errorDetail: actionResult.error,
  });
  await advanceStep(state.id, state.current_step + 1);
  const updatedState = await reloadState(state.id);

  // If there's a client action to fire, return it then continue
  if (actionResult.action) {
    return {
      status: 'actions',
      actions: [actionResult.action],
      message: actionResult.message || '',
      then: await advanceChain(updatedState, steps, sessionId),
    };
  }
  return await advanceChain(updatedState, steps, sessionId);
}

// ---------------------------------------------------------------------------
// Internal — action building
// ---------------------------------------------------------------------------

async function ownerIdForChainSession(sessionId) {
  const row = await queryOne(
    `SELECT owner_id, is_shell FROM sessions
     WHERE token = ? AND datetime(expires_at) > datetime('now')`,
    [sessionId]
  );
  if (!row || row.is_shell === 1 || !row.owner_id) return null;
  return row.owner_id;
}

async function buildAction(step, sessionId) {
  const config = safeJson(step.action_config);
  try {
    if (step.action_type === 'deeplink' && config.kind === 'spotify') {
      const ownerId = await ownerIdForChainSession(sessionId);
      if (!ownerId) {
        return {
          error: 'Spotify in routines requires a signed-in owner session (use your watch to open EA).',
          message: '',
        };
      }
      const out = await runSpotifyChainStep(ownerId, config);
      if (out.error) {
        return { error: out.error, message: out.message || '' };
      }
      return {
        action: out.actions?.[0] || null,
        message: out.message || '',
      };
    }
    if (step.action_type === 'deeplink') {
      const url = buildDeeplink(config);
      return { action: { type: 'deeplink', url }, message: config.message };
    }
    if (step.action_type === 'shortcut') {
      const url = buildShortcut(config);
      return { action: { type: 'shortcut', url, name: config.name }, message: config.message };
    }
    if (step.action_type === 'message') {
      // EA text message — no client action needed, just a message string
      return { action: null, message: config.text };
    }
    return { error: `Unknown action_type: ${step.action_type}` };
  } catch (err) {
    return { error: err.message };
  }
}

// ---------------------------------------------------------------------------
// Internal — state management helpers
// ---------------------------------------------------------------------------

async function loadSteps(chainId) {
  return await query(`SELECT * FROM chain_steps WHERE chain_id = ? ORDER BY position ASC`, [chainId]);
}

async function reloadState(stateId) {
  return await queryOne(`SELECT * FROM chain_state WHERE id = ?`, [stateId]);
}

async function advanceStep(stateId, nextStep) {
  await execute(
    `UPDATE chain_state SET current_step = ?, status = 'running', updated_at = datetime('now') WHERE id = ?`,
    [nextStep, stateId]
  );
}

async function markState(stateId, status, reason) {
  await execute(
    `UPDATE chain_state SET status = ?, abort_reason = ?, updated_at = datetime('now') WHERE id = ?`,
    [status, reason || null, stateId]
  );
}

async function updateContext(stateId, patch) {
  const current = await reloadState(stateId);
  const ctx = { ...safeJson(current.context), ...patch };
  await execute(
    `UPDATE chain_state SET context = ?, updated_at = datetime('now') WHERE id = ?`,
    [JSON.stringify(ctx), stateId]
  );
}

async function addRun(stateId, stepId, currentJson) {
  const arr = safeJsonArray(currentJson);
  arr.push(stepId);
  await execute(
    `UPDATE chain_state SET steps_run = ?, updated_at = datetime('now') WHERE id = ?`,
    [JSON.stringify(arr), stateId]
  );
}

async function addSkipped(stateId, stepId, currentJson) {
  const arr = safeJsonArray(currentJson);
  arr.push(stepId);
  await execute(
    `UPDATE chain_state SET steps_skipped = ?, updated_at = datetime('now') WHERE id = ?`,
    [JSON.stringify(arr), stateId]
  );
}

async function abortChain(state, reason) {
  await markState(state.id, 'aborted', reason);
  const run = safeJsonArray(state.steps_run).length;
  const skipped = safeJsonArray(state.steps_skipped).length;
  const remaining = state.current_step - run - skipped;
  const parts = [];
  if (run > 0) parts.push(`${run} step${run !== 1 ? 's' : ''} completed`);
  if (skipped > 0) parts.push(`${skipped} skipped`);
  if (remaining > 0) parts.push(`${remaining} not started`);
  const summary = parts.length > 0 ? ` — ${parts.join(', ')}.` : '.';
  return {
    status: 'aborted',
    message: `Stopped${summary}`,
    summary: { run, skipped },
  };
}

async function completeChain(state) {
  await markState(state.id, 'completed');
  return await buildCompletionResult(state);
}

async function buildCompletionResult(state) {
  const run = safeJsonArray(state.steps_run).length;
  const skipped = safeJsonArray(state.steps_skipped).length;
  return {
    status: 'completed',
    message: skipped > 0
      ? `Done — ${run} step${run !== 1 ? 's' : ''} completed, ${skipped} skipped.`
      : `Done.`,
    summary: { run, skipped },
  };
}

async function abortExistingChains(sessionId, reason) {
  await execute(
    `UPDATE chain_state SET status = 'aborted', abort_reason = ?, updated_at = datetime('now')
     WHERE session_id = ? AND status IN ('running', 'awaiting_confirm')`,
    [reason, sessionId]
  );
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function safeJson(val) {
  if (typeof val === 'object' && val !== null) return val;
  try { return JSON.parse(val || '{}'); } catch { return {}; }
}

function safeJsonArray(val) {
  if (Array.isArray(val)) return val;
  try { return JSON.parse(val || '[]'); } catch { return []; }
}
