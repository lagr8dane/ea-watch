// api/chains.js
// CRUD endpoints for chains and chain_steps.
// All routes require a valid owner session — no stranger access.
//
// Routes:
//   GET    /api/chains                    — list all chains for this device
//   POST   /api/chains                    — create a new chain
//   GET    /api/chains/:id                — get a single chain with its steps
//   PUT    /api/chains/:id                — update chain metadata (name, trigger, description, enabled)
//   DELETE /api/chains/:id                — delete a chain and all its steps
//   PUT    /api/chains/:id/steps          — replace all steps for a chain (full reorder/edit)
//   POST   /api/chains/:id/steps          — append a single step
//   DELETE /api/chains/:id/steps/:stepId  — delete a single step, reorder remaining

import { parse as parseCookies } from 'cookie';
import { query, queryOne, execute } from '../db/client.js';

export default async function handler(req, res) {
  // --- Inline session validation (owner only) ---
  const cookies = parseCookies(req.headers.cookie ?? '');
  const token = cookies['ea_session'];
  if (!token) return res.status(401).json({ error: 'No session' });

  const session = await queryOne(
    `SELECT s.token, s.device_id, s.is_shell
     FROM sessions s
     WHERE s.token = ? AND datetime(s.expires_at) > datetime('now')`,
    [token]
  );
  if (!session) return res.status(401).json({ error: 'Invalid or expired session' });
  if (session.is_shell) return res.status(403).json({ error: 'Not available in restricted mode' });

  const deviceId = session.device_id;

  const url = new URL(req.url, `http://${req.headers.host}`);
  const parts = url.pathname.replace(/^\/api\/chains\/?/, '').split('/').filter(Boolean);

  const chainId = parts[0];
  const isSteps = parts[1] === 'steps';
  const stepId  = parts[2];

  try {
    if (!chainId) {
      if (req.method === 'GET')  return await listChains(req, res, deviceId);
      if (req.method === 'POST') return await createChain(req, res, deviceId);
      return res.status(405).json({ error: 'Method not allowed' });
    }

    const chain = await getChainForDevice(chainId, deviceId);
    if (!chain) return res.status(404).json({ error: 'Chain not found' });

    if (isSteps) {
      if (req.method === 'PUT')                    return await replaceSteps(req, res, chainId);
      if (req.method === 'POST')                   return await appendStep(req, res, chainId);
      if (req.method === 'DELETE' && stepId)       return await deleteStep(req, res, chainId, stepId);
      return res.status(405).json({ error: 'Method not allowed' });
    }

    if (req.method === 'GET')    return await getChain(req, res, chainId);
    if (req.method === 'PUT')    return await updateChain(req, res, chainId);
    if (req.method === 'DELETE') return await deleteChain(req, res, chainId);
    return res.status(405).json({ error: 'Method not allowed' });

  } catch (err) {
    console.error('[chains] Error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// ---------------------------------------------------------------------------
// Collection handlers
// ---------------------------------------------------------------------------

async function listChains(req, res, deviceId) {
  const rows = await query(
    `SELECT c.*, COUNT(cs.id) as step_count
     FROM chains c
     LEFT JOIN chain_steps cs ON cs.chain_id = c.id
     WHERE c.device_id = ?
     GROUP BY c.id
     ORDER BY c.created_at ASC`,
    [deviceId]
  );
  return res.status(200).json({ chains: rows });
}

async function createChain(req, res, deviceId) {
  const body = await parseBody(req);
  const { name, trigger_phrase, description } = body;

  if (!name?.trim())           return res.status(400).json({ error: 'name is required' });
  if (!trigger_phrase?.trim()) return res.status(400).json({ error: 'trigger_phrase is required' });

  const existing = await queryOne(
    `SELECT id FROM chains WHERE device_id = ? AND lower(trigger_phrase) = lower(?)`,
    [deviceId, trigger_phrase.trim()]
  );
  if (existing) return res.status(409).json({ error: 'A chain with this trigger phrase already exists' });

  const result = await execute(
    `INSERT INTO chains (device_id, name, trigger_phrase, description) VALUES (?, ?, ?, ?) RETURNING *`,
    [deviceId, name.trim(), trigger_phrase.trim().toLowerCase(), description?.trim() || null]
  );
  return res.status(201).json({ chain: result.rows[0] });
}

// ---------------------------------------------------------------------------
// Single chain handlers
// ---------------------------------------------------------------------------

async function getChain(req, res, chainId) {
  const chain = await queryOne(`SELECT * FROM chains WHERE id = ?`, [chainId]);
  const steps = await query(`SELECT * FROM chain_steps WHERE chain_id = ? ORDER BY position ASC`, [chainId]);
  return res.status(200).json({ chain, steps: steps.map(deserialiseStep) });
}

async function updateChain(req, res, chainId) {
  const body = await parseBody(req);
  const { name, trigger_phrase, description, enabled } = body;

  const fields = [];
  const args = [];

  if (name !== undefined) {
    if (!name.trim()) return res.status(400).json({ error: 'name cannot be empty' });
    fields.push('name = ?'); args.push(name.trim());
  }
  if (trigger_phrase !== undefined) {
    if (!trigger_phrase.trim()) return res.status(400).json({ error: 'trigger_phrase cannot be empty' });
    fields.push('trigger_phrase = ?'); args.push(trigger_phrase.trim().toLowerCase());
  }
  if (description !== undefined) {
    fields.push('description = ?'); args.push(description?.trim() || null);
  }
  if (enabled !== undefined) {
    fields.push('enabled = ?'); args.push(enabled ? 1 : 0);
  }

  if (fields.length === 0) return res.status(400).json({ error: 'No fields to update' });

  fields.push(`updated_at = datetime('now')`);
  args.push(chainId);

  const result = await execute(
    `UPDATE chains SET ${fields.join(', ')} WHERE id = ? RETURNING *`,
    args
  );
  return res.status(200).json({ chain: result.rows[0] });
}

async function deleteChain(req, res, chainId) {
  await execute(`DELETE FROM chains WHERE id = ?`, [chainId]);
  return res.status(200).json({ deleted: true });
}

// ---------------------------------------------------------------------------
// Steps handlers
// ---------------------------------------------------------------------------

async function replaceSteps(req, res, chainId) {
  const body = await parseBody(req);
  const { steps } = body;

  if (!Array.isArray(steps)) return res.status(400).json({ error: 'steps must be an array' });

  for (let i = 0; i < steps.length; i++) {
    const err = validateStep(steps[i], i);
    if (err) return res.status(400).json({ error: err });
  }

  await execute(`DELETE FROM chain_steps WHERE chain_id = ?`, [chainId]);

  const inserted = [];
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const result = await execute(
      `INSERT INTO chain_steps (chain_id, position, step_type, action_type, action_config, prompt_text, skip_on_fail)
       VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING *`,
      [chainId, i, step.step_type, step.action_type, JSON.stringify(step.action_config || {}), step.prompt_text?.trim() || null, step.skip_on_fail ? 1 : 0]
    );
    inserted.push(deserialiseStep(result.rows[0]));
  }

  await execute(`UPDATE chains SET updated_at = datetime('now') WHERE id = ?`, [chainId]);
  return res.status(200).json({ steps: inserted });
}

async function appendStep(req, res, chainId) {
  const body = await parseBody(req);
  const err = validateStep(body, 0);
  if (err) return res.status(400).json({ error: err });

  const maxRow = await queryOne(
    `SELECT COALESCE(MAX(position), -1) as max_pos FROM chain_steps WHERE chain_id = ?`,
    [chainId]
  );
  const nextPos = (maxRow?.max_pos ?? -1) + 1;

  const result = await execute(
    `INSERT INTO chain_steps (chain_id, position, step_type, action_type, action_config, prompt_text, skip_on_fail)
     VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING *`,
    [chainId, nextPos, body.step_type, body.action_type, JSON.stringify(body.action_config || {}), body.prompt_text?.trim() || null, body.skip_on_fail ? 1 : 0]
  );

  await execute(`UPDATE chains SET updated_at = datetime('now') WHERE id = ?`, [chainId]);
  return res.status(201).json({ step: deserialiseStep(result.rows[0]) });
}

async function deleteStep(req, res, chainId, stepId) {
  const existing = await queryOne(
    `SELECT id FROM chain_steps WHERE id = ? AND chain_id = ?`,
    [stepId, chainId]
  );
  if (!existing) return res.status(404).json({ error: 'Step not found' });

  await execute(`DELETE FROM chain_steps WHERE id = ?`, [stepId]);

  const remaining = await query(
    `SELECT id FROM chain_steps WHERE chain_id = ? ORDER BY position ASC`,
    [chainId]
  );
  for (let i = 0; i < remaining.length; i++) {
    await execute(`UPDATE chain_steps SET position = ? WHERE id = ?`, [i, remaining[i].id]);
  }

  await execute(`UPDATE chains SET updated_at = datetime('now') WHERE id = ?`, [chainId]);
  return res.status(200).json({ deleted: true });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function getChainForDevice(chainId, deviceId) {
  return await queryOne(
    `SELECT * FROM chains WHERE id = ? AND device_id = ?`,
    [chainId, deviceId]
  );
}

function validateStep(step, index) {
  const validStepTypes = ['silent', 'confirmable', 'required', 'conditional'];
  const validActionTypes = ['deeplink', 'shortcut', 'weather_check', 'time_check', 'calendar_check', 'message'];

  if (!step.step_type || !validStepTypes.includes(step.step_type)) {
    return `Step ${index}: step_type must be one of: ${validStepTypes.join(', ')}`;
  }
  if (!step.action_type || !validActionTypes.includes(step.action_type)) {
    return `Step ${index}: action_type must be one of: ${validActionTypes.join(', ')}`;
  }
  if ((step.step_type === 'confirmable' || step.step_type === 'required') && !step.prompt_text?.trim()) {
    return `Step ${index}: prompt_text is required for ${step.step_type} steps`;
  }
  return null;
}

function deserialiseStep(row) {
  return {
    ...row,
    action_config: safeJson(row.action_config),
    skip_on_fail: row.skip_on_fail === 1,
  };
}

function safeJson(val) {
  if (typeof val === 'object' && val !== null) return val;
  try { return JSON.parse(val || '{}'); } catch { return {}; }
}

async function parseBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => { data += chunk; });
    req.on('end', () => {
      try { resolve(data ? JSON.parse(data) : {}); }
      catch { reject(new Error('Invalid JSON body')); }
    });
    req.on('error', reject);
  });
}
