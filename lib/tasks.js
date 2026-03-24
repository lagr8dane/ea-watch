// lib/tasks.js — owner tasks (first-party todos) for api/tasks.js and api/ea.js

import { v4 as uuidv4 } from 'uuid';
import { query, queryOne, execute } from '../db/client.js';

const VALID_STATUS = new Set(['open', 'complete', 'deleted']);
const VALID_PRIORITY = new Set(['low', 'normal', 'high']);

function nowSql() {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

export async function listTasks(ownerId, { includeDeleted = false, statusFilter = null } = {}) {
  let sql = `SELECT * FROM tasks WHERE owner_id = ?`;
  const params = [ownerId];
  if (!includeDeleted) {
    sql += ` AND status != 'deleted'`;
  }
  if (statusFilter && VALID_STATUS.has(statusFilter)) {
    sql += ` AND status = ?`;
    params.push(statusFilter);
  }
  sql += ` ORDER BY
    CASE status WHEN 'open' THEN 0 WHEN 'complete' THEN 1 ELSE 2 END,
    CASE priority WHEN 'high' THEN 0 WHEN 'normal' THEN 1 WHEN 'low' THEN 2 ELSE 1 END,
    (due_at IS NULL),
    datetime(due_at),
    datetime(created_at) DESC`;
  return await query(sql, params);
}

export async function getTask(ownerId, id) {
  return await queryOne(`SELECT * FROM tasks WHERE id = ? AND owner_id = ?`, [id, ownerId]);
}

export async function createTask(ownerId, { title, due_at = null, priority = 'normal' }) {
  const t = String(title || '').trim().slice(0, 500);
  if (!t) throw new Error('title required');
  const pr = VALID_PRIORITY.has(priority) ? priority : 'normal';
  const id = uuidv4();
  const ts = nowSql();
  await execute(
    `INSERT INTO tasks (id, owner_id, title, status, priority, due_at, created_at, updated_at)
     VALUES (?, ?, ?, 'open', ?, ?, ?, ?)`,
    [id, ownerId, t, pr, due_at || null, ts, ts]
  );
  return getTask(ownerId, id);
}

export async function updateTask(ownerId, id, patch) {
  const row = await getTask(ownerId, id);
  if (!row) return null;
  const updates = [];
  const params = [];
  if (patch.title != null) {
    const t = String(patch.title).trim().slice(0, 500);
    if (!t) throw new Error('title empty');
    updates.push('title = ?');
    params.push(t);
  }
  if (patch.due_at !== undefined) {
    updates.push('due_at = ?');
    params.push(patch.due_at || null);
  }
  if (patch.priority != null && VALID_PRIORITY.has(patch.priority)) {
    updates.push('priority = ?');
    params.push(patch.priority);
  }
  if (patch.status != null && VALID_STATUS.has(patch.status)) {
    updates.push('status = ?');
    params.push(patch.status);
  }
  if (updates.length === 0) return row;
  updates.push('updated_at = ?');
  params.push(nowSql());
  params.push(id, ownerId);
  await execute(`UPDATE tasks SET ${updates.join(', ')} WHERE id = ? AND owner_id = ?`, params);
  return getTask(ownerId, id);
}

/** Open tasks whose title contains fragment (case-insensitive), newest first. */
export async function findOpenTasksByTitle(ownerId, fragment) {
  const f = String(fragment).trim().toLowerCase();
  if (!f) return [];
  const all = await query(
    `SELECT * FROM tasks WHERE owner_id = ? AND status = 'open' ORDER BY datetime(created_at) DESC`,
    [ownerId]
  );
  return all.filter((t) => t.title.toLowerCase().includes(f));
}

function localDateKey(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function bucketTask(task, todayKey) {
  if (task.status !== 'open') return task.status === 'complete' ? 'done' : 'deleted';
  if (!task.due_at) return 'nodate';
  const d = task.due_at.slice(0, 10);
  if (d < todayKey) return 'overdue';
  if (d === todayKey) return 'today';
  return 'later';
}

export function formatTasksForChat(tasks, { todayKey = localDateKey(new Date()), filter = 'all' } = {}) {
  const open = tasks.filter((t) => t.status === 'open');
  if (open.length === 0) return 'No open tasks. Add one with "add task …" or open /tasks.';

  const fmt = (t) => {
    const pr = t.priority === 'high' ? '! ' : t.priority === 'low' ? '· ' : '';
    const due = t.due_at ? ` (due ${t.due_at.slice(0, 10)})` : '';
    return `${pr}${t.title}${due}`;
  };

  if (filter === 'overdue') {
    const o = open.filter((t) => bucketTask(t, todayKey) === 'overdue');
    if (!o.length) return 'Nothing overdue. Full list: /tasks';
    return ['Overdue:', ...o.map(fmt), 'Full list: /tasks'].join('\n');
  }
  if (filter === 'today') {
    const o = open.filter((t) => bucketTask(t, todayKey) === 'today');
    if (!o.length) return 'Nothing due today. Full list: /tasks';
    return ['Due today:', ...o.map(fmt), 'Full list: /tasks'].join('\n');
  }

  const groups = { overdue: [], today: [], later: [], nodate: [] };
  for (const t of open) {
    const b = bucketTask(t, todayKey);
    if (groups[b]) groups[b].push(t);
  }

  const lines = ['Your open tasks:'];
  if (groups.overdue.length) {
    lines.push('Overdue:');
    groups.overdue.forEach((t) => lines.push(fmt(t)));
  }
  if (groups.today.length) {
    lines.push('Today:');
    groups.today.forEach((t) => lines.push(fmt(t)));
  }
  if (groups.later.length) {
    lines.push('Coming up:');
    groups.later.forEach((t) => lines.push(fmt(t)));
  }
  if (groups.nodate.length) {
    lines.push('No date set:');
    groups.nodate.forEach((t) => lines.push(fmt(t)));
  }
  lines.push('Full list: /tasks');
  return lines.join('\n');
}
