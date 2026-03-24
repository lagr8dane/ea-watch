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
import { fetchWeatherSnapshot, fetchNewsStories } from '../lib/briefing-data.js';

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
      const la = !isNaN(lat) && !isNaN(lon) ? lat : 39.5296;
      const lo = !isNaN(lat) && !isNaN(lon) ? lon : -119.8138;
      result.weather = await fetchWeatherSnapshot(la, lo);
    }

    if (type === 'all' || type === 'news') {
      const { items } = await fetchNewsStories({ page: 1, pageSize: 5, interests: [] });
      result.news = items;
    }

    result.type = type;
    return res.status(200).json(result);

  } catch (err) {
    console.error('[briefing] Error:', err.message);
    return res.status(500).json({ error: 'Briefing fetch failed', detail: err.message });
  }
}
