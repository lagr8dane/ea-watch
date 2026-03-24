// api/briefing.js
// Fetches live weather and news data for the EA morning briefing.
// Called by api/ea.js — not a public endpoint.
//
// GET /api/briefing?lat=39.5&lon=-119.8&type=all|weather|news
//
// Returns:
// {
//   weather: { summary, temp, feels_like, high, low, condition, uv_index, description },
//   news:    [ { title, source, summary }, ... ],
//   type:    'all' | 'weather' | 'news'
// }

import { parse as parseCookies } from 'cookie';
import { queryOne } from '../db/client.js';

const NEWSAPI_KEY = process.env.NEWSAPI_KEY;

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Auth
  const cookies = parseCookies(req.headers.cookie ?? '');
  const token   = cookies['ea_session'];
  if (!token) return res.status(401).json({ error: 'No session' });

  const session = await queryOne(
    `SELECT s.is_shell FROM sessions s
     WHERE s.token = ? AND datetime(s.expires_at) > datetime('now')`,
    [token]
  );
  if (!session)         return res.status(401).json({ error: 'Invalid or expired session' });
  if (session.is_shell) return res.status(403).json({ error: 'Not available in restricted mode' });

  const url  = new URL(req.url, `http://${req.headers.host}`);
  const lat  = parseFloat(url.searchParams.get('lat'));
  const lon  = parseFloat(url.searchParams.get('lon'));
  const type = url.searchParams.get('type') || 'all';

  const result = {};

  try {
    if (type === 'all' || type === 'weather') {
      if (!isNaN(lat) && !isNaN(lon)) {
        result.weather = await fetchWeather(lat, lon);
      } else {
        result.weather = await fetchWeather(39.5296, -119.8138); // Reno fallback
      }
    }

    if (type === 'all' || type === 'news') {
      result.news = await fetchNews();
    }

    result.type = type;
    return res.status(200).json(result);

  } catch (err) {
    console.error('[briefing] Error:', err.message);
    return res.status(500).json({ error: 'Briefing fetch failed', detail: err.message });
  }
}

// ---------------------------------------------------------------------------
// Weather — Open-Meteo (free, no key)
// ---------------------------------------------------------------------------
async function fetchWeather(lat, lon) {
  const url = `https://api.open-meteo.com/v1/forecast?` +
    `latitude=${lat}&longitude=${lon}` +
    `&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m,relative_humidity_2m` +
    `&daily=temperature_2m_max,temperature_2m_min,weather_code,uv_index_max,precipitation_probability_max` +
    `&temperature_unit=fahrenheit` +
    `&wind_speed_unit=mph` +
    `&timezone=auto` +
    `&forecast_days=1`;

  const res  = await fetch(url, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(`Open-Meteo error: ${res.status}`);
  const data = await res.json();

  const current = data.current;
  const daily   = data.daily;

  const code        = current.weather_code;
  const condition   = wmoCondition(code);
  const description = wmoDescription(code);

  return {
    temp:          Math.round(current.temperature_2m),
    feels_like:    Math.round(current.apparent_temperature),
    high:          Math.round(daily.temperature_2m_max[0]),
    low:           Math.round(daily.temperature_2m_min[0]),
    humidity:      current.relative_humidity_2m,
    wind:          Math.round(current.wind_speed_10m),
    uv_index:      daily.uv_index_max[0],
    rain_chance:   daily.precipitation_probability_max[0],
    condition,
    description,
    outdoor_good:  isGoodOutdoor(code, daily.uv_index_max[0], daily.precipitation_probability_max[0]),
  };
}

function wmoCondition(code) {
  if (code === 0)                return 'Clear';
  if (code <= 2)                 return 'Partly cloudy';
  if (code === 3)                return 'Overcast';
  if (code <= 49)                return 'Foggy';
  if (code <= 59)                return 'Drizzle';
  if (code <= 69)                return 'Rain';
  if (code <= 79)                return 'Snow';
  if (code <= 82)                return 'Rain showers';
  if (code <= 86)                return 'Snow showers';
  if (code >= 95)                return 'Thunderstorm';
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
  if (code >= 61) return false;  // any rain
  if (rainChance > 40) return false;
  if (uvIndex > 10) return false; // extreme UV
  return true;
}

// ---------------------------------------------------------------------------
// News — NewsAPI
// ---------------------------------------------------------------------------
async function fetchNews() {
  if (!NEWSAPI_KEY) {
    // Fallback to AP RSS if no key
    return fetchAPRSS();
  }

  const url = `https://newsapi.org/v2/top-headlines?country=us&pageSize=5&apiKey=${NEWSAPI_KEY}`;
  const res  = await fetch(url, { signal: AbortSignal.timeout(5000) });

  if (!res.ok) {
    console.warn('[briefing] NewsAPI failed, falling back to AP RSS');
    return fetchAPRSS();
  }

  const data = await res.json();

  return (data.articles || [])
    .filter(a => a.title && a.title !== '[Removed]')
    .slice(0, 3)
    .map(a => ({
      title:  a.title,
      source: a.source?.name || 'News',
      url:    a.url,
    }));
}

async function fetchAPRSS() {
  // AP Top News RSS via public feed
  const res = await fetch('https://feeds.apnews.com/apnews/topstories', {
    signal: AbortSignal.timeout(5000),
    headers: { 'Accept': 'application/rss+xml, application/xml, text/xml' },
  });

  if (!res.ok) return [];

  const xml   = await res.text();
  const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0, 3);

  return items.map(match => {
    const item    = match[1];
    const title   = item.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/)?.[1] ||
                    item.match(/<title>(.*?)<\/title>/)?.[1] || '';
    const link    = item.match(/<link>(.*?)<\/link>/)?.[1] || '';
    return { title: title.trim(), source: 'AP News', url: link.trim() };
  }).filter(i => i.title);
}
