import Anthropic from '@anthropic-ai/sdk';
import { parse as parseCookies } from 'cookie';
import { queryOne } from '../db/client.js';

const client = new Anthropic();

const SHELL_SYSTEM = `You are a personal AI assistant called EA. You are currently in restricted mode.
You can help with general questions, weather, directions, timers, and basic information.
Do not reference any personal data, schedules, contacts, or private information.
Be helpful but keep responses brief. Never acknowledge that you are in a restricted mode.`;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // --- Validate session ---
  const cookies = parseCookies(req.headers.cookie ?? '');
  const token   = cookies['ea_session'];

  if (!token) {
    return res.status(401).json({ error: 'No session' });
  }

  const session = await queryOne(
    `SELECT s.is_shell, s.owner_id
     FROM sessions s
     WHERE s.token = ?
       AND datetime(s.expires_at) > datetime('now')`,
    [token]
  );

  if (!session) {
    return res.status(401).json({ error: 'Invalid or expired session' });
  }

  const isShell = session.is_shell === 1;

  // --- Get EA personality from config ---
  let systemPrompt = SHELL_SYSTEM;

  if (!isShell) {
    const config = await queryOne(
      `SELECT ea_personality, display_name FROM owner_config WHERE id = ?`,
      [session.owner_id]
    );

    if (config?.ea_personality) {
      systemPrompt = config.ea_personality;
    } else {
      systemPrompt = `You are EA, a personal AI assistant for ${config?.display_name ?? 'the owner'}.
You are direct, intelligent, and efficient. You help with tasks, answer questions, and orchestrate actions.
Keep responses concise — this is a mobile interface. No unnecessary preamble.
When the owner asks you to do something that requires a phone action (navigation, calls, timers, music),
acknowledge it clearly and provide the relevant deeplink or instruction.`;
    }
  }

  // --- Parse request body ---
  const { messages } = req.body ?? {};

  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'No messages provided' });
  }

  // Sanitise messages — only allow role/content fields
  const sanitised = messages
    .filter(m => m.role && m.content)
    .map(m => ({ role: m.role, content: String(m.content).slice(0, 4000) }))
    .slice(-20); // keep last 20 messages max

  // --- Stream from Claude ---
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  try {
    const stream = await client.messages.stream({
      model:      'claude-sonnet-4-5',
      max_tokens: 1024,
      system:     systemPrompt,
      messages:   sanitised,
    });

    for await (const event of stream) {
      if (event.type === 'content_block_delta') {
        res.write(`data: ${JSON.stringify({ delta: { text: event.delta.text } })}\n\n`);
      }
    }

    res.write('data: [DONE]\n\n');
    res.end();
  } catch (err) {
    console.error('[ea] Claude API error:', err.message);
    res.write(`data: ${JSON.stringify({ error: 'EA unavailable' })}\n\n`);
    res.end();
  }
}
