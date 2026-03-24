// api/ea.js
import Anthropic from '@anthropic-ai/sdk';
import { parse as parseCookies } from 'cookie';
import { queryOne, execute } from '../db/client.js';
import {
  matchChain,
  getActiveChainState,
  startChain,
  abortActiveChain,
} from '../lib/chain-engine.js';

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
};

function detectBriefingIntent(input) {
  const lower = input.toLowerCase().trim();

  // Single word shortcuts
  if (lower === 'weather') return 'weather';
  if (lower === 'news')    return 'news';
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

    // 4. Check for first tap of the day — inject morning briefing proactively
    if (sanitised.length === 1 && sanitised[0].role === 'user') {
      const isFirstTapToday = await checkFirstTapToday(session.owner_id);
      if (isFirstTapToday) {
        await markMorningBriefingSent(session.owner_id);
        return streamBriefing(req, res, 'morning', lat, lon, localHour, req._displayName, systemPrompt, session.owner_id);
      }
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
    // Fetch briefing data directly — no internal HTTP call
    const briefingData = await fetchBriefingData(type, lat, lon);

    // For weather-only or news-only, stream as text
    if (type === 'weather' || type === 'news') {
      const prompt = buildBriefingPrompt(type, briefingData, localHour, displayName);
      const stream = await new Anthropic().messages.stream({
        model:      'claude-sonnet-4-5',
        max_tokens: 300,
        system:     systemPrompt,
        messages:   [{ role: 'user', content: prompt }],
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

    // Morning briefing — get Claude to generate the closing quote,
    // then send structured data for rich card rendering
    const quotePrompt = buildQuotePrompt(briefingData, localHour, displayName);
    const quoteStream = await new Anthropic().messages.stream({
      model:      'claude-sonnet-4-5',
      max_tokens: 100,
      system:     systemPrompt,
      messages:   [{ role: 'user', content: quotePrompt }],
    });

    let quote = '';
    for await (const event of quoteStream) {
      if (event.type === 'content_block_delta') {
        quote += event.delta.text;
      }
    }

    // Send the structured briefing event — client renders as a rich card
    const payload = {
      briefing: {
        weather: briefingData.weather || null,
        news:    briefingData.news || [],
        quote:   quote.trim(),
      }
    };

    res.write(`data: ${JSON.stringify(payload)}\n\n`);
    res.write('data: [DONE]\n\n');
    res.end();

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
  const useLat = (lat && !isNaN(lat)) ? lat : 39.5296;
  const useLon = (lon && !isNaN(lon)) ? lon : -119.8138;

  if (type === 'all' || type === 'weather') {
    try {
      result.weather = await fetchWeatherData(useLat, useLon);
      console.log('[briefing] Weather fetched:', result.weather?.temp, result.weather?.condition);
    } catch (err) {
      console.error('[briefing] Weather fetch failed:', err.message);
    }
  }
  if (type === 'all' || type === 'news') {
    try {
      result.news = await fetchNewsData();
      console.log('[briefing] News fetched:', result.news?.length, 'stories');
    } catch (err) {
      console.error('[briefing] News fetch failed:', err.message);
    }
  }
  return result;
}

async function fetchWeatherData(lat, lon) {
  const url = `https://api.open-meteo.com/v1/forecast?` +
    `latitude=${lat}&longitude=${lon}` +
    `&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m,relative_humidity_2m` +
    `&daily=temperature_2m_max,temperature_2m_min,weather_code,uv_index_max,precipitation_probability_max` +
    `&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=auto&forecast_days=1`;

  const res  = await fetch(url, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(`Open-Meteo ${res.status}`);
  const data = await res.json();

  const current = data.current;
  const daily   = data.daily;
  const code    = current.weather_code;

  return {
    temp:         Math.round(current.temperature_2m),
    feels_like:   Math.round(current.apparent_temperature),
    high:         Math.round(daily.temperature_2m_max[0]),
    low:          Math.round(daily.temperature_2m_min[0]),
    humidity:     current.relative_humidity_2m,
    wind:         Math.round(current.wind_speed_10m),
    uv_index:     daily.uv_index_max[0],
    rain_chance:  daily.precipitation_probability_max[0],
    condition:    wmoCondition(code),
    description:  wmoDescription(code),
    outdoor_good: isGoodOutdoor(code, daily.uv_index_max[0], daily.precipitation_probability_max[0]),
  };
}

function wmoCondition(code) {
  if (code === 0) return 'Clear';
  if (code <= 2)  return 'Partly cloudy';
  if (code === 3) return 'Overcast';
  if (code <= 49) return 'Foggy';
  if (code <= 59) return 'Drizzle';
  if (code <= 69) return 'Rain';
  if (code <= 79) return 'Snow';
  if (code <= 82) return 'Rain showers';
  if (code <= 86) return 'Snow showers';
  if (code >= 95) return 'Thunderstorm';
  return 'Unknown';
}

function wmoDescription(code) {
  if (code === 0)                return 'clear skies';
  if (code === 1)                return 'mainly clear';
  if (code === 2)                return 'partly cloudy';
  if (code === 3)                return 'overcast';
  if (code >= 45 && code <= 48)  return 'foggy';
  if (code >= 51 && code <= 55)  return 'light drizzle';
  if (code >= 61 && code <= 63)  return 'light to moderate rain';
  if (code === 65)               return 'heavy rain';
  if (code >= 71 && code <= 75)  return 'snow';
  if (code >= 80 && code <= 82)  return 'rain showers';
  if (code >= 95)                return 'thunderstorms';
  return 'mixed conditions';
}

function isGoodOutdoor(code, uvIndex, rainChance) {
  if (code >= 61)      return false;
  if (rainChance > 40) return false;
  if (uvIndex > 10)    return false;
  return true;
}

async function fetchNewsData() {
  const NEWSAPI_KEY = process.env.NEWSAPI_KEY;

  if (NEWSAPI_KEY) {
    try {
      const res = await fetch(
        `https://newsapi.org/v2/top-headlines?country=us&pageSize=5&apiKey=${NEWSAPI_KEY}`,
        { signal: AbortSignal.timeout(5000) }
      );
      if (res.ok) {
        const data = await res.json();
        return (data.articles || [])
          .filter(a => a.title && a.title !== '[Removed]')
          .slice(0, 3)
          .map(a => ({ title: a.title, source: a.source?.name || 'News', url: a.url }));
      }
    } catch {}
  }

  // AP RSS fallback
  const res = await fetch('https://feeds.apnews.com/apnews/topstories', {
    signal: AbortSignal.timeout(5000),
    headers: { Accept: 'application/rss+xml, text/xml' },
  });
  if (!res.ok) return [];
  const xml   = await res.text();
  const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0, 3);
  return items.map(m => {
    const item  = m[1];
    const title = item.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/)?.[1] ||
                  item.match(/<title>(.*?)<\/title>/)?.[1] || '';
    const link  = item.match(/<link>(.*?)<\/link>/)?.[1] || '';
    return { title: title.trim(), source: 'AP News', url: link.trim() };
  }).filter(i => i.title);
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

// ---------------------------------------------------------------------------
// First-tap-of-day detection
// We track morning briefings in owner_config.last_briefing_date
// ---------------------------------------------------------------------------

async function checkFirstTapToday(ownerId) {
  try {
    const config = await queryOne(
      `SELECT last_briefing_date FROM owner_config WHERE id = ?`,
      [ownerId]
    );
    if (!config) return false;

    const today     = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    const lastDate  = config.last_briefing_date;
    return lastDate !== today;
  } catch {
    return false;
  }
}

async function markMorningBriefingSent(ownerId) {
  try {
    const today = new Date().toISOString().slice(0, 10);
    await execute(
      `UPDATE owner_config SET last_briefing_date = ? WHERE id = ?`,
      [today, ownerId]
    );
  } catch (err) {
    console.error('[ea] Failed to mark briefing sent:', err.message);
  }
}
