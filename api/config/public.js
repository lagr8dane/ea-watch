import { queryOne } from '../../db/client.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const config = await queryOne(
    `SELECT display_name, title, stranger_bio as bio,
            stranger_linkedin as linkedin,
            stranger_calendly as calendly,
            stranger_whatsapp as whatsapp,
            stranger_imessage as imessage,
            avatar_url
     FROM owner_config LIMIT 1`
  );

  if (!config) {
    return res.status(404).json({ error: 'Not configured' });
  }

  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
  return res.status(200).json(config);
}
