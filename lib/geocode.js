// Address verify: Nominatim. Venue distances: Open-Meteo geocoding (reliable from cloud IPs; Nominatim often throttles Vercel).

const UA = 'ea-watch/1.0 (https://github.com/lagr8dane/ea-watch)';

/**
 * Open-Meteo geocoding — OK for many serverless requests (no API key).
 * @param {string} query
 * @param {{ limit?: number }} [opts]
 * @returns {Promise<{ lat: number, lon: number, display_name: string }[]>}
 */
export async function forwardGeocodeOpenMeteo(query, { limit = 5 } = {}) {
  const q = String(query || '').trim();
  if (!q) return [];

  const u = new URL('https://geocoding-api.open-meteo.com/v1/search');
  u.searchParams.set('name', q.slice(0, 256));
  u.searchParams.set('count', String(Math.min(10, Math.max(1, limit))));
  u.searchParams.set('language', 'en');
  u.searchParams.set('format', 'json');

  const res = await fetch(u.toString(), { signal: AbortSignal.timeout(8000) });
  if (!res.ok) return [];
  const data = await res.json();
  const arr = data.results || [];
  return arr
    .map((r) => {
      const parts = [r.name, r.admin2 || r.admin3, r.admin1, r.country].filter(Boolean);
      return {
        lat: r.latitude,
        lon: r.longitude,
        display_name: parts.length ? parts.join(', ') : r.name || q,
      };
    })
    .filter((r) => Number.isFinite(r.lat) && Number.isFinite(r.lon));
}

/**
 * @param {string} query
 * @param {{ limit?: number }} [opts]
 * @returns {Promise<{ lat: number, lon: number, display_name: string }[]>}
 */
export async function forwardGeocode(query, { limit = 5 } = {}) {
  const q = String(query || '').trim();
  if (!q) return [];

  const u = new URL('https://nominatim.openstreetmap.org/search');
  u.searchParams.set('q', q);
  u.searchParams.set('format', 'json');
  u.searchParams.set('limit', String(Math.min(10, Math.max(1, limit))));

  const res = await fetch(u.toString(), {
    headers: { 'User-Agent': UA },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`Geocode HTTP ${res.status}`);
  const arr = await res.json();
  return (arr || [])
    .map((r) => ({
      lat: parseFloat(r.lat),
      lon: parseFloat(r.lon),
      display_name: r.display_name,
    }))
    .filter((r) => !Number.isNaN(r.lat) && !Number.isNaN(r.lon));
}

/**
 * Best single hit for venue/area strings (radar distances). Open-Meteo first, Nominatim fallback.
 * @param {string} query
 * @returns {Promise<{ lat: number, lon: number, display_name: string } | null>}
 */
export async function geocodeFirst(query) {
  const om = await forwardGeocodeOpenMeteo(query, { limit: 1 });
  if (om[0]) return om[0];
  try {
    const rows = await forwardGeocode(query, { limit: 1 });
    return rows[0] || null;
  } catch {
    return null;
  }
}

/** Great-circle distance in miles (WGS84 sphere). */
export function haversineMiles(lat1, lon1, lat2, lon2) {
  const toRad = (d) => (d * Math.PI) / 180;
  const R = 3958.7613;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Geocode each item for distance; try several query shapes (venues often need city context).
 * Open-Meteo allows parallel calls at modest volume — faster than serial Nominatim.
 * @param {object[]} items
 * @param {{ lat: number, lon: number, locationLabel: string }} origin
 */
export async function enrichItemsWithDistance(items, origin) {
  const { lat: oLat, lon: oLon, locationLabel } = origin;
  const cityHint = String(locationLabel || '')
    .split(',')
    .slice(0, 3)
    .join(',')
    .trim();

  async function bestHitForItem(it) {
    const title = typeof it.title === 'string' ? it.title.trim() : '';
    const venue = it.venue != null ? String(it.venue).trim() : '';
    const hint = it.address_hint != null ? String(it.address_hint).trim() : '';

    const candidates = [];
    const push = (s) => {
      const t = String(s || '').trim();
      if (t.length >= 3) candidates.push(t);
    };
    push([venue, hint, cityHint].filter(Boolean).join(', '));
    push([venue, cityHint].filter(Boolean).join(', '));
    push([hint, cityHint].filter(Boolean).join(', '));
    push([title, cityHint].filter(Boolean).join(', '));
    const seen = new Set();
    const unique = candidates.filter((c) => (seen.has(c) ? false : (seen.add(c), true)));

    for (const q of unique) {
      const hit = await geocodeFirst(q);
      if (hit) return hit;
    }
    return null;
  }

  const hits = await Promise.all(items.map((it) => bestHitForItem(it)));

  const out = items.map((it, i) => {
    const hit = hits[i];
    let distance_mi = null;
    if (hit && Number.isFinite(hit.lat) && Number.isFinite(hit.lon)) {
      distance_mi = Math.round(haversineMiles(oLat, oLon, hit.lat, hit.lon) * 10) / 10;
    }
    return {
      ...it,
      distance_mi,
      venue_lat: hit?.lat ?? null,
      venue_lon: hit?.lon ?? null,
      geocode_label: hit?.display_name ?? null,
    };
  });

  out.sort((a, b) => {
    if (a.distance_mi == null && b.distance_mi == null) return 0;
    if (a.distance_mi == null) return 1;
    if (b.distance_mi == null) return -1;
    return a.distance_mi - b.distance_mi;
  });
  return out;
}
