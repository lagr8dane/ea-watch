// lib/clock-intent.js — EA chat: timer duration vs alarm phrasing (no LLM URLs)

/**
 * @returns {{ kind: 'timer', minutes: number } | { kind: 'alarm' } | null}
 */
export function parseClockIntent(raw) {
  const text = String(raw || '').trim();
  if (!text) return null;

  const mins = parseTimerMinutes(text);
  if (mins != null && mins > 0 && mins <= 24 * 60) {
    return { kind: 'timer', minutes: mins };
  }

  if (isAlarmPhrase(text)) return { kind: 'alarm' };

  return null;
}

/** Timer phrases only — avoids stealing "remind me in 5 minutes" (task/reminder). */
function hasTimerContext(s) {
  return /\b(timer|countdown)\b/i.test(s) || /\bset\s+(a\s+)?timer\b/i.test(s);
}

function isAlarmPhrase(s) {
  const lower = s.toLowerCase();
  if (hasTimerContext(s) && !/\balarm\b/i.test(s)) return false;
  if (/\bwake\s+me(?:\s+up)?\s+at\b/i.test(lower)) return true;
  if (/\bset\s+(an\s+|a\s+)?alarm\b/i.test(lower)) return true;
  if (/\balarm\s+(?:for|at)\b/i.test(lower)) return true;
  return false;
}

/**
 * First duration in minutes, only when timer context matches.
 * @returns {number | null}
 */
function parseTimerMinutes(text) {
  if (!hasTimerContext(text)) return null;

  const re = /(\d+(?:\.\d+)?)\s*(hours?|hrs?|h\b|min(?:ute)?s?|m\b|sec(?:ond)?s?|s\b)/gi;
  let total = 0;
  let m;
  let any = false;
  while ((m = re.exec(text)) !== null) {
    const n = parseFloat(m[1]);
    if (Number.isNaN(n) || n <= 0) continue;
    any = true;
    const unit = m[2].toLowerCase();
    let minutes;
    if (/^h/.test(unit) || unit === 'hr' || unit === 'hrs' || unit === 'hour' || unit === 'hours') {
      minutes = n * 60;
    } else if (unit.startsWith('sec') || unit === 's') {
      minutes = n / 60;
    } else {
      minutes = n;
    }
    total += minutes;
  }

  return any ? total : null;
}
