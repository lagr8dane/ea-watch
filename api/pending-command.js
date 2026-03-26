// api/pending-command.js — GET / set POST / clear DELETE (session cookie)

import { parse as parseCookies } from 'cookie';
import { queryOne } from '../db/client.js';
import { parseDebugFlag, debugLog } from '../lib/debug-log.js';
import { logUserEvent } from '../lib/user-event-log.js';
import { getActivePending, setPending, clearPending, payloadSummary } from '../lib/pending-command.js';

async function getSession(req) {
  const cookies = parseCookies(req.headers.cookie ?? '');
  const token = cookies['ea_session'];
  if (!token) return null;
  return queryOne(
    `SELECT s.token, s.owner_id, s.is_shell
     FROM sessions s
     WHERE s.token = ? AND datetime(s.expires_at) > datetime('now')`,
    [token]
  );
}

async function parseBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString('utf8');
  try {
    return JSON.parse(raw || '{}');
  } catch {
    return {};
  }
}

export default async function handler(req, res) {
  const session = await getSession(req);
  if (!session) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const debug = parseDebugFlag(req, {});
  const ownerId = session.owner_id;

  try {
    if (req.method === 'GET') {
      const pending = await getActivePending(ownerId);
      return res.status(200).json({
        pending: pending
          ? {
              payload: pending.payload,
              target_surface: pending.target_surface,
              version: pending.version,
              expires_at: pending.expires_at,
              summary: payloadSummary(pending.payload),
            }
          : null,
      });
    }

    if (req.method === 'POST') {
      const body = await parseBody(req);
      const payload = body.payload ?? body;
      const ttl = body.ttl_minutes ?? body.ttlMinutes;
      const target = body.target_surface ?? body.targetSurface ?? 'phone';
      const result = await setPending(ownerId, payload, target, ttl);
      await logUserEvent(
        session.token,
        'pending_command_set',
        {
          kind: result.payload.kind,
          target_surface: result.target_surface,
          ttl_minutes: ttl,
        },
        'success'
      );
      debugLog(debug, 'pending-command', 'set', result.payload.kind);
      return res.status(200).json({ ok: true, ...result });
    }

    if (req.method === 'DELETE') {
      await clearPending(ownerId);
      await logUserEvent(session.token, 'pending_command_clear', {}, 'success');
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    debugLog(debug, 'pending-command', 'error', e?.message);
    const msg = e?.message || 'Failed';
    if (msg.includes('payload') || msg.includes('Unknown')) {
      return res.status(400).json({ error: msg });
    }
    return res.status(500).json({ error: 'Server error' });
  }
}
