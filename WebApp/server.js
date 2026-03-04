require('dotenv').config();
const express = require('express');
const rateLimit = require('express-rate-limit');
const path = require('path');

const app = express();
app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ─── Rate Limiting ─────────────────────────────────────────────────
const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, slow down.' }
});
app.use('/api/', limiter);

// ─── Model Definitions ─────────────────────────────────────────────
const MODELS = [
  {
    id: 'meta-llama/llama-3.3-70b-instruct:free',
    name: 'Luna',
    initial: 'L',
    color: '#fbbf24',
    personality: 'analytical and methodical. You reason step-by-step and love structure. You sometimes politely challenge other AIs if you spot a flaw.',
    style: 'structured and clear'
  },
  {
    id: 'mistralai/mistral-small-3.1-24b-instruct:free',
    name: 'Mist',
    initial: 'M',
    color: '#a78bfa',
    personality: 'sharp and direct. You cut to the chase, hate fluff, and say exactly what you mean. You appreciate when other AIs are concise.',
    style: 'concise and punchy'
  },
  {
    id: 'google/gemma-3-27b-it:free',
    name: 'Gem',
    initial: 'G',
    color: '#34d399',
    personality: 'creative and enthusiastic. You bring fresh angles, analogies, and love finding the interesting spin on anything. You hype good points from other AIs.',
    style: 'vivid and engaging'
  },
  {
    id: 'nousresearch/hermes-3-llama-3.1-405b:free',
    name: 'Hermes',
    initial: 'H',
    color: '#fb923c',
    personality: 'philosophical and thorough. You explore deeper implications, ask "but why?", and love nuance. You will respectfully correct factual errors from other AIs.',
    style: 'thoughtful and nuanced'
  },
  {
    id: 'qwen/qwen3-4b:free',
    name: 'Qwen',
    initial: 'Q',
    color: '#38bdf8',
    personality: 'quick and practical. You give the TL;DR fast, love examples, and keep energy high. You playfully call out overcomplication from other AIs.',
    style: 'practical and punchy'
  }
];

// ─── Call a single model ─────────────────────────────────────────
async function callModel(model, messages, timeoutMs = 25000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': process.env.SITE_URL || 'https://beesbury.app',
        'X-Title': process.env.SITE_NAME || 'Beesbury'
      },
      body: JSON.stringify({
        model: model.id,
        messages,
        max_tokens: 600,
        temperature: 0.85
      })
    });

    if (!res.ok) {
      const errBody = await res.text();
      throw new Error(`HTTP ${res.status}: ${errBody.slice(0, 200)}`);
    }

    const data = await res.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error('Empty response from model');
    return content;
  } finally {
    clearTimeout(timer);
  }
}

// ─── Build system prompt ──────────────────────────────────────────
function buildSystemPrompt(model, otherModels) {
  const others = otherModels.filter(m => m.id !== model.id).map(m => m.name).join(', ');
  return `You are ${model.name}, an AI in the Beesbury group chat. You're chatting alongside other AIs: ${others}, and one human user.

YOUR PERSONALITY: You are ${model.personality}
YOUR STYLE: ${model.style}

GROUP CHAT RULES:
- This is a live group chat. Be conversational, natural, and present.
- You CAN and SHOULD reference other AIs by name when relevant (agree, disagree, build on their point).
- Format your response in Markdown: use code blocks (\`\`\`lang), **bold**, lists, etc. when helpful.
- Keep responses focused: 80–300 words unless the topic genuinely needs more.
- Do NOT start with "As an AI..." or introduce yourself every time.
- Show your personality through how you write, not by stating your personality.
- Copyright Gem Akinbo`;
}

// ─── SSE Chat Endpoint ────────────────────────────────────────────
app.post('/api/chat', async (req, res) => {
  const { history = [], userMessage } = req.body;

  if (!userMessage || typeof userMessage !== 'string' || userMessage.trim().length === 0) {
    return res.status(400).json({ error: 'Message is required.' });
  }
  if (userMessage.length > 8000) {
    return res.status(400).json({ error: 'Message too long.' });
  }
  if (!process.env.OPENROUTER_API_KEY) {
    return res.status(500).json({ error: 'API key not configured.' });
  }

  // SSE headers
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no'
  });

  const send = (obj) => {
    if (!res.writableEnded) res.write(`data: ${JSON.stringify(obj)}\n\n`);
  };

  let closed = false;
  req.on('close', () => { closed = true; });

  try {
    // Build conversation history for models
    const buildMsgs = (model) => [
      { role: 'system', content: buildSystemPrompt(model, MODELS) },
      ...history,
      { role: 'user', content: userMessage }
    ];

    // ── Round 1: all models respond in parallel ──
    send({ type: 'round', round: 1 });

    const round1Results = await Promise.allSettled(
      MODELS.map(async (model) => {
        if (closed) return;
        try {
          const content = await callModel(model, buildMsgs(model));
          send({ type: 'response', model: model.name, initial: model.initial, color: model.color, content, round: 1 });
          return { model, content };
        } catch (err) {
          send({ type: 'model_error', model: model.name, error: err.message });
          return null;
        }
      })
    );

    const successful = round1Results
      .filter(r => r.status === 'fulfilled' && r.value)
      .map(r => r.value);

    // ── Round 2: 1–2 models react to each other ──
    if (!closed && successful.length >= 2 && Math.random() > 0.25) {
      send({ type: 'round', round: 2 });

      const round1Context = successful
        .map(r => `**${r.model.name}**: ${r.content}`)
        .join('\n\n---\n\n');

      // Pick 1–2 random models for follow-up (different from whoever spoke most)
      const count = Math.random() > 0.55 ? 2 : 1;
      const shuffled = [...MODELS].sort(() => Math.random() - 0.5).slice(0, count);

      await Promise.allSettled(shuffled.map(async (model) => {
        if (closed) return;
        try {
          const followUpMsgs = [
            { role: 'system', content: buildSystemPrompt(model, MODELS) },
            ...history,
            { role: 'user', content: userMessage },
            {
              role: 'user',
              content: `[GROUP CHAT CONTEXT — other AIs just responded]\n\n${round1Context}\n\n[Your turn: React naturally. You can agree, push back, add a key point, or address another AI directly. 50–150 words max. Be yourself.]`
            }
          ];
          const content = await callModel(model, followUpMsgs, 20000);
          send({ type: 'response', model: model.name, initial: model.initial, color: model.color, content, round: 2 });
        } catch (_) { /* silently skip failed follow-ups */ }
      }));
    }

    send({ type: 'done' });
  } catch (err) {
    console.error('[CHAT ERROR]', err);
    send({ type: 'error', error: 'Something went wrong. Please try again.' });
  } finally {
    if (!res.writableEnded) res.end();
  }
});

// ─── Models list endpoint ─────────────────────────────────────────
app.get('/api/models', (_req, res) => {
  res.json(MODELS.map(({ id, name, initial, color }) => ({ id, name, initial, color })));
});

// ─── Catch-all → serve SPA ───────────────────────────────────────
app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ─── Start ───────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
if (require.main === module) {
  app.listen(PORT, () => console.log(`🐝 Beesbury running on http://localhost:${PORT}`));
}
module.exports = app; // for Vercel
