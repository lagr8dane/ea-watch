// api/tasks.js — CRUD for owner tasks (session cookie)

import { parse as parseCookies } from 'cookie';
import { queryOne } from '../db/client.js';
import { parseDebugFlag, debugLog } from '../lib/debug-log.js';
import { listTasks, createTask, updateTask, getTask } from '../lib/tasks.js';
import { logUserEvent } from '../lib/user-event-log.js';

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
  const debug = parseDebugFlag(req, {});
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
      await logUserEvent(
        session.token,
        'ea_task_add',
        {
          title: row.title.slice(0, 120),
          due_at: row.due_at,
          priority: row.priority,
          source: 'tasks_api',
        },
        'success'
      );
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
      const prev = await getTask(ownerId, taskId);
      if (!prev) return res.status(404).json({ error: 'Not found' });
      const row = await updateTask(ownerId, taskId, body);
      if (!row) return res.status(404).json({ error: 'Not found' });
      if (body.status === 'complete') {
        await logUserEvent(
          session.token,
          'ea_task_complete',
          { title: row.title.slice(0, 120), source: 'tasks_api' },
          'success'
        );
      } else if (body.status === 'deleted') {
        await logUserEvent(
          session.token,
          'ea_task_delete',
          { title: prev.title.slice(0, 120), source: 'tasks_api' },
          'success'
        );
      } else if (body.title != null || body.due_at !== undefined || body.priority != null) {
        await logUserEvent(
          session.token,
          'ea_task_edit',
          {
            source: 'tasks_api',
            title: row.title.slice(0, 120),
            changed: {
              title: body.title != null,
              due_at: body.due_at !== undefined,
              priority: body.priority != null,
            },
          },
          'success'
        );
      }
      return res.status(200).json({ task: row });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    debugLog(debug, 'tasks', err.message);
    return res.status(400).json({ error: err.message || 'Bad request' });
  }
}
