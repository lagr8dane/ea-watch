// Spotify Web API — OAuth token storage, refresh, search, playback.
import { queryOne, execute } from '../db/client.js';

const AUTH_URL = 'https://accounts.spotify.com/authorize';
const TOKEN_URL = 'https://accounts.spotify.com/api/token';
const API_BASE = 'https://api.spotify.com/v1';

export const SPOTIFY_SCOPES = [
  'user-read-playback-state',
  'user-modify-playback-state',
  'user-read-currently-playing',
].join(' ');

export function spotifyConfigured() {
  return Boolean(
    String(process.env.SPOTIFY_CLIENT_ID || '').trim() &&
      String(process.env.SPOTIFY_CLIENT_SECRET || '').trim()
  );
}

/** Base URL for redirects (OAuth callback). Must match Spotify Dashboard; use production HTTPS for Spotify. */
export function getAppBaseUrl() {
  const u = String(process.env.APP_URL || '').trim().replace(/\/$/, '');
  return u || 'http://localhost:3000';
}

export function getSpotifyRedirectUri() {
  return `${getAppBaseUrl()}/api/spotify/callback`;
}

export function buildAuthorizeUrl(state) {
  const params = new URLSearchParams({
    client_id: process.env.SPOTIFY_CLIENT_ID,
    response_type: 'code',
    redirect_uri: getSpotifyRedirectUri(),
    scope: SPOTIFY_SCOPES,
    state,
    show_dialog: 'false',
  });
  return `${AUTH_URL}?${params.toString()}`;
}

export async function exchangeCodeForTokens(code) {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: getSpotifyRedirectUri(),
  });
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization:
        'Basic ' +
        Buffer.from(
          `${process.env.SPOTIFY_CLIENT_ID}:${process.env.SPOTIFY_CLIENT_SECRET}`
        ).toString('base64'),
    },
    body,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error_description || data.error || `token exchange ${res.status}`);
  }
  return data;
}

export async function refreshAccessToken(refreshToken) {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  });
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization:
        'Basic ' +
        Buffer.from(
          `${process.env.SPOTIFY_CLIENT_ID}:${process.env.SPOTIFY_CLIENT_SECRET}`
        ).toString('base64'),
    },
    body,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error_description || data.error || `refresh ${res.status}`);
  }
  return data;
}

/**
 * Persist tokens after OAuth or refresh. Spotify may return a new refresh_token.
 */
export async function saveSpotifyTokens(ownerId, tokenPayload) {
  const {
    access_token,
    refresh_token,
    expires_in,
  } = tokenPayload;
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = expires_in ? now + Number(expires_in) : null;

  const row = await queryOne(
    `SELECT spotify_refresh_token FROM owner_config WHERE id = ?`,
    [ownerId]
  );
  const refresh = refresh_token || row?.spotify_refresh_token;
  if (!refresh) {
    throw new Error('No refresh token to store');
  }

  await execute(
    `UPDATE owner_config SET
       spotify_refresh_token = ?,
       spotify_access_token = ?,
       spotify_token_expires_at = ?,
       updated_at = datetime('now')
     WHERE id = ?`,
    [refresh, access_token || null, expiresAt, ownerId]
  );
}

export async function clearSpotifyTokens(ownerId) {
  await execute(
    `UPDATE owner_config SET
       spotify_refresh_token = NULL,
       spotify_access_token = NULL,
       spotify_token_expires_at = NULL,
       updated_at = datetime('now')
     WHERE id = ?`,
    [ownerId]
  );
}

export async function getValidAccessToken(ownerId) {
  const row = await queryOne(
    `SELECT spotify_refresh_token, spotify_access_token, spotify_token_expires_at
     FROM owner_config WHERE id = ?`,
    [ownerId]
  );
  if (!row?.spotify_refresh_token) return null;

  const now = Math.floor(Date.now() / 1000);
  const exp = row.spotify_token_expires_at != null ? Number(row.spotify_token_expires_at) : 0;
  if (row.spotify_access_token && exp > now + 60) {
    return row.spotify_access_token;
  }

  const data = await refreshAccessToken(row.spotify_refresh_token);
  await saveSpotifyTokens(ownerId, {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_in: data.expires_in,
  });
  return data.access_token;
}

async function api(accessToken, path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  return { res, json, text };
}

/**
 * Search tracks and playlists; prefer first track, else first playlist.
 */
