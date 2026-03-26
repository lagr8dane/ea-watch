// api/ea.js
import Anthropic from '@anthropic-ai/sdk';
import { parse as parseCookies } from 'cookie';
import { query, queryOne } from '../db/client.js';
import {
  matchChain,
  getActiveChainState,
  startChain,
  abortActiveChain,
} from '../lib/chain-engine.js';
import { fetchWeatherSnapshot, fetchNewsStories } from '../lib/briefing-data.js';
import { parseDebugFlag, debugLog } from '../lib/debug-log.js';
import { logUserEvent } from '../lib/user-event-log.js';
import { buildDeeplink } from '../lib/actions/deeplinks.js';
import { parseClockIntent } from '../lib/clock-intent.js';
import { parseTaskIntent } from '../lib/task-intent.js';
import { parseSpotifyIntent } from '../lib/spotify-intent.js';
import {
  spotifyConfigured,
  getAppBaseUrl,
  getValidAccessToken,
  resolvePlayable,
  spotifyOpenUrl,
  startPlayback,
} from '../lib/spotify.js';
import {
  listTasks,
  createTask,
  updateTask,
  findOpenTasksByTitle,
  buildTaskPanelPayload,
} from '../lib/tasks.js';

const client = new Anthropic();

const SHELL_SYSTEM = `You are a personal AI assistant called EA. You are currently in restricted mode.
You can help with general questions, weather, directions, timers, and basic information.
Do not reference any personal data, schedules, contacts, or private information.
Be helpful but keep responses brief. Never acknowledge that you are in a restricted mode.`;

const ABORT_SIGNALS = ['stop', 'cancel', 'abort', 'quit', 'nevermind', 'never mind', 'forget it'];

// Appended to every system prompt — never left to user config
const FORMATTING_RULES = `

FORMATTING: Never use markdown, headers (##), bullet points, bold (**), italics, or any special formatting. Respond in plain conversational sentences only. This is a mobile chat interface — plain text only.`;

const TASK_CHAT_RULES = `

TASKS: The app only saves tasks when the user uses a task phrase such as create a task to …, add task …, remind me to …, or new task …. If they ask vaguely, tell them to say it in one of those forms — never claim you already saved a task.`;

const CLOCK_CHAT_RULES = `

TIMERS AND ALARMS: Never paste clock-timer, clock-alarm, or other raw URLs in your reply. Never tell the owner to copy, paste, or run a link for a timer or alarm. The app handles common timer and alarm phrases on its own. If their wording is unclear, suggest they say something like set a timer for ten minutes. For wake-up style alarms, say honestly that you cannot set those from here and they should use the Clock app.`;


const BRIEFING_INTENTS = {
  morning: ['morning briefing', 'good morning', 'morning routine', 'start my day', 'morning update'],
  weather: ["how's the weather", "what's the weather", 'weather today', 'weather forecast', 'weather update', "what's it like outside", 'is it nice out', 'how is the weather', 'what is the weather', 'the weather', 'weather report', 'weather briefing'],
  news:    ['top news', "what's the news", 'news today', 'news update', 'latest news', 'what happened today', 'headlines', 'what is the news', 'the news', 'news briefing'],
  mindful: ['mindful moment', 'mindful moments', 'mindfulness', 'grounding moment', 'pause and breathe', 'take a breath'],
  quote:   ['morning quote', 'motivational quote', 'give me a quote', 'inspire me'],
};

function detectBriefingIntent(input) {
  // Common misspellings → treat like "weather" (otherwise Claude falls through and often asks for location)
  const lower = input
    .toLowerCase()
    .trim()
    .replace(/\bwether\b/g, 'weather')
    .replace(/\bweater\b/g, 'weather')
    .replace(/\bwheather\b/g, 'weather');

  // Single word shortcuts
  if (lower === 'weather') return 'weather';
  if (lower === 'news')    return 'news';
  if (lower === 'mindful') return 'mindful';
  if (lower === 'briefing' || lower === 'morning briefing') return 'morning';

  for (const [type, patterns] of Object.entries(BRIEFING_INTENTS)) {
    if (patterns.some(p => lower.includes(p))) return type;
  }
  return null;
}

