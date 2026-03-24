// GET /api/morning-briefing
// Single JSON payload for the morning briefing UI (panels + links). Owner sessions only.

import Anthropic from '@anthropic-ai/sdk';
import { parse as parseCookies } from 'cookie';
import { queryOne } from '../db/client.js';
import {
  fetchWeatherSnapshot,
  fetchNewsStories,
  parseBriefingInterests,
  parseBriefingTickers,
  googleNewsSearchUrl,
} from '../lib/briefing-data.js';

const client = new Anthropic();

const FORMATTING_RULES =
  '\n\nFORMATTING: Never use markdown. Plain conversational sentences only.';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const cookies = parseCookies(req.headers.cookie ?? '');
  const token = cookies['ea_session'];
  if (!token) return res.status(401).json({ error: 'No session' });

  const session = await queryOne(
    `SELECT s.token, s.is_shell, s.owner_id
     FROM sessions s
     WHERE s.token = ? AND datetime(s.expires_at) > datetime('now')`,
    [token]
  );
  if (!session) return res.status(401).json({ error: 'Invalid or expired session' });
  if (session.is_shell === 1) {
    return res.status(403).json({ error: 'Morning briefing is not available in restricted mode' });
  }

  const url = new URL(req.url, `http://${req.headers.host}`);
  const lat = parseFloat(url.searchParams.get('lat'));
  const lon = parseFloat(url.searchParams.get('lon'));
  const localHour = url.searchParams.get('localHour');
  const newsPage = Math.min(10, Math.max(1, parseInt(url.searchParams.get('news_page') || '1', 10) || 1));

  const sections = url.searchParams.get('sections');

  // Pagination: append headlines only (client "Show more")
  if (sections === 'news_more') {
    const configMore = await queryOne(
      `SELECT briefing_interests FROM owner_config WHERE id = ?`,
      [session.owner_id]
    );
    const interests = parseBriefingInterests(configMore?.briefing_interests ?? '');
    const newsResult = await fetchNewsStories({
      page: newsPage,
      pageSize: 5,
      interests,
    });
    res.setHeader('Cache-Control', 'private, no-store');
    return res.status(200).json({
      version: 1,
      news_page: newsPage,
      items: newsResult.items,
      has_more: newsResult.has_more,
    });
  }

  // Weather only — EA chat "weather" intent
  if (sections === 'weather') {
    let weatherOnly = null;
    try {
      weatherOnly = await fetchWeatherSnapshot(lat, lon);
    } catch (err) {
      console.error('[morning-briefing] weather:', err.message);
    }
    const panels = [];
    if (weatherOnly) {
      panels.push({
        type: 'weather',
        title: 'Weather',
        icon: '☀️',
        data: weatherOnly,
      });
    }
    res.setHeader('Cache-Control', 'private, no-store');
    return res.status(200).json({
      version: 1,
      greeting: null,
      panels,
      explore: null,
    });
  }

  // Headlines only — EA chat "news" intent
  if (sections === 'news') {
    const configNews = await queryOne(
      `SELECT briefing_interests FROM owner_config WHERE id = ?`,
      [session.owner_id]
    );
    const interests = parseBriefingInterests(configNews?.briefing_interests ?? '');
    const newsResult = await fetchNewsStories({
      page: 1,
      pageSize: 5,
      interests,
    });
    const exploreQuery = interests.length > 0 ? interests.join(' ') : 'Top US news today';
    res.setHeader('Cache-Control', 'private, no-store');
    return res.status(200).json({
      version: 1,
      greeting: null,
      panels: [
        {
          type: 'news',
          title: interests.length ? 'News for you' : 'Headlines',
          icon: '📰',
          items: newsResult.items,
          news_page: 1,
          has_more: newsResult.has_more,
          feed: newsResult.source,
        },
      ],
      explore: {
        label: 'Explore on Google News',
        url: googleNewsSearchUrl(exploreQuery),
      },
    });
  }

  const config = await queryOne(
    `SELECT display_name, ea_personality, briefing_interests, briefing_tickers
     FROM owner_config WHERE id = ?`,
    [session.owner_id]
  );

  let systemPrompt =
    config?.ea_personality ||
    `You are EA, a personal AI assistant for ${config?.display_name ?? 'the owner'}.
Keep responses concise — mobile interface.`;
  systemPrompt += FORMATTING_RULES;

  const displayName = config?.display_name ?? null;
  const interests = parseBriefingInterests(config?.briefing_interests ?? '');
  const tickers = parseBriefingTickers(config?.briefing_tickers ?? '');

  const hour =
    localHour !== null && localHour !== undefined && localHour !== ''
      ? Number(localHour)
      : new Date().getHours();
  const greet = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const firstName = displayName ? displayName.split(' ')[0] : null;
  const greeting = firstName ? `${greet}, ${firstName}` : greet;

  let weather = null;
  try {
    weather = await fetchWeatherSnapshot(lat, lon);
  } catch (err) {
    console.error('[morning-briefing] weather:', err.message);
  }

  const newsResult = await fetchNewsStories({
    page: newsPage,
    pageSize: 5,
    interests,
  });

  let quoteText = 'Have a steady, intentional day.';
  try {
    quoteText = await generateBriefingQuote({
      displayName,
      weather,
      systemPrompt,
    });
  } catch (err) {
    console.error('[morning-briefing] quote:', err.message);
  }

  const exploreQuery = interests.length > 0 ? interests.join(' ') : 'Top US news today';
  const explore = {
    label: 'Explore on Google News',
    url: googleNewsSearchUrl(exploreQuery),
  };

  const panels = [];

  if (weather) {
    panels.push({
      type: 'weather',
      title: 'Weather',
      icon: '☀️',
      data: weather,
    });
  }

  panels.push({
    type: 'news',
    title: interests.length ? 'News for you' : 'Headlines',
    icon: '📰',
    items: newsResult.items,
    news_page: newsPage,
    has_more: newsResult.has_more,
    feed: newsResult.source,
  });

  panels.push({
    type: 'quote',
    title: 'Today',
    icon: '✨',
    text: quoteText,
  });

  if (tickers.length > 0) {
    panels.push({
      type: 'stocks',
      title: 'Watchlist',
      icon: '📈',
      tickers: tickers.map(symbol => ({
        symbol,
        stocks_url: `stocks://?symbol=${encodeURIComponent(symbol)}`,
        web_url: `https://finance.yahoo.com/quote/${encodeURIComponent(symbol)}`,
      })),
    });
  }

  res.setHeader('Cache-Control', 'private, no-store');
  return res.status(200).json({
    version: 1,
    greeting,
    panels,
    explore,
  });
}

async function generateBriefingQuote({ displayName, weather, systemPrompt }) {
  const firstName = displayName ? displayName.split(' ')[0] : 'the owner';
  const outdoor = weather?.outdoor_good;
  const prompt = `Write one short motivational line for ${firstName}'s morning briefing.
${outdoor ? 'Weather is pleasant for being outside — you may mention it briefly.' : ''}
One sentence only. No attribution. Plain text — no markdown, no bold.`;

  const msg = await client.messages.create({
    model: 'claude-sonnet-4-5',
    max_tokens: 100,
    system: systemPrompt,
    messages: [{ role: 'user', content: prompt }],
  });

  const block = msg.content?.find(b => b.type === 'text');
  const text = block?.text?.trim();
  return text || 'Have a focused, good day.';
}
