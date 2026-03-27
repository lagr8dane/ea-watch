// lib/task-intent-ai.js — optional small-model pass when regex misses but text looks task-like (hybrid routing)

import { debugLog } from './debug-log.js';

/** Matches EA main chat (`api/ea.js`). Used if primary model returns 404 (unknown / retired id). */
export const TASK_CLASSIFIER_FALLBACK_MODEL_ID = 'claude-sonnet-4-5';

/**
 * Primary classifier: Claude Haiku 4.5 (`claude-haiku-4-5`). Override via EA_TASK_CLASSIFIER_MODEL if needed.
 */
export function getTaskClassifierModelId() {
  const e =
    typeof process !== 'undefined' && process.env.EA_TASK_CLASSIFIER_MODEL
      ? String(process.env.EA_TASK_CLASSIFIER_MODEL).trim()
      : '';
  return e || 'claude-haiku-4-5';
}

/**
 * Calendar date for the user (YYYY-MM-DD). Prefer client `localDate`; else server local calendar day.
 */
export function resolveContextDate(body) {
  const d = body?.localDate;
  if (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d.trim())) return d.trim();
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

/**
 * Cheap gate so we do not call the classifier on every chat line.
 */
export function shouldTryAiTaskClassification(text) {
  const t = String(text || '').trim();
  if (t.length < 6 || t.length > 500) return false;
  const lower = t.toLowerCase();

  if (/^(what|how|why|when|where|who)\s+(is|are|do|does|did|was|were|can|could|would|will|should)\b/.test(lower)) {
    return false;
  }
  if (/^(tell me|explain|describe|define|translate)\b/.test(lower)) return false;

  const hints = [
    /\b(don't forget|dont forget|remember to|don't let me forget)\b/,
    /\b(remind me|reminder)\b/,
    /\b(task|todo|to-?do)\b/,
    /\b(need to|have to|gotta)\b/,
    /\b(add|put)\s+(this|that|it)?\s*(to|on)\s+(my\s+)?(list|tasks)\b/,
  ];
  return hints.some((re) => re.test(lower));
}

function extractJsonObject(raw) {
  const s = String(raw || '').trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fence ? fence[1].trim() : s;
  const i = body.indexOf('{');
  const j = body.lastIndexOf('}');
  if (i < 0 || j <= i) return null;
  try {
    return JSON.parse(body.slice(i, j + 1));
  } catch {
    return null;
  }
}

const VALID_PRIORITY = new Set(['low', 'normal', 'high']);

async function runClassifierCreate(client, model, system, user) {
  return client.messages.create({
    model,
    max_tokens: 180,
    temperature: 0,
    system,
    messages: [{ role: 'user', content: user }],
  });
}

/**
 * @param {object} client Anthropic SDK client (`messages.create`)
 * @returns {Promise<{
 *   intent: { action: 'add', title: string, dueDate?: string, priority: string } | null,
 *   outcome: 'add' | 'none' | 'parse_error' | 'invalid_add',
 *   model: string
 * }>}
 */
export async function refineTaskIntentWithHaiku(client, userText, contextDate, debug) {
  const system = `You route a single chat line for a personal todo app.

Output ONLY one JSON object (no markdown, no prose):
{"intent":"none"|"add","title":string|null,"due_date":string|null,"priority":"normal"|"high"|"low"}

Rules:
- intent "add" ONLY when the user clearly wants to save a concrete action to remember later (a todo). Not questions, not small talk, not "help me plan" without a specific action to store.
- title: short task wording only. Remove leading "I need to" / "remember to" style phrasing from the title — keep the action (e.g. "go to the gym"). Fix obvious typos when the intended word is clear (e.g. jym → gym). Include time hints in the title if given (e.g. "go to the gym at 7pm") when they specify a time.
- due_date: YYYY-MM-DD if they imply a calendar day (today, tonight, tomorrow, this Friday, etc.), using the provided reference date. null if unspecified.
- priority: default "normal"; "high" only if they say urgent / important / ASAP.

When in doubt, use intent "none".`;

  const user = `Reference calendar date (today): ${contextDate}
User line: ${JSON.stringify(userText)}`;

  let modelUsed = getTaskClassifierModelId();
  let msg;
  try {
    msg = await runClassifierCreate(client, modelUsed, system, user);
  } catch (err) {
    const is404 = err?.status === 404;
    if (is404 && modelUsed !== TASK_CLASSIFIER_FALLBACK_MODEL_ID) {
      debugLog(debug, 'ea', 'task classifier model 404, retry', `${modelUsed} → ${TASK_CLASSIFIER_FALLBACK_MODEL_ID}`);
      modelUsed = TASK_CLASSIFIER_FALLBACK_MODEL_ID;
      msg = await runClassifierCreate(client, modelUsed, system, user);
    } else {
      throw err;
    }
  }

  const block = msg.content?.find((b) => b.type === 'text');
  const raw = block?.text?.trim() ?? '';
  const parsed = extractJsonObject(raw);
  if (!parsed || typeof parsed !== 'object') {
    debugLog(debug, 'ea', 'task ai classify parse', raw.slice(0, 200));
    return { intent: null, outcome: 'parse_error', model: modelUsed };
  }

  if (parsed.intent !== 'add') {
    return { intent: null, outcome: 'none', model: modelUsed };
  }

  const title = String(parsed.title || '').trim().slice(0, 500);
  if (!title) {
    return { intent: null, outcome: 'invalid_add', model: modelUsed };
  }

  let dueDate;
  const dd = parsed.due_date;
  if (dd != null && dd !== '') {
    const ds = String(dd).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(ds)) dueDate = ds;
  }

  let priority = 'normal';
  if (VALID_PRIORITY.has(parsed.priority)) priority = parsed.priority;

  return {
    intent: { action: 'add', title, dueDate, priority },
    outcome: 'add',
    model: modelUsed,
  };
}
