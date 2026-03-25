import { randomBytes } from 'crypto';
import { serialize as serializeCookie } from 'cookie';
import { getOwnerIdFromSession } from '../../lib/session-owner.js';
import { spotifyConfigured, buildAuthorizeUrl } from '../../lib/spotify.js';

const COOKIE_OPTS = (secure) => ({
  httpOnly: true,
  secure: Boolean(secure),
  sameSite: 'lax',
  maxAge: 600,
  path: '/',
});

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!spotifyConfigured()) {
    return res.status(503).json({
      error: 'Spotify is not configured',
      detail: 'Set SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET on the server.',
    });
  }

  const ownerId = await getOwnerIdFromSession(req);
  if (!ownerId) {
    return res.status(401).json({ error: 'Sign in from your watch flow first, then open Settings.' });
  }

  const state = randomBytes(24).toString('hex');
  const secure = process.env.NODE_ENV === 'production';

  res.setHeader('Set-Cookie', [
    serializeCookie('spotify_oauth_state', state, COOKIE_OPTS(secure)),
    serializeCookie('spotify_oauth_owner', ownerId, COOKIE_OPTS(secure)),
  ]);

  return res.redirect(302, buildAuthorizeUrl(state));
}
