/* ================================================================
   Beesbury — app.js
   Multi-model AI group chat frontend
   Copyright Gem Akinbo
================================================================ */

// ─── CONFIG ──────────────────────────────────────────────────────
const STORAGE_KEY  = 'beesbury_v1';
const MAX_CHATS    = 40;
const MSG_DELAY_MS = 480;  // stagger between group messages
const USER_AVATAR_COLOR = '#3f3f46';

// ─── STATE ───────────────────────────────────────────────────────
let state = {
  currentChatId: null,
  chats: {},        // { [id]: ChatObject }
  chatOrder: [],    // newest-first array of ids
  models: [],       // fetched from /api/models
  isLoading: false,
  interrupted: false,
};

let renamingChatId = null;
let msgQueue = [];
let isProcessingQueue = false;
let abortController = null;

// ─── UTILS ───────────────────────────────────────────────────────
const uid  = () => Math.random().toString(36).slice(2,10) + Date.now().toString(36);
const sleep = ms => new Promise(r => setTimeout(r, ms));

function timeAgo(ts) {
  const d = Date.now() - ts;
  if (d < 60000)  return 'just now';
  if (d < 3600000) return `${Math.floor(d/60000)}m ago`;
  if (d < 86400000) return `${Math.floor(d/3600000)}h ago`;
  return new Date(ts).toLocaleDateString(undefined, { month:'short', day:'numeric' });
}

function truncate(str, max=34) {
  return str.length > max ? str.slice(0, max).trimEnd() + '…' : str;
}

function firstWords(str, words=6) {
  return str.trim().split(/\s+/).slice(0,words).join(' ');
}

// ─── LOCAL STORAGE ───────────────────────────────────────────────
function loadStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const saved = JSON.parse(raw);
    state.chats     = saved.chats    || {};
    state.chatOrder = saved.chatOrder || [];
    // ensure chatOrder is consistent with chats
    state.chatOrder = state.chatOrder.filter(id => state.chats[id]);
  } catch(e) {
    console.warn('Storage load error:', e);
  }
}

function saveStorage() {
  try {
    const data = JSON.stringify({ chats: state.chats, chatOrder: state.chatOrder });
    localStorage.setItem(STORAGE_KEY, data);
  } catch(e) {
    if (e.name === 'QuotaExceededError') {
      pruneOldChats(10); // remove 10 oldest
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ chats: state.chats, chatOrder: state.chatOrder }));
      } catch(_) {
        showToast('⚠️ Storage full — older chats were removed.');
      }
    }
  }
}

function pruneOldChats(n=5) {
  // chatOrder is newest-first, so remove from the end
  const toRemove = state.chatOrder.splice(state.chatOrder.length - n, n);
  toRemove.forEach(id => delete state.chats[id]);
  showToast(`🗑️ Removed ${toRemove.length} old chat(s) to free space.`);
}

// ─── CHAT MANAGEMENT ─────────────────────────────────────────────
function createNewChat() {
  const id = uid();
  state.chats[id] = {
    id,
    title: 'New Chat',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    messages: [],     // display messages
    apiHistory: []    // condensed for API
  };
  state.chatOrder.unshift(id);

  // Trim if over limit
  if (state.chatOrder.length > MAX_CHATS) {
    const removed = state.chatOrder.pop();
    delete state.chats[removed];
  }

  saveStorage();
  switchChat(id);
  closeSidebar();
}

function deleteChat(id, e) {
  e?.stopPropagation();
  delete state.chats[id];
  state.chatOrder = state.chatOrder.filter(i => i !== id);
  saveStorage();

  if (state.currentChatId === id) {
    state.currentChatId = null;
    if (state.chatOrder.length) {
      switchChat(state.chatOrder[0]);
    } else {
      renderWelcome();
      document.getElementById('chatTitle').textContent = 'New Chat';
    }
  }
  renderSidebar();
  showToast('Chat deleted.');
}

