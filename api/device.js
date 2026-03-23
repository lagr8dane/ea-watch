import { parse as parseCookies } from 'cookie';
import { queryOne, execute } from '../db/client.js';
import { v4 as uuid } from 'uuid';

async function getOwner(req) {
  const cookies = parseCookies(req.headers.cookie ?? '');
  const token   = cookies['ea_session'];
  if (!token) return null;
  const session = await queryOne(
    `SELECT owner_id, is_shell FROM sessions WHERE token = ?`, [token]
  );
  if (!session || session.is_shell) return null;
  return session.owner_id;
}

export default async function handler(req, res) {

  // POST /api/device — register a new device
  if (req.method === 'POST') {
    const { uid, device_code, notes } = req.body ?? {};

    if (!uid || !device_code) {
      return res.status(400).json({ error: 'uid and device_code are required' });
    }

    // First device registration — owner may not exist yet
    // Check if any owner_config exists; if not, create a placeholder
    let ownerConfig = await queryOne(`SELECT id FROM owner_config LIMIT 1`);

    if (!ownerConfig) {
      const ownerId = uuid();
      await execute(
        `INSERT INTO owner_config (id, display_name) VALUES (?, 'Owner')`,
        [ownerId]
      );
      ownerConfig = { id: ownerId };
    }

    const deviceId = uuid();

    try {
      await execute(
        `INSERT INTO devices (id, uid, device_code, owner_id, notes)
         VALUES (?, ?, ?, ?, ?)`,
        [deviceId, uid.toUpperCase(), device_code, ownerConfig.id, notes ?? null]
      );
    } catch (err) {
      if (err.message.includes('UNIQUE')) {
        return res.status(409).json({ error: 'Device with this UID or code already exists' });
      }
      throw err;
    }

    return res.status(201).json({ ok: true, device_id: deviceId });
  }

  // GET /api/device — list registered devices (session gated)
  if (req.method === 'GET') {
    const ownerId = await getOwner(req);
    if (!ownerId) return res.status(401).json({ error: 'Unauthorised' });

    const devices = await queryOne(
      `SELECT id, uid, device_code, active, registered_at, notes
       FROM devices WHERE owner_id = ?`,
      [ownerId]
    );

    return res.status(200).json(devices ?? []);
  }

  // POST /api/device/transfer — decommission device
  if (req.url?.includes('/transfer')) {
    const ownerId = await getOwner(req);
    if (!ownerId) return res.status(401).json({ error: 'Unauthorised' });

    await execute(
      `UPDATE devices SET active = 0 WHERE owner_id = ?`, [ownerId]
    );

    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
