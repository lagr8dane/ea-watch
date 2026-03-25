import { getOwnerIdFromSession } from '../../lib/session-owner.js';
import { queryOne } from '../../db/client.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const ownerId = await getOwnerIdFromSession(req);
  if (!ownerId) {
    return res.status(401).json({ error: 'Unauthorised' });
  }

  const row = await queryOne(
    `SELECT spotify_refresh_token FROM owner_config WHERE id = ?`,
    [ownerId]
  );

  return res.status(200).json({
    spotify_connected: Boolean(row?.spotify_refresh_token),
  });
}
