// api/ea.js
import Anthropic from '@anthropic-ai/sdk';
import { parse as parseCookies } from 'cookie';
import { queryOne } from '../db/client.js';
import {
  matchChain,
  getActiveChainState,
  startChain,
  abortActiveChain,
} from '../lib/chain-engine.js';
import { fetchWeatherSnapshot, fetchNewsStories } from '../lib/briefing-data.js';

const client = new Anthropic();

const SHELL_SYSTEM = `You are a personal AI assistant called EA. You are currently in restricted mode.
You can help with general questions, weather, directions, timers, and basic information.
Do not reference any personal data, schedules, contacts, or private information.
Be helpful but keep responses brief. Never acknowledge that you are in a restricted mode.`;

const ABORT_SIGNALS = ['stop', 'cancel', 'abort', 'quit', 'nevermind', 'never mind', 'forget it'];

// Appended to every system prompt — never left to user config
const FORMATTING_RULES = `

FORMATTING: Never use markdown, headers (##), bullet points, bold (**), italics, or any special formatting. Respond in plain conversational sentences only. This is a mobile chat interface — plain text only.`;


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
When the owner asks you to do something that requires a phone action (navigation, calls, timers, music),
acknowledge it clearly and provide the relevant deeplink or instruction.`;
    }
    systemPrompt += FORMATTING_RULES;
    // Store display_name for briefing personalisation
    req._displayName = config?.display_name ?? null;
  }

  // --- Parse request body ---
  const { messages, lat, lon, localHour } = req.body ?? {};

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

    // 2. Check if this message matches a chain trigger phrase
    const matchedChain = await matchChain(deviceId, lastUserMessage);
    if (matchedChain) {
      const result = await startChain(sessionId, matchedChain);
      return sendChainResult(res, result);
    }

    // 3. Check for briefing intents
    const briefingIntent = detectBriefingIntent(lastUserMessage);
    if (briefingIntent) {
      return streamBriefing(req, res, briefingIntent, lat, lon, localHour, req._displayName, systemPrompt, session.owner_id);
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
    console.error('[ea] Claude API error:', err.message);
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

// ---------------------------------------------------------------------------
// Briefing — fetch data and stream Claude response
// ---------------------------------------------------------------------------

async function streamBriefing(req, res, type, lat, lon, localHour, displayName, systemPrompt, ownerId) {
  try {
    // Weather + news — client fetches panel JSON (no duplicate API fetch here)
    if (type === 'weather') {
      res.write(`data: ${JSON.stringify({ briefing_panels_fetch: { sections: 'weather' } })}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
      return;
    }
    if (type === 'news') {
      res.write(`data: ${JSON.stringify({ briefing_panels_fetch: { sections: 'news' } })}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
      return;
    }

    // Mindful — grounding / presence (not a motivational quote — that is "inspire me" / quote)
    if (type === 'mindful') {
      const prompt = buildMindfulPrompt(localHour, displayName);
      const stream = await new Anthropic().messages.stream({
        model: 'claude-sonnet-4-5',
        max_tokens: 220,
        system: systemPrompt,
        messages: [{ role: 'user', content: prompt }],
      });
      for await (const event of stream) {
        if (event.type === 'content_block_delta') {
          res.write(`data: ${JSON.stringify({ delta: { text: event.delta.text } })}\n\n`);
        }
      }
      res.write('data: [DONE]\n\n');
      res.end();
      return;
    }

    const briefingData = await fetchBriefingData(type, lat, lon);

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
      res.write('data: [DONE]\n\n');
      res.end();
      return;
    }

    // Morning briefing — signal client to make three separate calls
    if (type === 'morning') {
      res.write(`data: ${JSON.stringify({ morning_briefing: true })}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
      return;
    }

  } catch (err) {
    console.error('[ea] Briefing error:', err.message);
    sendText(res, 'I had trouble fetching your briefing. Try again in a moment.');
    res.write('data: [DONE]\n\n');
    res.end();
  }
}

// ---------------------------------------------------------------------------
// Briefing data fetching — inlined to avoid internal HTTP calls on Vercel
// ---------------------------------------------------------------------------

async function fetchBriefingData(type, lat, lon) {
  const result = {};
  const useLat = lat && !isNaN(Number(lat)) ? Number(lat) : 39.5296;
  const useLon = lon && !isNaN(Number(lon)) ? Number(lon) : -119.8138;

  if (type === 'all' || type === 'weather') {
    try {
      result.weather = await fetchWeatherSnapshot(useLat, useLon);
      console.log('[briefing] Weather fetched:', result.weather?.temp, result.weather?.condition);
    } catch (err) {
      console.error('[briefing] Weather fetch failed:', err.message);
    }
  }
  if (type === 'all' || type === 'news') {
    try {
      const { items } = await fetchNewsStories({ page: 1, pageSize: 8, interests: [] });
      result.news = items;
      console.log('[briefing] News fetched:', result.news?.length, 'stories');
    } catch (err) {
      console.error('[briefing] News fetch failed:', err.message);
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

function buildMindfulPrompt(localHour, displayName) {
  const hour      = (localHour !== undefined && localHour !== null) ? Number(localHour) : new Date().getHours();
  const timeOfDay = hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening';
  const firstName = displayName ? displayName.split(' ')[0] : 'the owner';

  return `Write a brief mindful moment for ${firstName} — this is ${timeOfDay}.
Focus on presence, breath, or a gentle body awareness. Calm and concrete (e.g. notice shoulders, exhale length).
This is NOT a pep talk or motivational quote — no "you got this" or hustle language. No religious framing unless asked.
About 60–100 words. Plain text only — no markdown, no bullet points.`;
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

