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
export async function startPlayback(accessToken, { trackUri, playlistUri }) {
  const body = trackUri
    ? JSON.stringify({ uris: [trackUri] })
    : JSON.stringify({ context_uri: playlistUri });

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
