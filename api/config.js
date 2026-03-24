import { parse as parseCookies } from 'cookie';
import { queryOne, execute } from '../db/client.js';
import { hashCredential } from '../lib/auth.js';

async function getOwner(req) {
  const cookies = parseCookies(req.headers.cookie ?? '');
  const token   = cookies['ea_session'];
  if (!token) return null;

  const session = await queryOne(
    `SELECT owner_id, is_shell FROM sessions
     WHERE token = ?
       AND datetime(expires_at) > datetime('now')`,
    [token]
  );

  // Shell sessions cannot access config
  if (!session || session.is_shell) return null;
  return session.owner_id;
}

export default async function handler(req, res) {

  // --- GET: read config ---
  if (req.method === 'GET') {
    const ownerId = await getOwner(req);
    if (!ownerId) return res.status(401).json({ error: 'Unauthorised' });

    const config = await queryOne(
      `SELECT display_name, title, session_window_mins, challenge_style,
              challenge_phrase, alert_phone, alert_email, ea_personality,
              stranger_bio, stranger_focus, stranger_accent_hex,
              stranger_linkedin, stranger_calendly,
              stranger_imessage, stranger_whatsapp, avatar_url,
              briefing_interests, briefing_tickers, interest_radar_topics
       FROM owner_config WHERE id = ?`,
      [ownerId]
    );

    if (!config) return res.status(404).json({ error: 'No config found' });
    return res.status(200).json(config);
  }

  // --- POST: write config ---
  if (req.method === 'POST') {
    const ownerId = await getOwner(req);
    if (!ownerId) return res.status(401).json({ error: 'Unauthorised' });

    const b = req.body ?? {};

    const updates = {
      display_name:        b.display_name        ?? null,
      title:               b.title               ?? null,
      session_window_mins: b.session_window_mins  ?? 60,
      challenge_style:     b.challenge_style      ?? 'word_then_pin',
      challenge_phrase:    b.challenge_phrase     ?? null,
      alert_phone:         b.alert_phone          ?? null,
      alert_email:         b.alert_email          ?? null,
      ea_personality:      b.ea_personality       ?? null,
      stranger_bio:        b.stranger_bio         ?? null,
      stranger_linkedin:   b.stranger_linkedin    ?? null,
      stranger_calendly:   b.stranger_calendly    ?? null,
      stranger_imessage:   b.stranger_imessage    ?? null,
      stranger_whatsapp:   b.stranger_whatsapp    ?? null,
      briefing_interests:  b.briefing_interests   ?? null,
      briefing_tickers:    b.briefing_tickers     ?? null,
      interest_radar_topics: b.interest_radar_topics ?? null,
    };

    if (b.avatar_url !== undefined) updates.avatar_url = b.avatar_url ?? null;
    if (b.stranger_focus !== undefined) updates.stranger_focus = b.stranger_focus ?? null;
    if (b.stranger_accent_hex !== undefined) updates.stranger_accent_hex = b.stranger_accent_hex ?? null;

    // Only update credentials if provided
    if (b.pin)         updates.pin_hash         = await hashCredential(b.pin);
    if (b.access_word) updates.access_word_hash = await hashCredential(b.access_word);
    if (b.danger_word) updates.danger_word_hash = await hashCredential(b.danger_word);

    const existing = await queryOne(
      `SELECT id FROM owner_config WHERE id = ?`, [ownerId]
    );

    if (existing) {
      const fields = Object.keys(updates).map(k => `${k} = ?`).join(', ');
      const values = [...Object.values(updates), ownerId];
      await execute(
        `UPDATE owner_config SET ${fields}, updated_at = datetime('now') WHERE id = ?`,
        values
      );
    } else {
      const keys         = ['id', ...Object.keys(updates)];
      const placeholders = keys.map(() => '?').join(', ');
      const values       = [ownerId, ...Object.values(updates)];
      await execute(
        `INSERT INTO owner_config (${keys.join(', ')}) VALUES (${placeholders})`,
        values
      );
    }

    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
