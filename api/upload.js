// api/upload.js
// Handles profile photo upload to Vercel Blob.
// Stores the resulting URL in owner_config.avatar_url.
//
// POST /api/upload
// Content-Type: multipart/form-data
// Body: file field named 'avatar'
//
// Returns: { url: string }

import { put } from '@vercel/blob';
import { parse as parseCookies } from 'cookie';
import { queryOne, execute } from '../db/client.js';

const MAX_SIZE_BYTES = 5 * 1024 * 1024; // 5MB
const ALLOWED_TYPES  = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

export const config = { api: { bodyParser: false } };

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const cookies = parseCookies(req.headers.cookie ?? '');
  const token   = cookies['ea_session'];
  if (!token) return res.status(401).json({ error: 'No session' });

  const session = await queryOne(
    `SELECT s.owner_id, s.is_shell FROM sessions s
     WHERE s.token = ? AND datetime(s.expires_at) > datetime('now')`,
    [token]
  );
  if (!session)         return res.status(401).json({ error: 'Invalid or expired session' });
  if (session.is_shell) return res.status(403).json({ error: 'Not available in restricted mode' });

  const contentType = req.headers['content-type'] || '';
  if (!contentType.includes('multipart/form-data')) {
    return res.status(400).json({ error: 'Expected multipart/form-data' });
  }

  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const rawBody = Buffer.concat(chunks);

  if (rawBody.length > MAX_SIZE_BYTES) {
    return res.status(413).json({ error: 'File too large. Maximum 5MB.' });
  }

  const boundaryMatch = contentType.match(/boundary=([^\s;]+)/);
  if (!boundaryMatch) return res.status(400).json({ error: 'Invalid multipart boundary' });

  const parsed  = parseMultipart(rawBody, boundaryMatch[1]);
  const filePart = parsed.find(p => p.name === 'avatar');

  if (!filePart) return res.status(400).json({ error: 'No avatar file provided' });
  if (!ALLOWED_TYPES.includes(filePart.contentType)) {
    return res.status(400).json({ error: 'Invalid file type. Use JPEG, PNG, WebP, or GIF.' });
  }

  try {
    const ext      = filePart.contentType.split('/')[1].replace('jpeg', 'jpg');
    const filename = `avatar-${session.owner_id}.${ext}`;

    const blob = await put(filename, filePart.data, {
      access:          'public',
      contentType:     filePart.contentType,
      addRandomSuffix: false,
    });

    await execute(
      `UPDATE owner_config SET avatar_url = ?, updated_at = datetime('now') WHERE id = ?`,
      [blob.url, session.owner_id]
    );

    return res.status(200).json({ url: blob.url });

  } catch (err) {
    console.error('[upload] Blob upload failed:', err.message);
    return res.status(500).json({ error: 'Upload failed. Check BLOB_READ_WRITE_TOKEN is set.' });
  }
}

function parseMultipart(body, boundary) {
  const parts  = [];
  const sep    = Buffer.from('--' + boundary);
  let   offset = 0;

  while (offset < body.length) {
    const start = indexOf(body, sep, offset);
    if (start === -1) break;
    offset = start + sep.length;
    if (body.slice(offset, offset + 2).toString() === '--') break;
    if (body[offset] === 0x0d && body[offset + 1] === 0x0a) offset += 2;

    const headerEnd = indexOf(body, Buffer.from('\r\n\r\n'), offset);
    if (headerEnd === -1) break;

    const headerStr = body.slice(offset, headerEnd).toString();
    offset = headerEnd + 4;

    const contentEnd = indexOf(body, sep, offset);
    if (contentEnd === -1) break;

    const data        = body.slice(offset, contentEnd - 2);
    offset            = contentEnd;
    const disposition = headerStr.match(/Content-Disposition:([^\r\n]+)/i)?.[1] || '';
    const nameMatch   = disposition.match(/name="([^"]+)"/);
    const ct          = headerStr.match(/Content-Type:([^\r\n]+)/i)?.[1]?.trim();

    if (nameMatch) parts.push({ name: nameMatch[1], contentType: ct || 'application/octet-stream', data });
  }
  return parts;
}

function indexOf(buf, search, offset = 0) {
  for (let i = offset; i <= buf.length - search.length; i++) {
    let found = true;
    for (let j = 0; j < search.length; j++) {
      if (buf[i + j] !== search[j]) { found = false; break; }
    }
    if (found) return i;
  }
  return -1;
}