function openRenameModal(id, e) {
  e?.stopPropagation();
  renamingChatId = id;
  const chat = state.chats[id];
  if (!chat) return;
  document.getElementById('renameInput').value = chat.title;
  document.getElementById('renameModal').style.display = 'flex';
  setTimeout(() => {
    const inp = document.getElementById('renameInput');
    inp.focus();
    inp.select();
  }, 50);
}

function closeRenameModal() {
  document.getElementById('renameModal').style.display = 'none';
  renamingChatId = null;
}

function confirmRename() {
  const title = document.getElementById('renameInput').value.trim();
  if (!title || !renamingChatId) return closeRenameModal();
  state.chats[renamingChatId].title = title;
  saveStorage();
  renderSidebar();
  if (renamingChatId === state.currentChatId) {
    document.getElementById('chatTitle').textContent = truncate(title, 40);
  }
  closeRenameModal();
}

function switchChat(id) {
  if (!state.chats[id]) return;
  state.currentChatId = id;
  const chat = state.chats[id];
  document.getElementById('chatTitle').textContent = truncate(chat.title, 40);
  renderMessages();
  renderSidebar();
  scrollToBottom(false);
  setTimeout(() => document.getElementById('prompt').focus(), 100);
}

// ─── API HISTORY BUILDER ──────────────────────────────────────────
function buildApiHistory(chat) {
  // Reconstruct condensed history from stored messages
  // Already stored as apiHistory on the chat object
  return chat.apiHistory || [];
}

// ─── SIDEBAR ─────────────────────────────────────────────────────
function renderSidebar() {
  const container = document.getElementById('sidebarChats');
  if (!state.chatOrder.length) {
    container.innerHTML = `<div style="text-align:center;padding:30px 16px;font-size:13px;color:var(--text-dim)">
      No chats yet.<br>Click <b>+</b> to start.
    </div>`;
    return;
  }

  container.innerHTML = state.chatOrder.map(id => {
    const chat = state.chats[id];
    if (!chat) return '';
    const active = id === state.currentChatId ? 'active' : '';
    return `
      <div class="chat-item ${active}" onclick="switchChat('${id}')">
        <i class="fas fa-comment-dots chat-item-icon"></i>
        <div class="chat-item-body">
          <div class="chat-item-title">${escapeHtml(truncate(chat.title))}</div>
          <div class="chat-item-time">${timeAgo(chat.updatedAt)}</div>
        </div>
        <div class="chat-item-actions">
          <button class="chat-action-btn" onclick="openRenameModal('${id}', event)" title="Rename">
            <i class="fas fa-pen"></i>
          </button>
          <button class="chat-action-btn delete" onclick="deleteChat('${id}', event)" title="Delete">
            <i class="fas fa-trash"></i>
          </button>
        </div>
      </div>
    `;
  }).join('');

  // Model pills in footer
  const pills = document.getElementById('sidebarModelPills');
  pills.innerHTML = state.models.map(m =>
    `<div class="model-pill">
      <div class="model-pill-dot" style="background:${m.color}"></div>
      <span>${m.name}</span>
    </div>`
  ).join('');

  // Header model badges
  const header = document.getElementById('headerModels');
  header.innerHTML = state.models.map(m =>
    `<div class="header-model-badge">
      <div class="header-model-dot" style="background:${m.color}"></div>
      ${m.name}
    </div>`
  ).join('');
}

// ─── WELCOME SCREEN ───────────────────────────────────────────────
function renderWelcome() {
  const container = document.getElementById('messages');
  const modelChips = state.models.map(m =>
    `<div class="welcome-model-chip">
      <span style="background:${m.color}"></span>
      ${m.name}
    </div>`
  ).join('');

  container.innerHTML = `
    <div class="welcome">
      <div class="welcome-logo">B</div>
      <h2>Welcome to Beesbury</h2>
      <p>A group chat with five AI minds — each with their own personality, all responding to you in parallel.</p>
      <div class="welcome-models">${modelChips}</div>
    </div>
  `;
}

