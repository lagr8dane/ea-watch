// Address verify: Nominatim. Radar distances: Photon + Open-Meteo (fast, works from cloud); Nominatim last resort.

const UA = 'ea-watch/1.0 (https://github.com/lagr8dane/ea-watch)';

/** ~km per degree latitude */
const KM_PER_DEG_LAT = 111;

/**
 * Photon (Komoot) — good free-text / POI search, no API key.
 * Optional bbox bias around anchor improves NYC-style matches.
 * @param {string} query
 * @param {{ limit?: number, biasLat?: number, biasLon?: number, biasKm?: number }} [opts]
 * @returns {Promise<{ lat: number, lon: number, display_name: string }[]>}
 */
export async function forwardPhoton(query, { limit = 3, biasLat, biasLon, biasKm = 45 } = {}) {
  const q = String(query || '').trim();
  if (!q) return [];

  const u = new URL('https://photon.komoot.io/api/');
  u.searchParams.set('q', q.slice(0, 300));
  u.searchParams.set('limit', String(Math.min(8, Math.max(1, limit))));

  if (Number.isFinite(biasLat) && Number.isFinite(biasLon)) {
    const dLat = biasKm / KM_PER_DEG_LAT;
    const dLon = biasKm / (KM_PER_DEG_LAT * Math.max(0.2, Math.cos((biasLat * Math.PI) / 180)));
    u.searchParams.set(
      'bbox',
      `${biasLon - dLon},${biasLat - dLat},${biasLon + dLon},${biasLat + dLat}`
    );
  }

  const res = await fetch(u.toString(), { signal: AbortSignal.timeout(4500) });
  if (!res.ok) return [];
  const data = await res.json();
  const feats = data.features || [];
  return feats
    .map((f) => {
      const c = f.geometry?.coordinates;
      if (!c || c.length < 2) return null;
      const lon = Number(c[0]);
      const lat = Number(c[1]);
      const p = f.properties || {};
      const label = [p.name, p.street, p.city, p.state, p.country].filter(Boolean).join(', ');
      return {
        lat,
        lon,
        display_name: label || p.name || q,
      };
    })
    .filter((r) => r && Number.isFinite(r.lat) && Number.isFinite(r.lon));
}

/**
 * Open-Meteo geocoding — no API key.
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

  const res = await fetch(u.toString(), { signal: AbortSignal.timeout(4500) });
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
    signal: AbortSignal.timeout(6000),
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
 * One query: Photon + Open-Meteo in parallel (first hit wins).
 * @param {string} query
 * @param {{ biasLat?: number, biasLon?: number }} [bias]
 */
export async function geocodeQuick(query, bias = {}) {
  const q = String(query || '').trim();
  if (q.length < 3) return null;

  const photonP = forwardPhoton(q, { limit: 1, ...bias });
  const meteoP = forwardGeocodeOpenMeteo(q, { limit: 1 });
  const [ph, om] = await Promise.all([photonP, meteoP]);
  if (ph[0]) return ph[0];
  if (om[0]) return om[0];
  return null;
}

/**
 * Best single hit for venue strings (radar). Parallel providers; optional Nominatim fallback.
 */
export async function geocodeFirst(query, bias = {}) {
  const hit = await geocodeQuick(query, bias);
  if (hit) return hit;
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

const MAX_GEOCODE_ITEMS = 8;

/**
 * Geocode up to MAX_GEOCODE_ITEMS for distance (keeps Vercel fast). Rest stay "unknown".
 * @param {object[]} items
 * @param {{ lat: number, lon: number, locationLabel: string }} origin
 */
export async function enrichItemsWithDistance(items, origin) {
  const { lat: oLat, lon: oLon, locationLabel } = origin;
  const cityHint = String(locationLabel || '')
    .split(',')
    .slice(0, 4)
    .join(',')
    .trim();

  const bias = { biasLat: oLat, biasLon: oLon, biasKm: 55 };

  async function bestHitForItem(it) {
    const title = typeof it.title === 'string' ? it.title.trim() : '';
    const venue = it.venue != null ? String(it.venue).trim() : '';
    const hint = it.address_hint != null ? String(it.address_hint).trim() : '';

    const attempts = [];
    if (hint.length >= 6) attempts.push([hint, cityHint].filter(Boolean).join(', '));
    if (venue && cityHint) attempts.push(`${venue}, ${cityHint}`);
    if (hint && cityHint && !attempts.some((a) => a.includes(hint))) attempts.push(`${hint}, ${cityHint}`);
    if (title && cityHint) attempts.push(`${title}, ${cityHint}`);

    const seen = new Set();
    const unique = attempts.filter((c) => {
      const t = c.trim();
      if (t.length < 4 || seen.has(t)) return false;
      seen.add(t);
      return true;
    });

    for (const q of unique.slice(0, 3)) {
      const hit = await geocodeQuick(q, bias);
      if (hit) return hit;
    }
    return null;
  }

  const toGeocode = items.slice(0, MAX_GEOCODE_ITEMS);
  const hits = await Promise.all(toGeocode.map((it) => bestHitForItem(it)));

  const enriched = items.map((it, i) => {
    let hit = null;
    if (i < MAX_GEOCODE_ITEMS) hit = hits[i];

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

  enriched.sort((a, b) => {
    if (a.distance_mi == null && b.distance_mi == null) return 0;
    if (a.distance_mi == null) return 1;
    if (b.distance_mi == null) return -1;
    return a.distance_mi - b.distance_mi;
  });
  return enriched;
}