export async function searchPlayable(accessToken, query) {
  const q = encodeURIComponent(String(query || '').trim());
  if (!q) return { kind: null, uri: null, name: null };
  const { res, json } = await api(
    accessToken,
    `/search?q=${q}&type=track,playlist&limit=10`
  );
  if (!res.ok) {
    const msg = json?.error?.message || `search failed (${res.status})`;
    throw new Error(msg);
  }
  const tracks = json?.tracks?.items || [];
  const playlists = json?.playlists?.items || [];
  if (tracks.length > 0) {
    const t = tracks[0];
    return {
      kind: 'track',
      uri: t.uri,
      name: t.name,
      openUrl: t.external_urls?.spotify || null,
    };
  }
  if (playlists.length > 0) {
    const p = playlists[0];
    return {
      kind: 'playlist',
      uri: p.uri,
      name: p.name,
      openUrl: p.external_urls?.spotify || null,
    };
  }
  return { kind: null, uri: null, name: null, openUrl: null };
}

/** Spotify `/recommendations` genre slugs differ from speech; map common phrases. */
const STYLE_QUERY_ALIASES = {
  'hip hop': 'hip-hop',
  'hip-hop': 'hip-hop',
  'rap': 'hip-hop',
  'r&b': 'r-n-b',
  'r and b': 'r-n-b',
  'rnb': 'r-n-b',
  'edm': 'edm',
  'electronic dance': 'edm',
  'dance music': 'dance',
  'rock and roll': 'rock-n-roll',
  'drum and bass': 'drum-and-bass',
  'drum n bass': 'drum-and-bass',
  'dnb': 'drum-and-bass',
};

let genreSeedsCache;

function normalizeStyleQuery(q) {
  return String(q || '')
    .trim()
    .toLowerCase()
    .replace(/^some\s+/, '')
    .replace(/^something\s+/, '')
    .replace(/^a\s+little\s+/, '')
    .replace(/\s+music\s*$/, '')
    .replace(/\s+stuff\s*$/, '')
    .trim();
}

function mapQueryToGenreSeed(normalized, seedSet) {
  if (!normalized || !(seedSet instanceof Set) || seedSet.size === 0) return null;
  if (seedSet.has(normalized)) return normalized;
  const fromAlias = STYLE_QUERY_ALIASES[normalized];
  if (fromAlias && seedSet.has(fromAlias)) return fromAlias;
  const hyphenated = normalized.replace(/\s+/g, '-');
  if (seedSet.has(hyphenated)) return hyphenated;
  return null;
}

/**
 * Cached list of allowed `seed_genres` values (from Spotify).
 * @returns {Promise<Set<string>|null>}
 */
export async function fetchAvailableGenreSeeds(accessToken) {
  if (genreSeedsCache !== undefined) return genreSeedsCache;
  const { res, json } = await api(accessToken, '/recommendations/available-genre-seeds');
  if (!res.ok || !Array.isArray(json?.genres) || json.genres.length === 0) {
    genreSeedsCache = null;
    return null;
  }
  genreSeedsCache = new Set(json.genres.map((g) => String(g).toLowerCase()));
  return genreSeedsCache;
}

async function recommendationsFirstTrack(accessToken, seedGenre) {
  const params = new URLSearchParams({
    seed_genres: seedGenre,
    limit: '15',
  });
  const { res, json } = await api(accessToken, `/recommendations?${params.toString()}`);
  if (!res.ok) return null;
  const tracks = json?.tracks || [];
  const t = tracks[0];
  if (!t?.uri) return null;
  return {
    kind: 'track',
    uri: t.uri,
    name: t.name,
    openUrl: t.external_urls?.spotify || null,
    source: 'genre',
    genreSeed: seedGenre,
  };
}

/**
 * Resolve something to play: if the query matches a Spotify genre seed, use Recommendations;
 * otherwise search tracks/playlists (existing behavior).
 */
export async function resolvePlayable(accessToken, query) {
  const q = String(query || '').trim();
  if (!q) return { kind: null, uri: null, name: null, openUrl: null };

  const seeds = await fetchAvailableGenreSeeds(accessToken);
  const normalized = normalizeStyleQuery(q);
  const seed = mapQueryToGenreSeed(normalized, seeds);
  if (seed) {
    const rec = await recommendationsFirstTrack(accessToken, seed);
    if (rec) return rec;
  }
  return searchPlayable(accessToken, q);
}

/** @returns {Promise<{ id: string, name?: string, type?: string, is_active?: boolean }[]>} */
export async function listDevices(accessToken) {
  const { res, json } = await api(accessToken, '/me/player/devices');
  if (!res.ok) return [];
  return Array.isArray(json?.devices) ? json.devices : [];
}

