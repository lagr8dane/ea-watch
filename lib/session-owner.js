import { parse as parseCookies } from 'cookie';
import { queryOne } from '../db/client.js';

/** @returns {Promise<string|null>} owner_id or null */
export async function getOwnerIdFromSession(req) {
  const cookies = parseCookies(req.headers.cookie ?? '');
  const token = cookies['ea_session'];
  if (!token) return null;
  const session = await queryOne(
    `SELECT owner_id, is_shell FROM sessions
     WHERE token = ?
       AND datetime(expires_at) > datetime('now')`,
    [token]
  );
  if (!session || session.is_shell === 1) return null;
  return session.owner_id;
}
