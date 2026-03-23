import { queryOne } from '../db/client.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const config = await queryOne(
    `SELECT display_name, title, stranger_bio as bio,
            stranger_linkedin as linkedin,
            stranger_calendly as calendly,
            stranger_whatsapp as whatsapp,
            stranger_imessage as imessage
     FROM owner_config LIMIT 1`
  );

  if (!config) {
    return res.status(404).json({ error: 'Not configured' });
  }

  // Only public-safe fields — no credentials, no EA config, no alert details
  res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate');
  return res.status(200).json(config);
}
