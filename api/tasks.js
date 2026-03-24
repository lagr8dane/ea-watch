// api/tasks.js — CRUD for owner tasks (session cookie)

import { parse as parseCookies } from 'cookie';
import { queryOne } from '../db/client.js';
import { listTasks, createTask, updateTask, getTask } from '../lib/tasks.js';

async function getSession(req) {
  const cookies = parseCookies(req.headers.cookie ?? '');
  const token = cookies['ea_session'];
  if (!token) return null;
  const session = await queryOne(
    `SELECT s.token, s.owner_id, s.is_shell
     FROM sessions s
     WHERE s.token = ? AND datetime(s.expires_at) > datetime('now')`,
    [token]
  );
  if (!session || session.is_shell) return null;
  return session;
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
  const ownerId = session.owner_id;
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = (req.path && String(req.path)) || url.pathname;
  const pathParts = pathname.replace(/^\/api\/tasks\/?/, '').split('/').filter(Boolean);
  const taskId = (typeof req.params?.id === 'string' && req.params.id) || pathParts[0] || null;

  try {
    if (req.method === 'GET' && !taskId) {
      const includeDeleted = url.searchParams.get('include_deleted') === '1';
      const statusOnly = url.searchParams.get('status');
      const rows = await listTasks(ownerId, {
        includeDeleted,
        statusFilter: statusOnly === 'open' || statusOnly === 'complete' || statusOnly === 'deleted' ? statusOnly : null,
      });
      return res.status(200).json({ tasks: rows });
    }

    if (req.method === 'POST' && !taskId) {
      const body = await parseBody(req);
      const row = await createTask(ownerId, {
        title: body.title,
        due_at: body.due_at || null,
        priority: body.priority || 'normal',
      });
      return res.status(201).json({ task: row });
    }

    if (!taskId) {
      return res.status(405).json({ error: 'Method not allowed' });
    }

    if (req.method === 'GET') {
      const row = await getTask(ownerId, taskId);
      if (!row) return res.status(404).json({ error: 'Not found' });
      return res.status(200).json({ task: row });
    }

    if (req.method === 'PATCH') {
      const body = await parseBody(req);
      const row = await updateTask(ownerId, taskId, body);
      if (!row) return res.status(404).json({ error: 'Not found' });
      return res.status(200).json({ task: row });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('[tasks]', err.message);
    return res.status(400).json({ error: err.message || 'Bad request' });
  }
}
