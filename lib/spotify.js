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

/**
 * Start playback. Premium + active device required for success.
 */
export async function startPlayback(accessToken, { trackUri, playlistUri }) {
  const body = trackUri
    ? JSON.stringify({ uris: [trackUri] })
    : JSON.stringify({ context_uri: playlistUri });
  const { res, json } = await api(accessToken, `/me/player/play`, {
    method: 'PUT',
    body,
  });
  if (res.status === 204) return { ok: true };
  if (res.status === 404) {
    return { ok: false, code: 'NO_DEVICE', message: json?.error?.message || 'No active device' };
  }
  if (res.status === 403) {
    return { ok: false, code: 'PREMIUM', message: json?.error?.message || 'Premium may be required' };
  }
  return {
    ok: false,
    code: 'ERROR',
    message: json?.error?.message || `Playback failed (${res.status})`,
  };
}