// ─── MESSAGE RENDERING ────────────────────────────────────────────
function renderMessages() {
  const chat = state.chats[state.currentChatId];
  const container = document.getElementById('messages');

  if (!chat || !chat.messages.length) {
    renderWelcome();
    return;
  }

  container.innerHTML = '';
  let lastDate = null;
  let lastSender = null;
  let currentGroup = null;

  chat.messages.forEach((msg, i) => {
    const msgDate = new Date(msg.timestamp).toDateString();
    if (msgDate !== lastDate) {
      lastDate = msgDate;
      lastSender = null;
      currentGroup = null;
      const divider = document.createElement('div');
      divider.className = 'date-divider';
      divider.textContent = formatDate(msg.timestamp);
      container.appendChild(divider);
    }

    // Round 2 marker
    if (msg.round === 2 && (i === 0 || chat.messages[i-1].round !== 2)) {
      const marker = document.createElement('div');
      marker.className = 'round-marker';
      marker.innerHTML = '<i class="fas fa-comments" style="font-size:10px"></i> Models reacting';
      container.appendChild(marker);
    }

    const isUser = msg.type === 'user';
    const sender = msg.name || (isUser ? 'You' : 'AI');
    const groupType = isUser ? 'user-group' : 'ai-group';

    // Start a new group if sender changes
    if (sender !== lastSender) {
      currentGroup = document.createElement('div');
      currentGroup.className = `message-group ${groupType}`;
      container.appendChild(currentGroup);
      lastSender = sender;
    }

    const row = createMessageElement(msg);
    currentGroup.appendChild(row);
  });

  scrollToBottom(false);
}

function createMessageElement(msg) {
  const isUser = msg.type === 'user';
  const row = document.createElement('div');
  row.className = 'message-row';

  // Avatar
  const avatar = document.createElement('div');
  avatar.className = 'msg-avatar';
  avatar.style.background = isUser ? USER_AVATAR_COLOR : (msg.color || '#555');
  avatar.style.color = isUser ? '#e4e4e7' : '#111';
  avatar.textContent = isUser ? 'U' : (msg.initial || msg.name?.[0] || 'A');

  // Bubble container
  const bubble = document.createElement('div');
  bubble.className = 'msg-bubble';

  // Sender name
  const sender = document.createElement('div');
  sender.className = 'msg-sender';
  sender.style.color = isUser ? 'var(--text-dim)' : (msg.color || 'var(--text-muted)');
  sender.textContent = isUser ? 'You' : msg.name;

  // Reply badge (round 2)
  if (!isUser && msg.round === 2) {
    const badge = document.createElement('div');
    badge.className = 'reply-badge';
    badge.innerHTML = '<i class="fas fa-reply" style="font-size:9px"></i> replying to group';
    bubble.appendChild(badge);
  }

  bubble.appendChild(sender);

  // Content
  const content = document.createElement('div');
  content.className = 'msg-content';

  if (isUser) {
    content.textContent = msg.content;
  } else {
    content.innerHTML = renderMarkdown(msg.content);
    // Apply highlight.js to any pre>code blocks
    content.querySelectorAll('pre code').forEach(block => {
      hljs.highlightElement(block);
    });
    // Wrap code blocks + add copy button
    enhanceCodeBlocks(content);
  }

  // Timestamp
  const time = document.createElement('div');
  time.className = 'msg-time';
  time.textContent = formatTime(msg.timestamp);

  bubble.appendChild(content);
  bubble.appendChild(time);

  if (isUser) {
    row.appendChild(bubble);
    row.appendChild(avatar);
  } else {
    row.appendChild(avatar);
    row.appendChild(bubble);
  }

  return row;
}

function renderMarkdown(text) {
  marked.setOptions({
    breaks: true,
    gfm: true,
    highlight: null // hljs called separately
  });
  const raw = marked.parse(text || '');
  return DOMPurify.sanitize(raw, {
    ADD_TAGS: ['span'],
    ADD_ATTR: ['class', 'style']
  });
}