/**
 * Current playback / active device (GET /me/player).
 * 204 = nothing playing; 200 = may include `device` Spotify considers active for this user.
 */
export async function getPlayerState(accessToken) {
  const { res, json } = await api(accessToken, '/me/player');
  if (res.status === 204) return null;
  if (!res.ok) return null;
  return json && typeof json === 'object' ? json : null;
}

/**
 * Pick a device for playback when Spotify has no "active" device (common on iOS).
 * Prefers already-active, then Smartphone, then Speaker, Computer, else first allowed.
 */
export function pickPlaybackDeviceId(devices) {
  const list = (devices || []).filter((x) => x?.id && !x.is_restricted);
  if (!list.length) return null;
  const active = list.find((x) => x.is_active);
  if (active) return active.id;
  const typeRank = ['smartphone', 'speaker', 'tablet', 'computer', 'tv', 'car', 'avr'];
  for (const t of typeRank) {
    const hit = list.find((x) => String(x.type || '').toLowerCase() === t);
    if (hit) return hit.id;
  }
  return list[0].id;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Tell Spotify which device should receive playback (helps iPhone before play). */
async function transferPlayback(accessToken, deviceId) {
  const { res } = await api(accessToken, '/me/player', {
    method: 'PUT',
    body: JSON.stringify({ device_ids: [deviceId], play: false }),
  });
  return res.status === 204 || res.status === 202;
}

async function collectDevices(accessToken) {
  let list = await listDevices(accessToken);
  if (list.length === 0) {
    await sleep(350);
    list = await listDevices(accessToken);
  }
  return list;
}

/**
 * Start playback. Premium required.
 * Tries GET /me/player device first, then explicit devices from /me/player/devices, then implicit active.
 * On failure returns `detail` for logs only (not shown to users).
 */
export async function startPlayback(accessToken, { trackUri, playlistUri, contextUri }) {
  const ctx = contextUri ?? playlistUri;
  const body = trackUri
    ? JSON.stringify({ uris: [trackUri] })
    : JSON.stringify({ context_uri: ctx });

  async function playOn(deviceId) {
    const q = deviceId ? `?device_id=${encodeURIComponent(deviceId)}` : '';
    return api(accessToken, `/me/player/play${q}`, {
      method: 'PUT',
      body,
    });
  }

  let res;
  let json;

  const playerState = await getPlayerState(accessToken);
  const playerDeviceId =
    playerState?.device?.id && !playerState.device.is_restricted ? playerState.device.id : null;
  if (playerDeviceId) {
    ({ res, json } = await playOn(playerDeviceId));
    if (res.status === 204) return { ok: true };
    await transferPlayback(accessToken, playerDeviceId);
    await sleep(500);
    ({ res, json } = await playOn(playerDeviceId));
    if (res.status === 204) return { ok: true };
  }

  const devices = await collectDevices(accessToken);
  const picked = pickPlaybackDeviceId(devices);

  if (picked) {
    ({ res, json } = await playOn(picked));
    if (res.status === 204) return { ok: true };

    await transferPlayback(accessToken, picked);
    await sleep(750);
    ({ res, json } = await playOn(picked));
    if (res.status === 204) return { ok: true };
    await sleep(400);
    ({ res, json } = await playOn(picked));
    if (res.status === 204) return { ok: true };
  }

  ({ res, json } = await playOn(null));
  if (res.status === 204) return { ok: true };

  if (res.status === 404 && picked) {
    await transferPlayback(accessToken, picked);
    await sleep(750);
    ({ res, json } = await playOn(picked));
    if (res.status === 204) return { ok: true };
  }

  if (res.status === 404) {
    const again = await listDevices(accessToken);
    const id2 = pickPlaybackDeviceId(again);
    if (id2 && id2 !== picked) {
      await transferPlayback(accessToken, id2);
      await sleep(750);
      ({ res, json } = await playOn(id2));
      if (res.status === 204) return { ok: true };
    }
  }

  if (res.status === 404) {
    return {
      ok: false,
      code: 'NO_DEVICE',
      detail: json?.error?.message || '404',
    };
  }
  if (res.status === 403) {
    return { ok: false, code: 'PREMIUM', detail: json?.error?.message || '403' };
  }
  return {
    ok: false,
    code: 'ERROR',
    detail: json?.error?.message || String(res.status),
  };
}

/** Prefer native Spotify app (spotify:) over https://open.spotify.com in Safari. */
export function spotifyOpenUrl(found) {
  if (found?.uri && String(found.uri).startsWith('spotify:')) return found.uri;
  return found?.openUrl || null;
}

/**
 * Parse a stored routine URI (spotify:… or open.spotify.com link) for Web API playback.
 * @returns {{ kind: 'track'|'playlist'|'album', uri: string, name: string, openUrl?: string|null } | null}
 */
export function playableFromStoredSpotifyUri(raw) {
  const u = String(raw || '').trim();
  if (!u) return null;
  if (u.startsWith('spotify:')) {
    const parts = u.split(':');
    if (parts.length >= 3 && parts[1] === 'track') {
      return { kind: 'track', uri: u, name: 'Spotify track', openUrl: null };
    }
    if (parts.length >= 3 && parts[1] === 'playlist') {
      return { kind: 'playlist', uri: u, name: 'Spotify playlist', openUrl: null };
    }
    if (parts.length >= 3 && parts[1] === 'album') {
      return { kind: 'album', uri: u, name: 'Spotify album', openUrl: null };
    }
    return null;
  }
  const m = u.match(/open\.spotify\.com\/(track|playlist|album)\/([a-zA-Z0-9]+)/);
  if (m) {
    const kind = m[1];
    const uri = `spotify:${kind}:${m[2]}`;
    if (kind === 'track') {
      return { kind: 'track', uri, name: 'Spotify track', openUrl: u };
    }
    if (kind === 'playlist') {
      return { kind: 'playlist', uri, name: 'Spotify playlist', openUrl: u };
    }
    return { kind: 'album', uri, name: 'Spotify album', openUrl: u };
  }
  return null;
}

/**
 * Routine / chain step: same resolution + remote play as EA chat "play …".
 * @param {string} ownerId
 * @param {{ query?: string, uri?: string, message?: string }} config
 * @returns {Promise<{ message: string, actions: object[], error?: string }>}
 */
export async function runSpotifyChainStep(ownerId, config) {
  const custom = String(config?.message || '').trim();
  if (!spotifyConfigured()) {
    const msg = 'Spotify is not configured on this server.';
    return { error: msg, message: msg, actions: [] };
  }

  let access;
  try {
    access = await getValidAccessToken(ownerId);
  } catch {
    access = null;
  }
  if (!access) {
    const loginUrl = `${getAppBaseUrl()}/api/spotify/login`;
    return {
      message:
        custom ||
        'Spotify is not connected for this account. Connect in Settings, then run this routine again.',
      actions: [{ type: 'deeplink', url: loginUrl, pillClass: 'action-pill-spotify' }],
    };
  }

  const q = String(config?.query || '').trim();
  const uriRaw = String(config?.uri || '').trim();

  let found = null;
  if (q) {
    try {
      found = await resolvePlayable(access, q);
    } catch (e) {
      const msg = e?.message || 'Spotify search failed';
      return { error: msg, message: msg, actions: [] };
    }
  } else if (uriRaw) {
    found = playableFromStoredSpotifyUri(uriRaw);
    if (!found) {
      const msg =
        'Invalid Spotify link. Use a track, playlist, or album URI or URL, or set a play query.';
      return { error: msg, message: msg, actions: [] };
    }
  } else {
    const msg = 'Spotify step needs a play query (same as chat) or a Spotify URI.';
    return { error: msg, message: msg, actions: [] };
  }

  if (!found?.uri) {
    const hint = q || uriRaw;
    return {
      message: custom || `No track or playlist matched "${hint}". Try different words or a Spotify link.`,
      actions: [],
    };
  }

  const playResult = await startPlayback(access, {
    trackUri: found.kind === 'track' ? found.uri : undefined,
    contextUri: found.kind === 'playlist' || found.kind === 'album' ? found.uri : undefined,
  });

  const open = spotifyOpenUrl(found);

  if (playResult.ok) {
    return {
      message:
        custom ||
        `Playing "${found.name}" in Spotify. If you do not hear it, open the Spotify app and try again.`,
      actions: open
        ? [
            {
              type: 'deeplink',
              url: open,
              embed: true,
              pillClass: 'action-pill-spotify',
              label: 'Open in Spotify',
            },
          ]
        : [],
    };
  }

  return {
    message:
      custom ||
      `Found "${found.name}". Could not start it automatically — open Spotify to play if needed.`,
    actions: open
      ? [
          {
            type: 'deeplink',
            url: open,
            pillClass: 'action-pill-spotify',
            label: 'Open in Spotify',
          },
        ]
      : [],
  };
}
