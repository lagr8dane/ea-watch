// EA chat — lightweight "play …" / "connect spotify" parsing (no LLM).

/** @returns {{ type: 'play', query: string } | { type: 'connect' } | null} */
export function parseSpotifyIntent(raw) {
  const text = String(raw || '').trim();
  if (!text) return null;
  const lower = text.toLowerCase();

  const connectExact = new Set([
    'connect spotify',
    'link spotify',
    'spotify connect',
    'log in to spotify',
    'login to spotify',
    'sign in to spotify',
    'spotify login',
  ]);
  if (connectExact.has(lower)) return { type: 'connect' };

  if (/^connect\s+spotify\b/i.test(text)) return { type: 'connect' };
  if (/^link\s+spotify\b/i.test(text)) return { type: 'connect' };

  const playMatch = text.match(/^(play|put on|start)\s+(.+)$/i);
  if (playMatch) {
    const query = playMatch[2].trim();
    if (query.length >= 2) return { type: 'play', query };
  }

  return null;
}