function enhanceCodeBlocks(container) {
  container.querySelectorAll('pre').forEach(pre => {
    const code = pre.querySelector('code');
    if (!code) return;

    // Get language
    const langClass = Array.from(code.classList).find(c => c.startsWith('language-'));
    const lang = langClass ? langClass.replace('language-', '') : 'code';

    const wrapper = document.createElement('div');
    wrapper.className = 'code-block-wrapper';

    const header = document.createElement('div');
    header.className = 'code-block-header';

    const langLabel = document.createElement('span');
    langLabel.className = 'code-lang';
    langLabel.textContent = lang;

    const copyBtn = document.createElement('button');
    copyBtn.className = 'copy-btn';
    copyBtn.innerHTML = '<i class="fas fa-copy"></i> Copy';
    copyBtn.onclick = () => {
      navigator.clipboard.writeText(code.innerText).then(() => {
        copyBtn.innerHTML = '<i class="fas fa-check"></i> Copied!';
        copyBtn.classList.add('copied');
        setTimeout(() => {
          copyBtn.innerHTML = '<i class="fas fa-copy"></i> Copy';
          copyBtn.classList.remove('copied');
        }, 2000);
      });
    };

    header.appendChild(langLabel);
    header.appendChild(copyBtn);

    pre.parentNode.insertBefore(wrapper, pre);
    wrapper.appendChild(header);
    wrapper.appendChild(pre);
  });
}

// ─── MESSAGE QUEUE (staggered group-chat display) ─────────────────
function enqueueMessage(msg) {
  msgQueue.push(msg);
  if (!isProcessingQueue) drainQueue();
}

async function drainQueue() {
  isProcessingQueue = true;
  while (msgQueue.length && !state.interrupted) {
    const msg = msgQueue.shift();
    appendLiveMessage(msg);
    if (msgQueue.length > 0) await sleep(MSG_DELAY_MS);
  }
  isProcessingQueue = false;

  if (!state.isLoading) {
    hideThinking();
    setInputEnabled(true);
  }
}

function appendLiveMessage(msg) {
  const chat = state.chats[state.currentChatId];
  if (!chat) return;

  // Persist
  chat.messages.push(msg);
  chat.updatedAt = Date.now();
  saveStorage();

  const container = document.getElementById('messages');

  // Remove welcome if present
  const welcome = container.querySelector('.welcome');
  if (welcome) welcome.remove();

  // Round 2 marker
  if (msg.round === 2) {
    const existing = container.querySelector('.round-marker');
    if (!existing) {
      const marker = document.createElement('div');
      marker.className = 'round-marker';
      marker.innerHTML = '<i class="fas fa-comments" style="font-size:10px"></i> Models reacting';
      container.appendChild(marker);
    }
  }

  // Group handling
  const isUser = msg.type === 'user';
  const sender = isUser ? 'You' : msg.name;
  const groupType = isUser ? 'user-group' : 'ai-group';

  let targetGroup = container.querySelector(`.message-group.${groupType}:last-child`);
  const lastGroup = container.lastElementChild;

  // Start new group if last group is different type or different sender
  if (!lastGroup || !lastGroup.classList.contains('message-group') ||
      !lastGroup.classList.contains(groupType)) {
    targetGroup = document.createElement('div');
    targetGroup.className = `message-group ${groupType}`;
    container.appendChild(targetGroup);
  } else {
    targetGroup = lastGroup;
    // Check sender changed within same group type
    const lastRow = targetGroup.lastElementChild;
    if (lastRow) {
      const lastSenderEl = lastRow.querySelector('.msg-sender');
      if (lastSenderEl && lastSenderEl.textContent !== sender) {
        targetGroup = document.createElement('div');
        targetGroup.className = `message-group ${groupType}`;
        container.appendChild(targetGroup);
      }
    }
  }

  const row = createMessageElement(msg);
  targetGroup.appendChild(row);
  scrollToBottom();
}

