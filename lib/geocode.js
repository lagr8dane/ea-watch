// Nominatim forward search + distance helpers for interest radar.

const UA = 'ea-watch/1.0 (https://github.com/lagr8dane/ea-watch)';

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
 * @param {string} query
 * @returns {Promise<{ lat: number, lon: number, display_name: string } | null>}
 */
export async function geocodeFirst(query) {
  const rows = await forwardGeocode(query, { limit: 1 });
  return rows[0] || null;
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

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Nominatim usage: ~1 req/s — space calls when enriching a list.
 * @param {object[]} items
 * @param {{ lat: number, lon: number, locationLabel: string }} origin
 */
export async function enrichItemsWithDistance(items, origin) {
  const { lat: oLat, lon: oLon, locationLabel } = origin;
  const cityHint = String(locationLabel || '')
    .split(',')
    .slice(0, 2)
    .join(',')
    .trim();

  const out = [];
  for (let i = 0; i < items.length; i++) {
    if (i > 0) await sleep(1100);
    const it = items[i];
    const parts = [it.venue, it.address_hint, cityHint].filter(Boolean);
    const q = parts.join(' ').trim();
    let venueLat = null;
    let venueLon = null;
    let geocode_label = null;

    if (q.length >= 3) {
      try {
        const hit = await geocodeFirst(q);
        if (hit) {
          venueLat = hit.lat;
          venueLon = hit.lon;
          geocode_label = hit.display_name;
        }
      } catch {
        /* leave coords null */
      }
    }

    let distance_mi = null;
    if (venueLat != null && venueLon != null) {
      distance_mi = Math.round(haversineMiles(oLat, oLon, venueLat, venueLon) * 10) / 10;
    }

    out.push({
      ...it,
      distance_mi,
      venue_lat: venueLat,
      venue_lon: venueLon,
      geocode_label,
    });
  }

  out.sort((a, b) => {
    if (a.distance_mi == null && b.distance_mi == null) return 0;
    if (a.distance_mi == null) return 1;
    if (b.distance_mi == null) return -1;
    return a.distance_mi - b.distance_mi;
  });
  return out;
}
