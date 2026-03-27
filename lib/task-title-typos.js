// lib/task-title-typos.js — obvious whole-word fixes before saving task titles (regex + Haiku paths)

const FIXES = [
  [/\bjym\b/gi, 'gym'],
  [/\bteh\b/gi, 'the'],
  [/\badn\b/gi, 'and'],
  [/\btaht\b/gi, 'that'],
  [/\btommorow\b/gi, 'tomorrow'],
  [/\btommorrow\b/gi, 'tomorrow'],
  [/\bdefinately\b/gi, 'definitely'],
  [/\brecieve\b/gi, 'receive'],
  [/\boccured\b/gi, 'occurred'],
];

/**
 * @param {string} raw
 * @returns {string}
 */
export function normalizeTaskTitleTypos(raw) {
  let s = String(raw || '').trim();
  if (!s) return s;
  for (const [re, rep] of FIXES) s = s.replace(re, rep);
  return s;
}
