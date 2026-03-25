// POST /api/interest-radar — geocode / reverse / radar (ideas: Claude+web | places: Google Places Text Search).

import { parse as parseCookies } from 'cookie';
import { queryOne } from '../db/client.js';
import { reverseGeocodeLabel } from '../lib/briefing-data.js';
import { forwardGeocode, enrichItemsWithDistance } from '../lib/geocode.js';
import { fetchRadarSuggestions, parseRadarInterests } from '../lib/interest-radar.js';
import { fetchPlacesTextRadar, isPlacesRadarConfigured } from '../lib/places-radar.js';
import { logUserEvent } from '../lib/user-event-log.js';

async function getOwnerSession(req) {
  const cookies = parseCookies(req.headers.cookie ?? '');
  const token = cookies['ea_session'];
  if (!token) return null;
  const session = await queryOne(
    `SELECT s.token, s.owner_id, s.is_shell
     FROM sessions s
     WHERE s.token = ? AND datetime(s.expires_at) > datetime('now')`,
    [token]
  );
  if (!session || session.is_shell === 1) return null;
  return session;
}

function num(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const session = await getOwnerSession(req);
  if (!session) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const body = req.body && typeof req.body === 'object' ? req.body : {};

  try {
    // --- Geocode only (verify address) ---
    if (body.mode === 'geocode') {
      const query = String(body.query || '').trim();
      if (!query) return res.status(400).json({ error: 'query required' });
      const results = await forwardGeocode(query, { limit: 5 });
      return res.status(200).json({ results });
    }

    if (body.mode === 'reverse') {
      const rlat = num(body.lat, NaN);
      const rlon = num(body.lon, NaN);
      if (!Number.isFinite(rlat) || !Number.isFinite(rlon)) {
        return res.status(400).json({ error: 'lat and lon required' });
      }
      const label = await reverseGeocodeLabel(rlat, rlon);
      const location_label = label || `${rlat.toFixed(4)}°, ${rlon.toFixed(4)}°`;
      return res.status(200).json({ lat: rlat, lon: rlon, location_label });
    }

    // --- Full radar ---
    const lat = num(body.lat, NaN);
    const lon = num(body.lon, NaN);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      return res.status(400).json({ error: 'lat and lon required' });
    }

    const location_label = String(body.location_label || '').trim() || `${lat.toFixed(4)}, ${lon.toFixed(4)}`;
    const radius_miles = Math.min(100, Math.max(5, num(body.radius_miles, 25)));
    const range_description = String(body.range_description || '').trim();
    const radar_kind = body.radar_kind === 'places' ? 'places' : 'ideas';

    if (radar_kind === 'ideas' && !range_description) {
      return res.status(400).json({ error: 'range_description required' });
    }

    let interests = parseRadarInterests(String(body.interests || ''));
    if (interests.length === 0) {
      const row = await queryOne(
        `SELECT interest_radar_topics FROM owner_config WHERE id = ?`,
        [session.owner_id]
      );
      interests = parseRadarInterests(row?.interest_radar_topics ?? '');
    }
    if (interests.length === 0) {
      const hint =
        radar_kind === 'places'
          ? 'Describe what to find (e.g. cocktail bar, sushi, museum) in the box or save defaults in Settings → Interest radar.'
          : 'Add at least one interest (in the form or Settings → Interest radar topics).';
      return res.status(400).json({ error: hint });
    }

    const windowKey = String(body.window || 'week').slice(0, 32);

    if (radar_kind === 'places') {
      if (!isPlacesRadarConfigured()) {
        return res.status(503).json({
          error:
            'Find places needs GOOGLE_PLACES_API_KEY on the server. Add it to your deployment environment, or switch to Ideas mode.',
        });
      }

      const openNow = windowKey === 'tonight';
      const textQuery = interests.join(' ');
      const rawItems = await fetchPlacesTextRadar({
        lat,
        lon,
        radiusMiles: radius_miles,
        textQuery,
        openNow,
      });

      const items = await enrichItemsWithDistance(rawItems, {
        lat,
        lon,
        locationLabel: location_label,
      });

      await logUserEvent(
        session.token,
        'ea_interest_radar',
        {
          radar_kind: 'places',
          window: windowKey,
          radius_miles,
          item_count: items.length,
          interest_count: interests.length,
        },
        'success'
      );

      return res.status(200).json({
        version: 1,
        radar_kind: 'places',
        location_label,
        lat,
        lon,
        radius_miles,
        window: windowKey,
        range_description: range_description || `Places near ${location_label}`,
        interests,
        items,
        disclaimer:
          'Results from Google Places. Hours and busy times can change — confirm on Maps or the venue site before you go.',
      });
    }

    const { items: rawItems } = await fetchRadarSuggestions({
      locationLabel: location_label,
      radiusMiles: radius_miles,
      rangeDescription: range_description,
      interests,
    });

    const items = await enrichItemsWithDistance(rawItems, {
      lat,
      lon,
      locationLabel: location_label,
    });

    await logUserEvent(
      session.token,
      'ea_interest_radar',
      {
        radar_kind: 'ideas',
        window: windowKey,
        radius_miles,
        item_count: items.length,
        interest_count: interests.length,
      },
      'success'
    );

    return res.status(200).json({
      version: 1,
      radar_kind: 'ideas',
      location_label,
      lat,
      lon,
      radius_miles,
      window: windowKey,
      range_description,
      interests,
      items,
      disclaimer:
        'Distances are approximate (Photon/Open-Meteo geocoding). Shown for the first 8 results only. Verify times and tickets on the source site.',
    });
  } catch (err) {
    const msg = err?.message || String(err);
    const lower = msg.toLowerCase();
    if (lower.includes('web search') || lower.includes('tool')) {
      return res.status(503).json({
        error:
          'Web search may be disabled for this API key. Enable it in the Anthropic Console (organization settings), then try again.',
        detail: msg,
      });
    }
    return res.status(502).json({ error: 'Interest radar failed', detail: msg });
  }
}
