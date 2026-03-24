// Interest radar — Claude + web search, JSON suggestions (URLs required).

import Anthropic from '@anthropic-ai/sdk';

const MODEL = 'claude-sonnet-4-5';

export function parseRadarInterests(raw) {
  if (!raw || typeof raw !== 'string') return [];
  const parts = raw.split(/[\n,]+/).map((s) => s.trim()).filter(Boolean);
  return [...new Set(parts)].slice(0, 8);
}

export function extractAssistantText(message) {
  const blocks = message.content || [];
  let t = '';
  for (const b of blocks) {
    if (b.type === 'text' && b.text) t += b.text;
  }
  return t.trim();
}

export function parseRadarJson(text) {
  let s = String(text || '').trim();
  if (!s) return { items: [] };
  if (s.startsWith('```')) {
    s = s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '');
  }
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start >= 0 && end > start) s = s.slice(start, end + 1);
  try {
    const j = JSON.parse(s);
    if (!j || !Array.isArray(j.items)) return { items: [] };
    return j;
  } catch {
    return { items: [] };
  }
}

function validHttpUrl(u) {
  if (!u || typeof u !== 'string') return false;
  try {
    const x = new URL(u.trim());
    return x.protocol === 'https:' || x.protocol === 'http:';
  } catch {
    return false;
  }
}

/**
 * @param {{ locationLabel: string, radiusMiles: number, rangeDescription: string, interests: string[] }} params
 */
export async function fetchRadarSuggestions({ locationLabel, radiusMiles, rangeDescription, interests }) {
  const client = new Anthropic();
  const list = interests.length ? interests.join('; ') : 'general local activities';

  const userPrompt = `You help someone find real things to do near a verified location.

Use web search. Interests to emphasize: ${list}

Hard rules:
- Location anchor (already geocoded): ${locationLabel}
- Only include listings within roughly ${radiusMiles} miles of that anchor (or clearly in the same metro area if the anchor is broad).
- Time focus for the user: ${rangeDescription}
- Every item MUST include a real http(s) URL you found in search (event page, venue, park service, Meetup, museum, ticket seller, etc.). If you cannot find a URL, omit the item.
- Do not invent events, venues, or URLs.
- Return 3–8 items when possible; fewer is OK if search is thin.

Output ONLY valid JSON (no markdown, no code fences). Shape:
{"items":[{"title":"string","summary":"one sentence","venue":"string or null","address_hint":"string for geocoding (city, neighborhood, or address)","url":"https://...","start_date":"YYYY-MM-DD or null","start_time_hint":"string or null"}]}`;

  const msg = await client.messages.create({
    model: MODEL,
    max_tokens: 4096,
    messages: [{ role: 'user', content: userPrompt }],
    tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 5 }],
  });

  const text = extractAssistantText(msg);
  const parsed = parseRadarJson(text);
  const items = (parsed.items || [])
    .filter((it) => it && typeof it.title === 'string' && validHttpUrl(it.url))
    .map((it) => ({
      title: String(it.title).slice(0, 200),
      summary: typeof it.summary === 'string' ? it.summary.slice(0, 400) : '',
      venue: it.venue != null ? String(it.venue).slice(0, 200) : null,
      address_hint: it.address_hint != null ? String(it.address_hint).slice(0, 200) : null,
      url: String(it.url).trim(),
      start_date: it.start_date != null && /^\d{4}-\d{2}-\d{2}$/.test(String(it.start_date)) ? String(it.start_date) : null,
      start_time_hint: it.start_time_hint != null ? String(it.start_time_hint).slice(0, 120) : null,
    }));

  return { items };
}
