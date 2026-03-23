// api/ea.js
import Anthropic from '@anthropic-ai/sdk';
import { parse as parseCookies } from 'cookie';
import { queryOne } from '../db/client.js';
import {
  matchChain,
  getActiveChainState,
  startChain,
  abortActiveChain,
} from '../lib/chain-engine.js';

const client = new Anthropic();

const SHELL_SYSTEM = `You are a personal AI assistant called EA. You are currently in restricted mode.
You can help with general questions, weather, directions, timers, and basic information.
Do not reference any personal data, schedules, contacts, or private information.
Be helpful but keep responses brief. Never acknowledge that you are in a restricted mode.`;

// Words that signal the user wants to abort an active chain
const ABORT_SIGNALS = ['stop', 'cancel', 'abort', 'quit', 'nevermind', 'never mind', 'forget it'];

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
    `SELECT s.token, s.is_shell, s.owner_id, s.device_id
     FROM sessions s
     WHERE s.token = ?
       AND datetime(s.expires_at) > datetime('now')`,
    [token]
  );

  if (!session) {
    return res.status(401).json({ error: 'Invalid or expired session' });
  }

  const isShell    = session.is_shell === 1;
  const sessionId  = session.token;
  const deviceId   = session.device_id;

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
    .slice(-20);

  // Latest user message — used for chain matching and interrupt detection
  const lastUserMessage = [...sanitised].reverse().find(m => m.role === 'user')?.content ?? '';

  // --- Set up SSE ---
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  // -------------------------------------------------------------------------
  // Chain handling — runs before Claude for owner sessions only
  // -------------------------------------------------------------------------
  if (!isShell && deviceId) {

    // 1. Check for an active (paused) chain — abort signal takes priority
    const activeState = await getActiveChainState(sessionId);

    if (activeState) {
      const isAbort = ABORT_SIGNALS.some(sig =>
        lastUserMessage.toLowerCase().trim() === sig ||
        lastUserMessage.toLowerCase().startsWith(sig + ' ')
      );

      if (isAbort) {
        const result = await abortActiveChain(sessionId, 'user said stop');
        return sendChainResult(res, result);
      }

      // Active chain is awaiting_confirm — the UI should be showing buttons,
      // not a text input. If we somehow get a text message while awaiting,
      // remind the user to use the buttons.
      if (activeState.status === 'awaiting_confirm') {
        sendText(res, 'Use the Continue or Skip buttons to proceed, or say "stop" to cancel.');
        res.write('data: [DONE]\n\n');
        res.end();
        return;
      }

      // Status is 'running' but we got a new message — treat as abort of
      // the stale state and fall through to normal EA handling
      await abortActiveChain(sessionId, 'superseded by new message');
    }

    // 2. Check if this message matches a chain trigger phrase
    const matchedChain = await matchChain(deviceId, lastUserMessage);

    if (matchedChain) {
      const result = await startChain(sessionId, matchedChain);
      return sendChainResult(res, result);
    }
  }

  // -------------------------------------------------------------------------
  // Standard Claude streaming — no chain matched
  // -------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// Chain result → SSE helpers
// ---------------------------------------------------------------------------

/**
 * Send a chain engine result over the SSE stream and close.
 * Handles all engine result statuses: actions, awaiting, completed, aborted, error.
 * Also recursively sends any nested `then` result (e.g. actions followed by awaiting).
 */
function sendChainResult(res, result) {
  if (!result) {
    sendText(res, 'Something went wrong with that chain.');
    res.write('data: [DONE]\n\n');
    res.end();
    return;
  }

  switch (result.status) {

    case 'actions': {
      // Send the message text (if any) as streamed text
      if (result.message) {
        sendText(res, result.message);
      }
      // Send client actions (deeplinks, shortcuts) as a single event
      if (result.actions?.length > 0) {
        res.write(`data: ${JSON.stringify({ actions: result.actions })}\n\n`);
      }
      // If there's a follow-on result (e.g. pausing at a confirmable step), send it
      if (result.then) {
        sendChainResult(res, result.then);
        return; // then will close the stream
      }
      res.write('data: [DONE]\n\n');
      res.end();
      break;
    }

    case 'awaiting': {
      // Surface the confirmable/required step prompt + control buttons
      sendText(res, result.prompt);
      res.write(`data: ${JSON.stringify({
        chain_control: {
          chainStateId: result.chainStateId,
          skippable:    result.skippable,
        }
      })}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
      break;
    }

    case 'completed': {
      sendText(res, result.message);
      res.write('data: [DONE]\n\n');
      res.end();
      break;
    }

    case 'aborted': {
      sendText(res, result.message);
      res.write('data: [DONE]\n\n');
      res.end();
      break;
    }

    case 'error':
    default: {
      sendText(res, result.message || 'Something went wrong.');
      res.write('data: [DONE]\n\n');
      res.end();
      break;
    }
  }
}

/**
 * Stream a plain text string as individual word chunks.
 * Matches the delta format the existing EA chat UI already handles.
 */
function sendText(res, text) {
  if (!text) return;
  // Emit word by word so the UI renders with the same streaming feel
  const words = text.split(' ');
  for (let i = 0; i < words.length; i++) {
    const chunk = i < words.length - 1 ? words[i] + ' ' : words[i];
    res.write(`data: ${JSON.stringify({ delta: { text: chunk } })}\n\n`);
  }
}