// ─── SENDING MESSAGES ─────────────────────────────────────────────
async function sendMessage() {
  if (state.isLoading) return;

  const promptEl = document.getElementById('prompt');
  const text = promptEl.value.trim();
  if (!text) return;

  // If no active chat, create one
  if (!state.currentChatId) createNewChat();

  const chat = state.chats[state.currentChatId];

  // Auto-title from first message
  if (chat.messages.length === 0) {
    chat.title = firstWords(text, 6);
    document.getElementById('chatTitle').textContent = truncate(chat.title, 40);
  }

  // Clear input
  promptEl.value = '';
  promptEl.style.height = 'auto';

  // User message
  const userMsg = {
    id: uid(), type: 'user', name: 'You',
    content: text, timestamp: Date.now(), round: null
  };
  enqueueMessage(userMsg);

  // Wait for user message to render before AI starts
  await sleep(200);

  // Update API history
  chat.apiHistory.push({ role: 'user', content: text });
  saveStorage();
  renderSidebar();

  // Start loading
  state.isLoading = true;
  state.interrupted = false;
  setInputEnabled(false);
  showThinking();

  abortController = new AbortController();

  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      signal: abortController.signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        history: chat.apiHistory.slice(-30), // limit context window
        userMessage: text
      })
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: `Server error ${res.status}` }));
      throw new Error(err.error || `HTTP ${res.status}`);
    }

    // Parse SSE stream
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    const roundResponses = {};  // collect per round for apiHistory

    while (true) {
      if (state.interrupted) { reader.cancel(); break; }
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop(); // keep partial line

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        try {
          const evt = JSON.parse(line.slice(6));
          handleSSEEvent(evt, roundResponses);
        } catch(_) {}
      }
    }

    // After stream done, build apiHistory assistant turn
    const allResponses = Object.values(roundResponses).flat();
    if (allResponses.length) {
      const combined = allResponses.map(r => `**${r.model}**: ${r.content}`).join('\n\n');
      chat.apiHistory.push({ role: 'assistant', content: combined });
      saveStorage();
    }

  } catch(err) {
    if (err.name !== 'AbortError') {
      console.error('[STREAM ERROR]', err);
      enqueueMessage({
        id: uid(), type: 'ai', name: 'System',
        initial: '!', color: '#f87171',
        content: `⚠️ **Error:** ${err.message || 'Connection failed. Please try again.'}`,
        timestamp: Date.now(), round: null
      });
    }
  } finally {
    state.isLoading = false;
    abortController = null;

    // Hide thinking once queue drains
    if (!isProcessingQueue) {
      hideThinking();
      setInputEnabled(true);
    }
    renderSidebar();
  }
}

function handleSSEEvent(evt, roundResponses) {
  switch (evt.type) {
    case 'round':
      if (!roundResponses[evt.round]) roundResponses[evt.round] = [];
      break;

    case 'response': {
      const msg = {
        id: uid(),
        type: 'ai',
        name: evt.model,
        initial: evt.initial,
        color: evt.color,
        content: evt.content,
        timestamp: Date.now(),
        round: evt.round
      };
      enqueueMessage(msg);
      const round = evt.round || 1;
      if (!roundResponses[round]) roundResponses[round] = [];
      roundResponses[round].push({ model: evt.model, content: evt.content });
      break;
    }

    case 'model_error':
      console.warn(`Model ${evt.model} failed:`, evt.error);
      break;

    case 'error':
      enqueueMessage({
        id: uid(), type: 'ai', name: 'System',
        initial: '!', color: '#f87171',
        content: `⚠️ ${evt.error}`,
        timestamp: Date.now(), round: null
      });
      break;

    case 'done':
      break;
  }
}

function interrupt() {
  state.interrupted = true;
  if (abortController) abortController.abort();
  msgQueue = [];
  isProcessingQueue = false;
  hideThinking();
  setInputEnabled(true);
  showToast('⏹ Stopped.');
}