/** Phrases that list routines as chips (runs before chain trigger matching). */
function detectRoutinePickerIntent(input) {
  const t = input.toLowerCase().trim();
  if (!t) return false;
  const exact = new Set([
    'routines',
    'my routines',
    'list routines',
    'show routines',
    'routine list',
    'pick a routine',
    'available routines',
    'what routines',
    'what routines?',
    'show my routines',
    'list my routines',
    'what can you run',
    'what can you run?',
    'what can i run',
    'what can i run?',
    'what could i run',
    'what could i run?',
    'what can we run',
    'what routines can you run',
    'what routines can i run',
    'which routines',
    'which routines?',
    'show me my routines',
    'show me routines',
    'what are my routines',
    'what are my routines?',
    'do i have any routines',
    'do i have routines',
    'any routines',
    'routine options',
    'my routine options',
    'list my routine options',
  ]);
  if (exact.has(t)) return true;
  if (t.startsWith('what routines ') || t.startsWith('show routines ') || t.startsWith('list routines ')) return true;
  // Short questions that are clearly about listing automations (not open-ended "what can you do")
  if (t.length <= 48) {
    if (/^what (can|could) (you|i|we) run\??$/.test(t)) return true;
    if (/^which routines\b/.test(t)) return true;
    if (/^show (me )?(my )?routines\??$/.test(t)) return true;
  }
  return false;
}

