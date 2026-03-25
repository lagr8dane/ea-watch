// Google Places API (New) — text search biased to a circle around lat/lon.
// Env: GOOGLE_PLACES_API_KEY (Places API enabled for the project).

const PLACES_TEXT = 'https://places.googleapis.com/v1/places:searchText';

export function isPlacesRadarConfigured() {
  return Boolean(String(process.env.GOOGLE_PLACES_API_KEY || '').trim());
}

/**
 * @param {{ lat: number, lon: number, radiusMiles: number, textQuery: string, openNow?: boolean }} p
 * @returns {Promise<{ title: string, summary: string, venue: string, address_hint: string, url: string, venue_lat: number, venue_lon: number, geocode_label: string | null }[]>}
 */
export async function fetchPlacesTextRadar({ lat, lon, radiusMiles, textQuery, openNow = false }) {
  const key = String(process.env.GOOGLE_PLACES_API_KEY || '').trim();
  if (!key) {
    throw new Error('GOOGLE_PLACES_API_KEY is not set');
  }

  const q = String(textQuery || '').trim();
  if (!q) return [];

  const radiusM = Math.min(50000, Math.max(500, Math.round(Number(radiusMiles) * 1609.34)));

  const body = {
    textQuery: q.slice(0, 400),
    locationBias: {
      circle: {
        center: { latitude: lat, longitude: lon },
        radius: radiusM,
      },
    },
    maxResultCount: 15,
  };
  if (openNow) body.openNow = true;

  const res = await fetch(PLACES_TEXT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': key,
      'X-Goog-FieldMask':
        'places.id,places.displayName,places.formattedAddress,places.rating,places.userRatingCount,places.websiteUri,places.googleMapsUri,places.location,places.primaryTypeDisplayName,places.editorialSummary',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(12000),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Places API ${res.status}${errText ? `: ${errText.slice(0, 200)}` : ''}`);
  }

  const data = await res.json();
  const places = data.places || [];

  return places.map((p) => {
    const name = p.displayName?.text || p.displayName || 'Place';
    const addr = p.formattedAddress || '';
    const typeLabel = p.primaryTypeDisplayName?.text || '';
    const ed = p.editorialSummary?.text || '';
    const rating = typeof p.rating === 'number' ? p.rating : null;
    const nrev = typeof p.userRatingCount === 'number' ? p.userRatingCount : null;
    const parts = [];
    if (rating != null) parts.push(`${rating.toFixed(1)}★${nrev != null ? ` (${nrev} reviews)` : ''}`);
    if (typeLabel) parts.push(typeLabel);
    if (addr) parts.push(addr);
    const summary = ed || parts.filter(Boolean).join(' · ') || addr;

    const plat = p.location?.latitude;
    const plon = p.location?.longitude;
    const url = (p.websiteUri || p.googleMapsUri || '').trim() || 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(name + (addr ? ` ${addr}` : ''));

    return {
      title: String(name).slice(0, 200),
      summary: String(summary).slice(0, 400),
      venue: String(name).slice(0, 200),
      address_hint: String(addr).slice(0, 200),
      url,
      venue_lat: Number(plat),
      venue_lon: Number(plon),
      geocode_label: addr || null,
    };
  }).filter((it) => Number.isFinite(it.venue_lat) && Number.isFinite(it.venue_lon));
}
