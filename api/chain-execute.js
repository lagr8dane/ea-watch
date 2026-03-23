// api/chain-execute.js
// Handles chain execution control signals from the EA UI.
// Called when the user taps Continue, Skip, or Stop on a confirmable step.
//
// Routes:
//   POST /api/chain-execute  — resolve a paused chain state
//
// Body: { chainStateId: string, action: 'continue' | 'skip' | 'abort' }
//
// This endpoint is separate from ea.js so the EA streaming response
// doesn't need to handle button interactions. The UI calls this directly,
// gets a result, and renders it in the chat as if the EA said it.

import { requireOwnerSession } from '../lib/auth.js';
import { resumeChain, abortActiveChain } from '../lib/chain-engine.js';
import { getDeviceActionLog } from '../lib/action-log.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const session = await requireOwnerSession(req, res);
  if (!session) return;

  const body = await parseBody(req);
  const { chainStateId, action } = body;

  const validActions = ['continue', 'skip', 'abort'];
  if (!action || !validActions.includes(action)) {
    return res.status(400).json({ error: `action must be one of: ${validActions.join(', ')}` });
  }

  try {
    let result;

    if (action === 'abort' && !chainStateId) {
      // Abort whatever is currently active for this session
      result = await abortActiveChain(session.sessionId, 'user requested stop');
    } else {
      if (!chainStateId) {
        return res.status(400).json({ error: 'chainStateId is required for continue/skip' });
      }
      result = await resumeChain(session.sessionId, chainStateId, action);
    }

    return res.status(200).json({ result });

  } catch (err) {
    console.error('[chain-execute] Error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// ---------------------------------------------------------------------------
// Action log endpoint — GET /api/chain-execute/log
// Separate from main handler for clean routing in server.js
// ---------------------------------------------------------------------------
export async function actionLogHandler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const session = await requireOwnerSession(req, res);
  if (!session) return;

  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const limit = parseInt(url.searchParams.get('limit') || '100', 10);
    const entries = await getDeviceActionLog(session.deviceId, Math.min(limit, 500));
    return res.status(200).json({ log: entries });
  } catch (err) {
    console.error('[chain-execute/log] Error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