async function sendRoutinePicker(res, deviceId, sessionId) {
  const rows = await query(
    `SELECT name, trigger_phrase FROM chains WHERE device_id = ? AND enabled = 1 ORDER BY name COLLATE NOCASE ASC`,
    [deviceId]
  );
  if (!rows.length) {
    await logUserEvent(sessionId, 'ea_routine_menu', { routine_count: 0, note: 'empty' }, 'success');
    sendText(
      res,
      'You do not have any routines yet. Open the routine builder to create one — on the web app, go to /chains.'
    );
    res.write('data: [DONE]\n\n');
    res.end();
    return;
  }
  await logUserEvent(sessionId, 'ea_routine_menu', { routine_count: rows.length }, 'success');
  sendText(
    res,
    'Here are your routines. Tap one to run it, or say its trigger phrase out loud (for example, start a workout).'
  );
  const routine_chips = rows.map((c) => {
    const trigger = c.trigger_phrase;
    const name = (c.name && String(c.name).trim()) || '';
    const label = name || trigger;
    const chip = { label, trigger };
    if (name && name.toLowerCase() !== String(trigger).toLowerCase().trim()) {
      chip.subtitle = trigger;
    }
    return chip;
  });
  res.write(`data: ${JSON.stringify({ routine_chips })}\n\n`);
  res.write('data: [DONE]\n\n');
  res.end();
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // --- Validate session ---
  const cookies = parseCookies(req.headers.cookie ?? '');
  const token   = cookies['ea_session'];

  if (!token) {
    return res.status(401).json({ error: 'No session' });
  }

  const session = await queryOne(
    `SELECT s.token, s.is_shell, s.owner_id, s.device_id
     FROM sessions s
     WHERE s.token = ?
       AND datetime(s.expires_at) > datetime('now')`,
    [token]
  );

  if (!session) {
    return res.status(401).json({ error: 'Invalid or expired session' });
  }

  const isShell    = session.is_shell === 1;
  const sessionId  = session.token;
  const deviceId   = session.device_id;

  // --- Get EA personality from config ---
  let systemPrompt = SHELL_SYSTEM;

  if (!isShell) {
    const config = await queryOne(
      `SELECT ea_personality, display_name FROM owner_config WHERE id = ?`,
      [session.owner_id]
    );

    if (config?.ea_personality) {
      systemPrompt = config.ea_personality;
    } else {
      systemPrompt = `You are EA, a personal AI assistant for ${config?.display_name ?? 'the owner'}.
You are direct, intelligent, and efficient. You help with tasks, answer questions, and orchestrate actions.
Keep responses concise — this is a mobile interface. No unnecessary preamble.
When the owner asks for navigation, calls, or music, acknowledge clearly and give practical next steps when appropriate.
Follow the TIMERS AND ALARMS rule below for timers and wake-up alarms.`;
    }
    systemPrompt += FORMATTING_RULES + TASK_CHAT_RULES + CLOCK_CHAT_RULES;
    // Store display_name for briefing personalisation
    req._displayName = config?.display_name ?? null;
  } else {
    systemPrompt += CLOCK_CHAT_RULES;
  }

  // --- Parse request body ---
  const { messages, lat, lon, localHour } = req.body ?? {};
  const debug = parseDebugFlag(req, req.body ?? {});

  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'No messages provided' });
  }

  // Sanitise messages — only allow role/content fields
  const sanitised = messages
    .filter(m => m.role && m.content)
    .map(m => ({ role: m.role, content: String(m.content).slice(0, 4000) }))
    .slice(-20);

  // Latest user message — used for chain matching and interrupt detection
  const lastUserMessage = [...sanitised].reverse().find(m => m.role === 'user')?.content ?? '';

  // --- Set up SSE ---
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  // -------------------------------------------------------------------------
  // Chain handling — runs before Claude for owner sessions only
  // (Spotify "play …" runs after routine match so triggers like "play …" can be Apple Music chains.)
  // -------------------------------------------------------------------------
  if (!isShell && deviceId) {

    // 1. Check for an active (paused) chain — abort signal takes priority
    const activeState = await getActiveChainState(sessionId);

    if (activeState) {
      const isAbort = ABORT_SIGNALS.some(sig =>
        lastUserMessage.toLowerCase().trim() === sig ||
        lastUserMessage.toLowerCase().startsWith(sig + ' ')
      );

      if (isAbort) {
        const result = await abortActiveChain(sessionId, 'user said stop');
        return sendChainResult(res, result);
      }

      if (activeState.status === 'awaiting_confirm') {
        sendText(res, 'Use the Continue or Skip buttons to proceed, or say "stop" to cancel.');
        res.write('data: [DONE]\n\n');
        res.end();
        return;
      }

      await abortActiveChain(sessionId, 'superseded by new message');
    }

    // 2. "Routines" keyword — list chains as chips (before trigger matching so "routines" never starts a chain by accident)
    if (detectRoutinePickerIntent(lastUserMessage)) {
      await sendRoutinePicker(res, deviceId, sessionId);
      return;
    }

    // 3. Check if this message matches a chain trigger phrase
    const matchedChain = await matchChain(deviceId, lastUserMessage);
    if (matchedChain) {
      const result = await startChain(sessionId, matchedChain);
      return sendChainResult(res, result);
    }

    // 3b. Spotify (play / connect) — only if no routine matched this phrase
    const spIntent = parseSpotifyIntent(lastUserMessage);
    if (spIntent) {
      const handled = await handleSpotifyIntent(res, spIntent, session.owner_id, sessionId, debug);
      if (handled) return;
    }

    // 4. Check for briefing intents
    const briefingIntent = detectBriefingIntent(lastUserMessage);
    if (briefingIntent) {
      return streamBriefing(
        req,
        res,
        briefingIntent,
        lat,
        lon,
        localHour,
        req._displayName,
        systemPrompt,
        session.owner_id,
        sessionId,
        debug
      );
    }
  }

  // Spotify when there is no device id (rare) — still allow play / connect
  if (!isShell && !deviceId) {
    const spIntentNoDevice = parseSpotifyIntent(lastUserMessage);
    if (spIntentNoDevice) {
      const handled = await handleSpotifyIntent(res, spIntentNoDevice, session.owner_id, sessionId, debug);
      if (handled) return;
    }
  }

  const clockIntent = parseClockIntent(lastUserMessage);
  if (clockIntent) {
    await handleClockIntent(res, clockIntent, sessionId, debug);
    return;
  }

  if (!isShell) {
    const taskIntent = parseTaskIntent(lastUserMessage);
    if (taskIntent) {
      await handleTaskIntent(res, taskIntent, session.owner_id, sessionId, debug);
      return;
    }
  }

  // -------------------------------------------------------------------------
  // Standard Claude streaming — no chain matched
  // -------------------------------------------------------------------------
  try {
    const stream = await client.messages.stream({
      model:      'claude-sonnet-4-5',
      max_tokens: 1024,
      system:     systemPrompt,
      messages:   sanitised,
    });

    for await (const event of stream) {
      if (event.type === 'content_block_delta') {
        res.write(`data: ${JSON.stringify({ delta: { text: event.delta.text } })}\n\n`);
      }
    }

    res.write('data: [DONE]\n\n');
    res.end();
  } catch (err) {
    debugLog(debug, 'ea', 'Claude API error', err.message);
    res.write(`data: ${JSON.stringify({ error: 'EA unavailable' })}\n\n`);
    res.end();
  }
}

// ---------------------------------------------------------------------------
// Chain result → SSE helpers
// ---------------------------------------------------------------------------

