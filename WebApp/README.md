# 🐝 Beesbury — Multi-AI Group Chat

A production-grade Node.js web application where **5 free AI models** respond to your messages in parallel, creating a WhatsApp-style group chat experience.

## ✨ Features

- **Group Chat with 5 AIs** — Luna, Mist, Gem, Hermes & Qwen all respond to every message
- **Models talk to each other** — Round 2 responses where AIs react to each other
- **Real-time SSE streaming** — Responses appear as each model finishes, not all at once
- **Interrupt button** — Stop the conversation mid-flow at any time
- **Sidebar chat management** — Create, rename, delete chats; stored in localStorage
- **Auto-cleanup** — Oldest chats removed automatically when storage fills up
- **Markdown rendering** — Code blocks with syntax highlighting + copy button, tables, lists
- **Secure API key** — Key lives server-side, never exposed to the browser
- **Keyboard shortcuts** — `Ctrl+N` new chat, `Enter` send, `Escape` close modals

## 🚀 Getting Started

### 1. Install dependencies
```bash
npm install
```

### 2. Set up environment
```bash
cp .env.example .env
# Edit .env and add your OpenRouter API key
```

### 3. Run locally
```bash
npm run dev   # auto-restart on file changes (Node 18+)
# or
npm start
```

Open http://localhost:3000

## 🌐 Deployment

### Render
1. Create a new **Web Service** → connect your repo
2. Set build command: `npm install`
3. Set start command: `npm start`
4. Add environment variable: `OPENROUTER_API_KEY`

### Vercel
1. Import your repo on vercel.com
2. Add `OPENROUTER_API_KEY` in Project Settings → Environment Variables
3. Deploy — `vercel.json` handles routing automatically

## 🔑 Environment Variables

| Variable | Required | Description |
|---|---|---|
| `OPENROUTER_API_KEY` | ✅ | Your OpenRouter API key |
| `SITE_URL` | Optional | Your deployed URL (for OpenRouter headers) |
| `SITE_NAME` | Optional | App name (default: Beesbury) |
| `PORT` | Optional | Server port (default: 3000) |

## 🤖 The Models

| Name | Model | Personality |
|---|---|---|
| **Luna** | Llama 3.3 70B | Analytical & methodical |
| **Mist** | Mistral Small 3.1 | Sharp & direct |
| **Gem** | Gemma 3 27B | Creative & enthusiastic |
| **Hermes** | Hermes 3 405B | Philosophical & thorough |
| **Qwen** | Qwen3 4B | Quick & practical |

All models are **free** via OpenRouter (rate limits apply: 20 req/min, 200/day per model).

## 📁 Structure

```
beesbury/
├── server.js          # Express backend + SSE endpoint
├── package.json
├── vercel.json        # Vercel deployment config
├── .env.example
└── public/
    ├── index.html     # App shell
    ├── styles.css     # All styling
    └── app.js         # Frontend logic
```

Copyright Gem Akinbo
