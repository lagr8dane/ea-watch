// Shared weather + news fetchers for EA briefings (api/ea.js, api/morning-briefing.js).

const RENO = { lat: 39.5296, lon: -119.8138 };

export function parseBriefingInterests(raw) {
  if (!raw || typeof raw !== 'string') return [];
  const parts = raw.split(/[\n,]+/).map(s => s.trim()).filter(Boolean);
  return [...new Set(parts)].slice(0, 5);
}

export function parseBriefingTickers(raw) {
  if (!raw || typeof raw !== 'string') return [];
  const parts = raw
    .split(/[\n,]+/)
    .map(s => s.trim().toUpperCase())
    .filter(s => /^[A-Z][A-Z0-9.]{0,7}$/.test(s));
  return [...new Set(parts)].slice(0, 12);
}

export async function fetchWeatherSnapshot(lat, lon) {
  const la = lat != null && !Number.isNaN(Number(lat)) ? Number(lat) : RENO.lat;
  const lo = lon != null && !Number.isNaN(Number(lon)) ? Number(lon) : RENO.lon;

  const url = `https://api.open-meteo.com/v1/forecast?` +
    `latitude=${la}&longitude=${lo}` +
    `&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m,relative_humidity_2m` +
    `&daily=temperature_2m_max,temperature_2m_min,weather_code,uv_index_max,precipitation_probability_max` +
    `&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=auto&forecast_days=1`;

  const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(`Open-Meteo ${res.status}`);
  const data = await res.json();

  const current = data.current;
  const daily = data.daily;
  const code = current.weather_code;

  return {
    temp: Math.round(current.temperature_2m),
    feels_like: Math.round(current.apparent_temperature),
    high: Math.round(daily.temperature_2m_max[0]),
    low: Math.round(daily.temperature_2m_min[0]),
    humidity: current.relative_humidity_2m,
    wind: Math.round(current.wind_speed_10m),
    uv_index: daily.uv_index_max[0],
    rain_chance: daily.precipitation_probability_max[0],
    condition: wmoCondition(code),
    description: wmoDescription(code),
    outdoor_good: isGoodOutdoor(code, daily.uv_index_max[0], daily.precipitation_probability_max[0]),
  };
}

/**
 * @param {{ page?: number, pageSize?: number, interests?: string[] }} opts
 */
export async function fetchNewsStories({ page = 1, pageSize = 5, interests = [] } = {}) {
  const NEWSAPI_KEY = process.env.NEWSAPI_KEY;
  const safePage = Math.min(Math.max(1, page), 10);
  const safeSize = Math.min(Math.max(1, pageSize), 15);

  if (NEWSAPI_KEY) {
    try {
      if (interests.length > 0) {
        const q = interests.slice(0, 3).join(' OR ').slice(0, 400);
        const url =
          `https://newsapi.org/v2/everything?q=${encodeURIComponent(q)}` +
          `&sortBy=publishedAt&language=en&page=${safePage}&pageSize=${safeSize}&apiKey=${NEWSAPI_KEY}`;
        const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
        if (res.ok) {
          const data = await res.json();
          const articles = (data.articles || [])
            .filter(a => a.title && a.title !== '[Removed]')
            .map(a => ({
              title: a.title,
              source: a.source?.name || 'News',
              url: a.url || null,
            }));
          if (articles.length > 0) {
            return {
              items: articles,
              has_more: articles.length >= safeSize,
              source: 'newsapi_everything',
            };
          }
        }
      }

      const url =
        `https://newsapi.org/v2/top-headlines?country=us&page=${safePage}` +
        `&pageSize=${safeSize}&apiKey=${NEWSAPI_KEY}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if (res.ok) {
        const data = await res.json();
        const articles = (data.articles || [])
          .filter(a => a.title && a.title !== '[Removed]')
          .map(a => ({
            title: a.title,
            source: a.source?.name || 'News',
            url: a.url || null,
          }));
        return {
          items: articles,
          has_more: articles.length >= safeSize && safePage < 10,
          source: 'newsapi_top',
        };
      }
    } catch {
      /* fall through */
    }
  }

  if (safePage > 1) {
    return { items: [], has_more: false, source: 'rss' };
  }

  const res = await fetch('https://feeds.apnews.com/apnews/topstories', {
    signal: AbortSignal.timeout(5000),
    headers: { Accept: 'application/rss+xml, text/xml' },
  });
  if (!res.ok) return { items: [], has_more: false, source: 'rss' };
  const xml = await res.text();
  const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0, safeSize);
  const articles = items.map(m => {
    const item = m[1];
    const title =
      item.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/)?.[1] ||
      item.match(/<title>(.*?)<\/title>/)?.[1] ||
      '';
    const link = item.match(/<link>(.*?)<\/link>/)?.[1] || '';
    return { title: title.trim(), source: 'AP News', url: link.trim() || null };
  }).filter(i => i.title);

  return { items: articles, has_more: false, source: 'rss' };
}

export function wmoCondition(code) {
  if (code === 0) return 'Clear';
  if (code <= 2) return 'Partly cloudy';
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

export function wmoDescription(code) {
  if (code === 0) return 'clear skies';
  if (code === 1) return 'mainly clear';
  if (code === 2) return 'partly cloudy';
  if (code === 3) return 'overcast';
  if (code >= 45 && code <= 48) return 'foggy';
  if (code >= 51 && code <= 55) return 'light drizzle';
  if (code >= 61 && code <= 63) return 'light to moderate rain';
  if (code === 65) return 'heavy rain';
  if (code >= 71 && code <= 75) return 'snow';
  if (code >= 80 && code <= 82) return 'rain showers';
  if (code >= 95) return 'thunderstorms';
  return 'mixed conditions';
}

export function isGoodOutdoor(code, uvIndex, rainChance) {
  if (code >= 61) return false;
  if (rainChance > 40) return false;
  if (uvIndex > 10) return false;
  return true;
}

export function googleNewsSearchUrl(query) {
  const q = query || 'Top stories';
  return `https://news.google.com/search?q=${encodeURIComponent(q)}&hl=en&gl=US&ceid=US:en`;
}