/**
 * Send a chain engine result over the SSE stream and close.
 * Handles all engine result statuses: actions, awaiting, completed, aborted, error.
 * Also recursively sends any nested `then` result (e.g. actions followed by awaiting).
 */
function sendChainResult(res, result) {
  if (!result) {
    sendText(res, 'Something went wrong with that chain.');
    res.write('data: [DONE]\n\n');
    res.end();
    return;
  }

  switch (result.status) {

    case 'actions': {
      // Send the message text (if any) as streamed text
      if (result.message) {
        sendText(res, result.message);
      }
      // Send client actions (deeplinks, shortcuts) as a single event
      if (result.actions?.length > 0) {
        res.write(`data: ${JSON.stringify({ actions: result.actions })}\n\n`);
      }
      // If there's a follow-on result (e.g. pausing at a confirmable step), send it
      if (result.then) {
        sendChainResult(res, result.then);
        return; // then will close the stream
      }
      res.write('data: [DONE]\n\n');
      res.end();
      break;
    }

    case 'awaiting': {
      // Surface the confirmable/required step prompt + control buttons
      sendText(res, result.prompt);
      res.write(`data: ${JSON.stringify({
        chain_control: {
          chainStateId: result.chainStateId,
          skippable:    result.skippable,
        }
      })}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
      break;
    }

    case 'completed': {
      sendText(res, result.message);
      res.write('data: [DONE]\n\n');
      res.end();
      break;
    }

    case 'aborted': {
      sendText(res, result.message);
      res.write('data: [DONE]\n\n');
      res.end();
      break;
    }

    case 'error':
    default: {
      sendText(res, result.message || 'Something went wrong.');
      res.write('data: [DONE]\n\n');
      res.end();
      break;
    }
  }
}

/**
 * Stream a plain text string as individual word chunks.
 * Matches the delta format the existing EA chat UI already handles.
 */
function sendText(res, text) {
  if (!text) return;
  // Emit word by word so the UI renders with the same streaming feel
  const words = text.split(' ');
  for (let i = 0; i < words.length; i++) {
    const chunk = i < words.length - 1 ? words[i] + ' ' : words[i];
    res.write(`data: ${JSON.stringify({ delta: { text: chunk } })}\n\n`);
  }
}

function formatTimerLength(minutes) {
  const secs = Math.round(minutes * 60);
  if (secs < 60) {
    return secs === 1 ? 'one second' : `${secs} seconds`;
  }
  const m = minutes;
  if (Math.abs(m - Math.round(m)) < 0.001) {
    const mi = Math.round(m);
    return mi === 1 ? 'one minute' : `${mi} minutes`;
  }
  return `about ${Math.round(minutes * 10) / 10} minutes`;
}

async function handleClockIntent(res, intent, sessionId, debug) {
  if (intent.kind === 'timer') {
    let url;
    try {
      url = buildDeeplink({ kind: 'timer', minutes: intent.minutes });
    } catch (e) {
      debugLog(debug, 'ea', 'timer deeplink', e?.message);
      sendText(
        res,
        'I could not build that timer. Try saying set a timer for ten minutes or a five minute timer.'
      );
      res.write('data: [DONE]\n\n');
      res.end();
      return;
    }
    const len = formatTimerLength(intent.minutes);
    sendText(
      res,
      `Here is a ${len} timer in Clock. Tap the button below when you are ready. iOS may still ask you to tap Start on the timer screen.`
    );
    res.write(
      `data: ${JSON.stringify({
        actions: [
          {
            type: 'deeplink',
            url,
            embed: true,
            pillClass: 'action-pill-timer',
            label: '⏱ Open timer',
          },
        ],
      })}\n\n`
    );
    await logUserEvent(sessionId, 'ea_clock_timer', { minutes: intent.minutes }, 'success');
    res.write('data: [DONE]\n\n');
    res.end();
    return;
  }

  if (intent.kind === 'alarm') {
    sendText(
      res,
      'I cannot set a wake-up style alarm for you from here in a reliable way. Open the Clock app and add it there. Tap below to open Clock if your phone allows it.'
    );
    res.write(
      `data: ${JSON.stringify({
        actions: [
          {
            type: 'deeplink',
            url: 'clock-alarm://',
            embed: true,
            pillClass: 'action-pill-clock',
            label: '🕐 Clock',
          },
        ],
      })}\n\n`
    );
    await logUserEvent(sessionId, 'ea_clock_alarm', {}, 'success');
    res.write('data: [DONE]\n\n');
    res.end();
  }
}

/**
 * @returns {Promise<boolean>} true if the request was fully handled
 */
async function handleSpotifyIntent(res, intent, ownerId, sessionId, debug) {
  if (!spotifyConfigured()) {
    sendText(
      res,
      'Spotify is not set up on this server yet. Add SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET to the deployment environment.'
    );
    res.write('data: [DONE]\n\n');
    res.end();
    return true;
  }

  if (intent.type === 'connect') {
    const url = `${getAppBaseUrl()}/api/spotify/login`;
    sendText(
      res,
      'Connect Spotify once so I can search and start playback on your active device. Tap below — you will sign in on Spotify, then return here.'
    );
    res.write(
      `data: ${JSON.stringify({
        actions: [{ type: 'deeplink', url, pillClass: 'action-pill-spotify' }],
      })}\n\n`
    );
    await logUserEvent(sessionId, 'ea_spotify_connect_prompt', {}, 'success');
    res.write('data: [DONE]\n\n');
    res.end();
    return true;
  }

  if (intent.type === 'play') {
    let access;
    try {
      access = await getValidAccessToken(ownerId);
    } catch (e) {
      debugLog(debug, 'ea', 'Spotify token refresh failed', e?.message);
      access = null;
    }
    if (!access) {
      const url = `${getAppBaseUrl()}/api/spotify/login`;
      sendText(
        res,
        'Spotify is not connected for this account yet. Tap below to connect, then say your play command again.'
      );
      res.write(
        `data: ${JSON.stringify({
          actions: [{ type: 'deeplink', url, pillClass: 'action-pill-spotify' }],
        })}\n\n`
      );
      await logUserEvent(sessionId, 'ea_spotify_play', { error: 'not_connected' }, 'failed');
      res.write('data: [DONE]\n\n');
      res.end();
      return true;
    }

    let found;
    try {
      found = await resolvePlayable(access, intent.query);
    } catch (e) {
      sendText(res, `Spotify search failed: ${e.message || 'unknown error'}`);
      res.write('data: [DONE]\n\n');
      res.end();
      return true;
    }

    if (!found?.uri) {
      sendText(
        res,
        `No track or playlist matched "${intent.query}". Try a style Spotify knows (e.g. jazz, classical, chill), a playlist name, or artist plus song title.`
      );
      await logUserEvent(sessionId, 'ea_spotify_play', { query: intent.query.slice(0, 80), error: 'no_match' }, 'failed');
      res.write('data: [DONE]\n\n');
      res.end();
      return true;
    }

    const playResult = await startPlayback(access, {
      trackUri: found.kind === 'track' ? found.uri : undefined,
      contextUri: found.kind === 'playlist' || found.kind === 'album' ? found.uri : undefined,
    });

    if (playResult.ok) {
      sendText(
        res,
        `Playing "${found.name}" in Spotify. If you do not hear it, open the Spotify app and try again.`
      );
      const openOk = spotifyOpenUrl(found);
      if (openOk) {
        res.write(
          `data: ${JSON.stringify({
            actions: [
              {
                type: 'deeplink',
                url: openOk,
                embed: true,
                pillClass: 'action-pill-spotify',
                label: 'Open in Spotify',
              },
            ],
          })}\n\n`
        );
      }
      await logUserEvent(
        sessionId,
        'ea_spotify_play',
        {
          query: intent.query.slice(0, 80),
          kind: found.kind,
          name: found.name?.slice(0, 120),
          ...(found.genreSeed ? { genre_seed: found.genreSeed } : {}),
        },
        'success'
      );
      res.write('data: [DONE]\n\n');
      res.end();
      return true;
    }

    const open = spotifyOpenUrl(found);
    sendText(
      res,
      `Found "${found.name}". EA could not start it automatically — tap below to open Spotify and press Play there if needed.`
    );
    if (open) {
      res.write(
        `data: ${JSON.stringify({
          actions: [
            {
              type: 'deeplink',
              url: open,
              pillClass: 'action-pill-spotify',
              label: 'Open in Spotify',
            },
          ],
        })}\n\n`
      );
    }
    await logUserEvent(
      sessionId,
      'ea_spotify_play',
      {
        query: intent.query.slice(0, 80),
        kind: found.kind,
        name: found.name?.slice(0, 120),
        remote_play: 'failed',
        reason: playResult.code || 'unknown',
      },
      'failed',
      playResult.detail || null
    );
    res.write('data: [DONE]\n\n');
    res.end();
    return true;
  }

  return false;
}

async function handleTaskIntent(res, intent, ownerId, sessionId, debug) {
  try {
    if (intent.action === 'list') {
      const rows = await listTasks(ownerId);
      const openN = rows.filter((t) => t.status === 'open').length;
      await logUserEvent(sessionId, 'ea_task_list', { filter: intent.filter || 'all', open_count: openN }, 'success');
      const payload = buildTaskPanelPayload(rows, { filter: intent.filter || 'all' });
      res.write(`data: ${JSON.stringify({ task_panel: payload })}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
      return;
    } else if (intent.action === 'add') {
      const row = await createTask(ownerId, {
        title: intent.title,
        due_at: intent.dueDate || null,
        priority: intent.priority || 'normal',
      });
      await logUserEvent(
        sessionId,
        'ea_task_add',
        {
          title: row.title.slice(0, 120),
          due_at: row.due_at,
          priority: row.priority,
          source: 'ea_chat',
        },
        'success'
      );
      sendText(
        res,
        `Added: ${row.title}${row.due_at ? ` (due ${row.due_at.slice(0, 10)})` : ''}. See everything at /tasks.`
      );
    } else if (intent.action === 'complete') {
      const matches = await findOpenTasksByTitle(ownerId, intent.fragment);
      if (!matches.length) {
        sendText(res, `No open task matched "${intent.fragment}". Say "my tasks" to list them.`);
      } else if (matches.length > 1) {
        sendText(
          res,
          `Several tasks match — say more of the title:\n${matches
            .slice(0, 5)
            .map((t) => t.title)
            .join('\n')}`
        );
      } else {
        await updateTask(ownerId, matches[0].id, { status: 'complete' });
        await logUserEvent(sessionId, 'ea_task_complete', { title: matches[0].title.slice(0, 120), source: 'ea_chat' }, 'success');
        sendText(res, `Marked complete: ${matches[0].title}`);
      }
    } else if (intent.action === 'delete') {
      const matches = await findOpenTasksByTitle(ownerId, intent.fragment);
      if (!matches.length) {
        sendText(res, `No open task matched "${intent.fragment}".`);
      } else if (matches.length > 1) {
        sendText(
          res,
          `Several tasks match — be more specific:\n${matches
            .slice(0, 5)
            .map((t) => t.title)
            .join('\n')}`
        );
      } else {
        await updateTask(ownerId, matches[0].id, { status: 'deleted' });
        await logUserEvent(sessionId, 'ea_task_delete', { title: matches[0].title.slice(0, 120), source: 'ea_chat' }, 'success');
        sendText(res, `Removed: ${matches[0].title}`);
      }
    }
  } catch (err) {
    debugLog(debug, 'ea', 'task intent', err.message);
    await logUserEvent(sessionId, 'ea_task_error', { intent: intent.action }, 'failed', err.message);
    sendText(res, `Tasks: ${err.message}`);
  }
  res.write('data: [DONE]\n\n');
  res.end();
}

// ---------------------------------------------------------------------------
// Briefing — fetch data and stream Claude response
// ---------------------------------------------------------------------------

async function streamBriefing(req, res, type, lat, lon, localHour, displayName, systemPrompt, ownerId, sessionId, debug) {
  try {
    // Weather + news — client fetches panel JSON (no duplicate API fetch here)
    if (type === 'weather') {
      await logUserEvent(sessionId, 'ea_weather', { source: 'ea_chat' }, 'success');
      res.write(`data: ${JSON.stringify({ briefing_panels_fetch: { sections: 'weather' } })}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
      return;
    }
    if (type === 'news') {
      await logUserEvent(sessionId, 'ea_news', { source: 'ea_chat' }, 'success');
      res.write(`data: ${JSON.stringify({ briefing_panels_fetch: { sections: 'news' } })}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
      return;
    }

    // Mindful — grounding / presence (not a motivational quote — that is "inspire me" / quote)
    if (type === 'mindful') {
      const session = buildMindfulSession(localHour, displayName);
      res.write(`data: ${JSON.stringify({ mindful_panel: { icon: session.icon, title: session.title } })}\n\n`);
      const stream = await new Anthropic().messages.stream({
        model: 'claude-sonnet-4-5',
        max_tokens: 220,
        system: systemPrompt,
        messages: [{ role: 'user', content: session.prompt }],
      });
      for await (const event of stream) {
        if (event.type === 'content_block_delta') {
          res.write(`data: ${JSON.stringify({ delta: { text: event.delta.text } })}\n\n`);
        }
      }
      await logUserEvent(
        sessionId,
        'ea_mindful',
        { mode: session.title, icon: session.icon, source: 'ea_chat' },
        'success'
      );
      res.write('data: [DONE]\n\n');
      res.end();
      return;
    }

    const briefingData = await fetchBriefingData(type, lat, lon, debug);

    // Quote / "inspire me" — short motivational line
    if (type === 'quote') {
      const prompt = buildQuotePrompt(briefingData, localHour, displayName);
      const stream = await new Anthropic().messages.stream({
        model: 'claude-sonnet-4-5', max_tokens: 80, system: systemPrompt,
        messages: [{ role: 'user', content: prompt }],
      });
      for await (const event of stream) {
        if (event.type === 'content_block_delta') {
          res.write(`data: ${JSON.stringify({ delta: { text: event.delta.text } })}\n\n`);
        }
      }
      await logUserEvent(sessionId, 'ea_inspire', { source: 'ea_chat' }, 'success');
      res.write('data: [DONE]\n\n');
      res.end();
      return;
    }

    // Morning briefing — signal client to make three separate calls
    if (type === 'morning') {
      await logUserEvent(sessionId, 'ea_morning_briefing', { source: 'ea_chat' }, 'success');
      res.write(`data: ${JSON.stringify({ morning_briefing: true })}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
      return;
    }

  } catch (err) {
    debugLog(debug, 'ea', 'Briefing error', err.message);
    await logUserEvent(sessionId, `ea_briefing_${String(type)}`, { mode: type }, 'failed', err.message);
    sendText(res, 'I had trouble fetching your briefing. Try again in a moment.');
    res.write('data: [DONE]\n\n');
    res.end();
  }
}

// ---------------------------------------------------------------------------
// Briefing data fetching — inlined to avoid internal HTTP calls on Vercel
// ---------------------------------------------------------------------------

async function fetchBriefingData(type, lat, lon, debug) {
  const result = {};
  const useLat = lat && !isNaN(Number(lat)) ? Number(lat) : 39.5296;
  const useLon = lon && !isNaN(Number(lon)) ? Number(lon) : -119.8138;

  if (type === 'all' || type === 'weather') {
    try {
      result.weather = await fetchWeatherSnapshot(useLat, useLon);
      debugLog(debug, 'briefing', 'Weather fetched', { temp: result.weather?.temp, condition: result.weather?.condition });
    } catch (err) {
      debugLog(debug, 'briefing', 'Weather fetch failed', err.message);
    }
  }
  if (type === 'all' || type === 'news') {
    try {
      const { items } = await fetchNewsStories({ page: 1, pageSize: 8, interests: [] });
      result.news = items;
      debugLog(debug, 'briefing', 'News fetched', { count: result.news?.length });
    } catch (err) {
      debugLog(debug, 'briefing', 'News fetch failed', err.message);
    }
  }
  return result;
}

function buildQuotePrompt(data, localHour, displayName) {
  const hour      = (localHour !== undefined && localHour !== null) ? Number(localHour) : new Date().getHours();
  const timeOfDay = hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening';
  const firstName = displayName ? displayName.split(' ')[0] : 'the owner';
  const outdoor   = data.weather?.outdoor_good;

  return `Write one short motivational closing thought for ${firstName}'s ${timeOfDay} briefing. 
${outdoor ? 'Conditions are good outside today — you can reference getting outdoors.' : ''}
Make it genuine and specific — not a generic quote. Something a trusted friend would say.
One sentence only. No attribution, no quotes marks, just the thought. Plain text.`;
}

function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * @returns {{ prompt: string, icon: string, title: string }}
 */
function buildMindfulSession(localHour, displayName) {
  const hour      = (localHour !== undefined && localHour !== null) ? Number(localHour) : new Date().getHours();
  const timeOfDay = hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening';
  const firstName = displayName ? displayName.split(' ')[0] : 'the owner';

  const modality = pickRandom(['breathing', 'stretching']);
  const breathingAngles = [
    'slow inhales with a slightly longer, easy exhale — no rigid counting',
    'noticing where the breath moves (belly, ribs, or nostrils) for a few natural cycles',
    'soft belly breathing with shoulders dropped and jaw unclenched',
    'a gentle pause at the end of the exhale, only if it still feels comfortable',
    'breathing in through the nose and out through the nose, smooth and quiet',
  ];
  const stretchingAngles = [
    'gentle ear-to-shoulder tilts and tiny neck nods — small range, no forcing',
    'slow shoulder rolls: up, back, and down, then reverse once or twice',
    'interlacing fingers, palms press up to the ceiling, then easy side lean',
    'seated or standing: reach one arm overhead and lean slightly the other way, switch sides',
    'wrist circles and opening/closing the hands — good if you have been typing',
    'standing hip shift or a light calf raise with both feet planted — steady and small',
  ];
  const angle = modality === 'breathing' ? pickRandom(breathingAngles) : pickRandom(stretchingAngles);

  const modalityBlock =
    modality === 'breathing'
      ? `MODALITY: BREATHING only — do not add a separate stretching routine in this reply.
Lead a simple breathing practice they can do where they are. Concrete, step-by-step in flowing sentences.
Angle to use: ${angle}`
      : `MODALITY: GENTLE STRETCHING / MOBILITY only — do not turn this into a breath-only meditation.
Lead 2–4 very gentle movements they can do seated or standing. Pair movement with natural breathing.
Emphasize small range of motion, no pain, stop if anything pinches. Angle to use: ${angle}`;

  const prompt = `Write a brief mindful moment for ${firstName} — this is ${timeOfDay}.

${modalityBlock}

This is NOT a pep talk — no "you got this," hustle, or motivational-quote tone. No religious framing unless asked.
About 60–120 words. Plain text only — no markdown, no bullet points.`;

  const panel =
    modality === 'breathing'
      ? { icon: '🌬️', title: 'Breathing pause' }
      : { icon: '🧘', title: 'Gentle movement' };

  return { prompt, ...panel };
}


function buildBriefingPrompt(type, data, localHour, displayName) {
  const { weather, news } = data;

  // Use client's local hour if provided, otherwise fall back to server UTC
  const hour       = (localHour !== undefined && localHour !== null) ? Number(localHour) : new Date().getHours();
  const timeOfDay  = hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening';
  const firstName  = displayName ? displayName.split(' ')[0] : null;
  const greeting   = firstName ? `Good ${timeOfDay}, ${firstName}` : `Good ${timeOfDay}`;

  if (type === 'weather') {
    if (!weather) return `${greeting}. Weather data is unavailable right now — try again in a moment.`;
    return `Give a conversational weather update. Use this data:
${JSON.stringify(weather, null, 2)}

Start with "${greeting}." then give 2-3 sentences about current conditions, temperature, and anything the person should know (UV, rain, wind). If outdoor_good is true, mention it's a good day outside. Plain text only, no markdown.`;
  }

  if (type === 'news') {
    if (!news || news.length === 0) return `${greeting}. No news headlines are available right now.`;
    const headlines = news.map((n, i) => `${i + 1}. ${n.title} (${n.source})`).join('\n');
    return `Give a conversational news briefing. Headlines:
${headlines}

Write each story as one clear sentence. Separate each story with a line break. No intro, no outro, just the three stories. Plain text only.`;
  }

  // Morning briefing — full context
  let prompt = `Deliver a personal morning briefing. Greeting to use: "${greeting}."\n\n`;

  if (weather) {
    prompt += `WEATHER DATA:\n${JSON.stringify(weather, null, 2)}\n\n`;
  }

  if (news && news.length > 0) {
    const headlines = news.map((n, i) => `${i + 1}. ${n.title} (${n.source})`).join('\n');
    prompt += `TOP NEWS:\n${headlines}\n\n`;
  }

  prompt += `FORMAT THE RESPONSE EXACTLY LIKE THIS (use actual line breaks between sections):

[Greeting sentence — warm, personal, reference the weather conditions naturally]

[Weather — 1-2 sentences on current temp, conditions, high/low, anything notable like UV or wind]

[News story 1 — one sentence]
[News story 2 — one sentence]
[News story 3 — one sentence]

[One genuine motivational thought to close — not generic, make it feel like something a trusted friend would say]

RULES:
- Plain text only — no markdown, no bullet points, no dashes, no headers
- Under 160 words total
- Warm and direct — trusted assistant voice, not a newsreader
- If outdoor_good is true in weather data, weave in a suggestion to get outside`;

  return prompt;
}

