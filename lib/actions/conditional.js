// lib/actions/conditional.js
// Evaluates conditional steps before the chain engine decides to proceed or skip.
// Called by chain-engine.js for steps with step_type === 'conditional'.
//
// Returns: { proceed: bool, reason?: string, message?: string }
//   proceed: true  → chain continues (step is logged as 'success')
//   proceed: false → chain skips this step (step is logged as 'skipped')
//   reason         → internal note logged to action_log.error_detail
//   message        → surfaced to the user by the EA (e.g. "Heads up: rain expected at 2pm")
//
// action_config shape varies by kind:
//
//   weather_check:
//     { kind: 'weather_check', lat: number, lon: number,
//       condition: 'no_rain'|'no_extreme', warn_only?: bool,
//       message_on_warn?: string }
//
//   time_check:
//     { kind: 'time_check', after?: 'HH:MM', before?: 'HH:MM',
//       days?: ['mon','tue','wed','thu','fri','sat','sun'] }
//
//   calendar_check:
//     { kind: 'calendar_check', has_event_in_next?: number (minutes),
//       no_event_in_next?: number (minutes) }
//     Note: calendar_check uses the owner_config.calendar_webhook if configured.
//     Without a webhook, it proceeds by default (cannot read calendar server-side).

export async function evaluateConditional(config) {
  const { kind } = config;

  if (!kind) {
    return { proceed: false, reason: 'conditional action_config missing kind' };
  }

  switch (kind) {
    case 'weather_check':  return evaluateWeather(config);
    case 'time_check':     return evaluateTime(config);
    case 'calendar_check': return evaluateCalendar(config);
    default:
      return { proceed: false, reason: `Unknown conditional kind: ${kind}` };
  }
}

// ---------------------------------------------------------------------------
// Weather check
// Uses Open-Meteo — free, no API key required, accurate enough for this use case.
// config: { lat, lon, condition, warn_only?, message_on_warn? }
//
// condition values:
//   'no_rain'    — proceed only if no rain in the next 6 hours
//   'no_extreme' — proceed only if no extreme weather (storm, snow, heavy rain)
//   'always'     — always proceed, but surface weather as a message
// ---------------------------------------------------------------------------
async function evaluateWeather({ lat, lon, condition, warn_only, message_on_warn }) {
  if (!lat || !lon) {
    return { proceed: true, reason: 'No coordinates provided, skipping weather check' };
  }

  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&hourly=weathercode&forecast_days=1&timezone=auto`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Open-Meteo error: ${res.status}`);
    const data = await res.json();

    // WMO weather codes for the next 6 hours
    const now = new Date();
    const currentHour = now.getHours();
    const nextSixHours = (data.hourly?.weathercode || []).slice(currentHour, currentHour + 6);

    const hasRain = nextSixHours.some(code => isRain(code));
    const hasExtreme = nextSixHours.some(code => isExtreme(code));

    const weatherSummary = summariseWeather(nextSixHours);

    if (condition === 'always') {
      return {
        proceed: true,
        message: weatherSummary ? `Weather heads-up: ${weatherSummary}` : undefined,
      };
    }

    if (condition === 'no_rain' && hasRain) {
      const msg = message_on_warn || `Rain expected in the next 6 hours. ${weatherSummary}`;
      if (warn_only) {
        // Warn but still proceed
        return { proceed: true, message: msg };
      }
      return { proceed: false, reason: 'rain expected', message: msg };
    }

    if (condition === 'no_extreme' && hasExtreme) {
      const msg = message_on_warn || `Extreme weather expected. ${weatherSummary}`;
      if (warn_only) {
        return { proceed: true, message: msg };
      }
      return { proceed: false, reason: 'extreme weather expected', message: msg };
    }

    return { proceed: true };

  } catch (err) {
    // Weather check failure is non-fatal — proceed with a note
    return { proceed: true, reason: `Weather check failed: ${err.message}` };
  }
}

// WMO code helpers
function isRain(code) {
  // 51-67: drizzle/rain, 80-82: rain showers, 95-99: thunderstorm
  return (code >= 51 && code <= 67) || (code >= 80 && code <= 82) || code >= 95;
}

