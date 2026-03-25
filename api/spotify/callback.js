import { parse as parseCookies, serialize as serializeCookie } from 'cookie';
import {
  spotifyConfigured,
  exchangeCodeForTokens,
  saveSpotifyTokens,
  getAppBaseUrl,
} from '../../lib/spotify.js';

const CLEAR_COOKIE = (secure) =>
  serializeCookie('spotify_oauth_state', '', {
    httpOnly: true,
    secure: Boolean(secure),
    sameSite: 'lax',
    maxAge: 0,
    path: '/',
  });

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const secure = process.env.NODE_ENV === 'production';
  const base = getAppBaseUrl();

  const failRedirect = (msg) => {
    const q = new URLSearchParams({ spotify: 'error', reason: msg.slice(0, 200) });
    res.setHeader('Set-Cookie', [
      CLEAR_COOKIE(secure),
      serializeCookie('spotify_oauth_owner', '', {
        httpOnly: true,
        secure,
        sameSite: 'lax',
        maxAge: 0,
        path: '/',
      }),
    ]);
    return res.redirect(302, `${base}/config?${q.toString()}#spotify`);
  };

  if (!spotifyConfigured()) {
    return failRedirect('not_configured');
  }

  const { code, state, error, error_description } = req.query || {};
  if (error) {
    return failRedirect(String(error_description || error || 'denied'));
  }

  const cookies = parseCookies(req.headers.cookie ?? '');
  const expectedState = cookies['spotify_oauth_state'];
  const ownerId = cookies['spotify_oauth_owner'];

  if (!code || !state || !expectedState || state !== expectedState || !ownerId) {
    return failRedirect('invalid_state');
  }

  try {
    const tokens = await exchangeCodeForTokens(String(code));
    await saveSpotifyTokens(ownerId, tokens);
  } catch (e) {
    console.error('[spotify callback]', e?.message || e);
    return failRedirect('token_exchange_failed');
  }

  res.setHeader('Set-Cookie', [
    CLEAR_COOKIE(secure),
    serializeCookie('spotify_oauth_owner', '', {
      httpOnly: true,
      secure,
      sameSite: 'lax',
      maxAge: 0,
      path: '/',
    }),
  ]);

  return res.redirect(302, `${base}/config?spotify=connected#spotify`);
}
