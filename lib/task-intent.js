// lib/task-intent.js — lightweight parsing for EA task commands (v1)

/**
 * @returns {{ action: 'list'|'add'|'complete'|'delete', title?: string, fragment?: string, dueDate?: string } | null}
 */
export function parseTaskIntent(raw) {
  const text = String(raw || '').trim();
  if (!text) return null;
  const lower = text.toLowerCase();

  const listExact = new Set([
    'tasks',
    'tasks?',
    'task',
    'my tasks',
    'my tasks?',
    'todo list',
    'to do list',
    'to-do list',
  ]);
  if (listExact.has(lower)) return { action: 'list', filter: 'all' };

  const listPatterns = [
    /^what are my tasks\??$/,
    /^show (my )?tasks$/,
    /^my (todo|to-do|to do) list$/,
    /^(todo|task) list$/,
    /^what'?s (on )?my (plate|list)\??$/,
    /^due today$/,
    /^what'?s due today\??$/,
    /^tasks due today$/,
    /^overdue (tasks)?$/,
    /^what'?s overdue\??$/,
  ];
  if (listPatterns.some((re) => re.test(lower))) {
    if (/overdue/.test(lower)) return { action: 'list', filter: 'overdue' };
    if (/due today|tasks due today/.test(lower)) return { action: 'list', filter: 'today' };
    return { action: 'list', filter: 'all' };
  }

  let m = text.match(/^add task\s+(.+)$/i);
  if (m) return parseAdd(m[1]);

  m = text.match(/^remind me to\s+(.+)$/i);
  if (m) return parseAdd(m[1]);

  m = text.match(/^new task:?\s*(.+)$/i);
  if (m) return parseAdd(m[1]);

  m = text.match(/^todo:?\s*(.+)$/i);
  if (m) return parseAdd(m[1]);

  m = text.match(/^mark\s+(.+?)\s+done\.?$/i);
  if (m) return { action: 'complete', fragment: m[1].trim() };

  m = text.match(/^complete (task\s+)?(.+)$/i);
  if (m) return { action: 'complete', fragment: m[2].trim() };

  m = text.match(/^done with\s+(.+)$/i);
  if (m) return { action: 'complete', fragment: m[1].trim() };

  m = text.match(/^delete (task\s+)?(.+)$/i);
  if (m) return { action: 'delete', fragment: m[2].trim() };

  m = text.match(/^remove (task\s+)?(.+)$/i);
  if (m) return { action: 'delete', fragment: m[2].trim() };

  return null;
}

function tomorrowDateKey() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${mo}-${day}`;
}

function parseAdd(rest) {
  let title = rest.trim();
  let dueDate = null;
  const low = title.toLowerCase();

  if (/\btomorrow\b$/i.test(title)) {
    dueDate = tomorrowDateKey();
    title = title.replace(/\s*,?\s*tomorrow\s*$/i, '').trim();
  } else if (/\btoday\b$/i.test(title)) {
    const d = new Date();
    dueDate = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    title = title.replace(/\s*,?\s*today\s*$/i, '').trim();
  }

  let priority = 'normal';
  if (/^(urgent|high priority)\s*[:\-–]\s*/i.test(title)) {
    priority = 'high';
    title = title.replace(/^(urgent|high priority)\s*[:\-–]\s*/i, '').trim();
  } else if (/^(low priority)\s*[:\-–]\s*/i.test(title)) {
    priority = 'low';
    title = title.replace(/^(low priority)\s*[:\-–]\s*/i, '').trim();
  }

  if (!title) return null;
  return { action: 'add', title, dueDate: dueDate || undefined, priority };
}