function isExtreme(code) {
  // 65-67: heavy rain, 75-77: heavy snow, 82: violent showers, 95-99: thunderstorm
  return [65, 66, 67, 75, 76, 77, 82, 95, 96, 99].includes(code);
}

function summariseWeather(codes) {
  if (!codes || codes.length === 0) return '';
  const max = Math.max(...codes);
  if (max >= 95) return 'Thunderstorms likely.';
  if (max >= 80) return 'Rain showers expected.';
  if (max >= 65) return 'Heavy rain expected.';
  if (max >= 51) return 'Light rain or drizzle expected.';
  if (max >= 71) return 'Snow expected.';
  return '';
}

// ---------------------------------------------------------------------------
// Time check
// Purely server-side, no external call.
// config: { after?: 'HH:MM', before?: 'HH:MM', days?: [...] }
// All times evaluated in server local time. For timezone accuracy, pass tz in config.
// ---------------------------------------------------------------------------
function evaluateTime({ after, before, days, tz }) {
  const now = tz
    ? new Date(new Date().toLocaleString('en-US', { timeZone: tz }))
    : new Date();

  const currentHour = now.getHours();
  const currentMin = now.getMinutes();
  const currentDay = ['sun','mon','tue','wed','thu','fri','sat'][now.getDay()];

  if (days && days.length > 0) {
    if (!days.includes(currentDay)) {
      return { proceed: false, reason: `Today (${currentDay}) not in allowed days: ${days.join(', ')}` };
    }
  }

  const currentMinutes = currentHour * 60 + currentMin;

  if (after) {
    const [h, m] = after.split(':').map(Number);
    const afterMinutes = h * 60 + m;
    if (currentMinutes < afterMinutes) {
      return { proceed: false, reason: `Current time ${formatTime(currentHour, currentMin)} is before ${after}` };
    }
  }

  if (before) {
    const [h, m] = before.split(':').map(Number);
    const beforeMinutes = h * 60 + m;
    if (currentMinutes >= beforeMinutes) {
      return { proceed: false, reason: `Current time ${formatTime(currentHour, currentMin)} is at or after ${before}` };
    }
  }

  return { proceed: true };
}

function formatTime(h, m) {
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// Calendar check
// Server-side calendar access requires a webhook or OAuth integration.
// Phase 2: if no calendar webhook is configured, we proceed by default.
// Phase 3 will add proper calendar integration via Google/Apple Calendar APIs.
// config: { has_event_in_next?: number, no_event_in_next?: number, calendar_webhook?: string }
// ---------------------------------------------------------------------------
async function evaluateCalendar({ has_event_in_next, no_event_in_next, calendar_webhook }) {
  if (!calendar_webhook) {
    // No integration configured — proceed, note the limitation
    return {
      proceed: true,
      reason: 'No calendar webhook configured — calendar check skipped',
    };
  }

  try {
    const windowMinutes = has_event_in_next || no_event_in_next || 60;
    const res = await fetch(`${calendar_webhook}?window_minutes=${windowMinutes}`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(5000),
    });

    if (!res.ok) throw new Error(`Calendar webhook error: ${res.status}`);
    const data = await res.json();
    // Expected response: { has_event: bool, next_event?: { title, start } }

    if (has_event_in_next !== undefined) {
      if (!data.has_event) {
        return { proceed: false, reason: 'No calendar event found in window' };
      }
      const eventNote = data.next_event?.title
        ? `Next: "${data.next_event.title}" at ${data.next_event.start}`
        : undefined;
      return { proceed: true, message: eventNote };
    }

    if (no_event_in_next !== undefined) {
      if (data.has_event) {
        const eventNote = data.next_event?.title
          ? `"${data.next_event.title}" is coming up`
          : 'You have an event coming up';
        return { proceed: false, reason: 'Event found in window', message: eventNote };
      }
      return { proceed: true };
    }

    return { proceed: true };

  } catch (err) {
    // Calendar check failure is non-fatal
    return { proceed: true, reason: `Calendar check failed: ${err.message}` };
  }
}
