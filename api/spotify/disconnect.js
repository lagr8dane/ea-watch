import { getOwnerIdFromSession } from '../../lib/session-owner.js';
import { clearSpotifyTokens } from '../../lib/spotify.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const ownerId = await getOwnerIdFromSession(req);
  if (!ownerId) {
    return res.status(401).json({ error: 'Unauthorised' });
  }

  await clearSpotifyTokens(ownerId);
  return res.status(200).json({ ok: true });
}
