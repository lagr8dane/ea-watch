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
    if (j && Array.isArray(j.items)) return j;
    if (Array.isArray(j)) return { items: j };
    return { items: [] };
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

Use web search multiple times if needed (different queries per interest, plus "events near [anchor]" and venue names). Interests: ${list}

Hard rules:
- Location anchor (already geocoded): ${locationLabel}
- Prefer listings within roughly ${radiusMiles} miles (same borough/neighborhood counts for dense city centers like Manhattan; same metro is OK).
- Time focus: ${rangeDescription}
- Every item MUST have a real http(s) URL from your search. Omit items with no URL.
- Do not invent venues or URLs.
- For big cities and tourist anchors, aim for **8–12 items** when search returns enough distinct options; otherwise return as many solid hits as you find (minimum effort: at least 5 when the area is obviously rich like NYC).

For each item, **address_hint** must be geocodable: include neighborhood or cross-streets when known, plus city and region (e.g. "Upper West Side, Manhattan, New York, NY, USA" or "Brooklyn, NY"). If venue is famous, put the usual neighborhood in address_hint even if the page only says the venue name.

Output ONLY valid JSON (no markdown, no code fences). Shape:
{"items":[{"title":"string","summary":"one sentence","venue":"string or null","address_hint":"neighborhood, city, state/country for mapping","url":"https://...","start_date":"YYYY-MM-DD or null","start_time_hint":"string or null"}]}`;

  const msg = await client.messages.create({
    model: MODEL,
    max_tokens: 8192,
    messages: [{ role: 'user', content: userPrompt }],
    tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 10 }],
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
    }))
    .slice(0, 15);

  return { items };
}