// ─── UI HELPERS ───────────────────────────────────────────────────
function showThinking() {
  const bar = document.getElementById('thinkingBar');
  const avatarsEl = document.getElementById('thinkingAvatars');

  avatarsEl.innerHTML = state.models.map((m, i) =>
    `<div class="thinking-avatar" style="background:${m.color};color:#111;animation-delay:${i*0.2}s">
      ${m.initial}
    </div>`
  ).join('');

  bar.style.display = 'flex';
  document.getElementById('interruptBtn').style.display = 'flex';
  document.getElementById('statusDot').classList.add('loading');
  document.getElementById('statusText').textContent = 'Thinking…';
}

function hideThinking() {
  document.getElementById('thinkingBar').style.display = 'none';
  document.getElementById('interruptBtn').style.display = 'none';
  document.getElementById('statusDot').classList.remove('loading');
  document.getElementById('statusText').textContent = 'Online';
}

function setInputEnabled(enabled) {
  const prompt = document.getElementById('prompt');
  const sendBtn = document.getElementById('sendBtn');
  prompt.disabled = !enabled;
  sendBtn.disabled = !enabled;
  if (enabled) prompt.focus();
}

function scrollToBottom(smooth=true) {
  const el = document.getElementById('messages');
  el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
}

// ─── SIDEBAR TOGGLE (mobile) ──────────────────────────────────────
function toggleSidebar() {
  const sidebar  = document.getElementById('sidebar');
  const overlay  = document.getElementById('sidebarOverlay');
  const isOpen   = sidebar.classList.toggle('open');
  overlay.classList.toggle('visible', isOpen);
}

function closeSidebar() {
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('sidebarOverlay').classList.remove('visible');
}

// ─── TOAST ───────────────────────────────────────────────────────
let toastTimer = null;
function showToast(msg, duration=2800) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), duration);
}

// ─── FORMAT HELPERS ───────────────────────────────────────────────
function formatTime(ts) {
  return new Date(ts).toLocaleTimeString(undefined, { hour:'2-digit', minute:'2-digit' });
}

function formatDate(ts) {
  const d = new Date(ts);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return 'Today';
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString(undefined, { weekday:'long', month:'short', day:'numeric' });
}

function escapeHtml(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ─── KEYBOARD SHORTCUTS ───────────────────────────────────────────
document.addEventListener('keydown', e => {
  // Escape: close modal or sidebar
  if (e.key === 'Escape') {
    if (document.getElementById('renameModal').style.display !== 'none') {
      closeRenameModal();
    } else {
      closeSidebar();
    }
    return;
  }
  // Ctrl/Cmd + N: new chat
  if ((e.ctrlKey || e.metaKey) && e.key === 'n') {
    e.preventDefault();
    createNewChat();
    return;
  }
  // Enter in rename modal
  if (e.key === 'Enter' && document.getElementById('renameModal').style.display !== 'none') {
    confirmRename();
  }
});

// Textarea auto-resize + Enter to send
const promptEl = document.getElementById('prompt');
promptEl.addEventListener('input', function() {
  this.style.height = 'auto';
  this.style.height = Math.min(this.scrollHeight, 140) + 'px';
});
promptEl.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

// Close modal on overlay click
document.getElementById('renameModal').addEventListener('click', function(e) {
  if (e.target === this) closeRenameModal();
});

// ─── INIT ─────────────────────────────────────────────────────────
async function init() {
  loadStorage();

  // Fetch model list from server
  try {
    const res = await fetch('/api/models');
    state.models = await res.json();
  } catch(e) {
    console.error('Failed to load models:', e);
    state.models = [
      { name:'Luna', initial:'L', color:'#fbbf24' },
      { name:'Mist', initial:'M', color:'#a78bfa' },
      { name:'Gem',  initial:'G', color:'#34d399'  },
      { name:'Hermes',initial:'H',color:'#fb923c'  },
      { name:'Qwen', initial:'Q', color:'#38bdf8'  }
    ];
  }

  renderSidebar();

  // Restore last active chat or show welcome
  if (state.chatOrder.length) {
    const lastId = state.chatOrder[0];
    if (state.chats[lastId]) {
      switchChat(lastId);
    } else {
      renderWelcome();
    }
  } else {
    renderWelcome();
  }

  promptEl.focus();
}

init();
