import { queryOne } from '../../db/client.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const config = await queryOne(
    `SELECT display_name, title, stranger_bio as bio,
            stranger_focus as focus,
            stranger_accent_hex as accent_hex,
            stranger_linkedin as linkedin,
            stranger_instagram as instagram,
            stranger_instagram as stranger_instagram,
            stranger_calendly as calendly,
            stranger_calendly as stranger_calendly,
            stranger_whatsapp as whatsapp,
            stranger_imessage as imessage,
            avatar_url
     FROM owner_config
     ORDER BY datetime(updated_at) DESC
     LIMIT 1`
  );

  if (!config) {
    return res.status(404).json({ error: 'Not configured' });
  }

  // Contact card must reflect latest Settings — avoid CDN/browser serving stale JSON without new fields
  res.setHeader('Cache-Control', 'private, no-store, must-revalidate');
  return res.status(200).json(config);
}
