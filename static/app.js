'use strict';

// ── State ────────────────────────────────────────────────────
let currentData     = null;   // { session, records }
let currentViewMode = 'simple';

const DB_STORAGE_KEY = 'adv_db_cfg';  // localStorage key (no password stored)

// ── Utility: HTML escaping ───────────────────────────────────
function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── Utility: DOM ─────────────────────────────────────────────
function div(cls, ...children) {
  const el = document.createElement('div');
  if (cls) el.className = cls;
  for (const c of children) {
    if (typeof c === 'string') el.insertAdjacentHTML('beforeend', c);
    else if (c instanceof Node) el.appendChild(c);
  }
  return el;
}

function makeDetails(label, bodyNode, open = false) {
  const det = document.createElement('details');
  if (open) det.open = true;
  const sum = document.createElement('summary');
  sum.textContent = label;
  det.appendChild(sum);
  const body = div('details-body');
  body.appendChild(bodyNode);
  det.appendChild(body);
  return det;
}

function jsonBox(obj) {
  const pre = document.createElement('pre');
  pre.className = 'json-box';
  pre.textContent = JSON.stringify(obj, null, 2);
  return pre;
}

function codeBlock(text, tall = false) {
  const pre = document.createElement('pre');
  if (tall) pre.className = 'tall';
  pre.textContent = text;
  return pre;
}

function alert(msg, type = 'info') {
  const el = div(`alert alert-${type}`);
  el.textContent = msg;
  return el;
}

// ── Markdown renderer (no external deps) ────────────────────
function renderMarkdown(text) {
  if (!text) return div('md');
  const lines = String(text).split('\n');
  const html  = [];
  let inCode  = false;
  let codeAcc = [];
  let inList  = false;

  function flushList() {
    if (inList) { html.push('</ul>'); inList = false; }
  }

  function inline(s) {
    // Escape first, then apply inline formatting
    s = esc(s);
    s = s.replace(/\*\*(.+?)\*\*/g,    '<strong>$1</strong>');
    s = s.replace(/__(.+?)__/g,         '<strong>$1</strong>');
    s = s.replace(/\*(.+?)\*/g,         '<em>$1</em>');
    s = s.replace(/_([^_]+)_/g,         '<em>$1</em>');
    s = s.replace(/`([^`]+)`/g,         '<code>$1</code>');
    return s;
  }

  for (const raw of lines) {
    // Fenced code blocks
    if (!inCode && /^```/.test(raw)) {
      flushList();
      inCode = true; codeAcc = [];
      continue;
    }
    if (inCode) {
      if (raw === '```' || raw === '~~~') {
        html.push(`<pre>${esc(codeAcc.join('\n'))}</pre>`);
        inCode = false; codeAcc = [];
      } else {
        codeAcc.push(raw);
      }
      continue;
    }

    const s = raw;

    // Headings
    if (/^### /.test(s)) { flushList(); html.push(`<h3>${inline(s.slice(4))}</h3>`); continue; }
    if (/^## /.test(s))  { flushList(); html.push(`<h2>${inline(s.slice(3))}</h2>`); continue; }
    if (/^# /.test(s))   { flushList(); html.push(`<h1>${inline(s.slice(2))}</h1>`); continue; }

    // HR
    if (/^---+$/.test(s.trim())) { flushList(); html.push('<hr>'); continue; }

    // Bullet list
    if (/^[-*] /.test(s)) {
      if (!inList) { html.push('<ul>'); inList = true; }
      html.push(`<li>${inline(s.slice(2))}</li>`);
      continue;
    }

    // Ordered list
    if (/^\d+\. /.test(s)) {
      if (!inList) { html.push('<ul>'); inList = true; }
      html.push(`<li>${inline(s.replace(/^\d+\. /, ''))}</li>`);
      continue;
    }

    flushList();

    // Blank line → paragraph break
    if (!s.trim()) { html.push('<br>'); continue; }

    html.push(`<p>${inline(s)}</p>`);
  }

  if (inCode && codeAcc.length) html.push(`<pre>${esc(codeAcc.join('\n'))}</pre>`);
  flushList();

  const wrap = div('md');
  wrap.innerHTML = html.join('');
  return wrap;
}

// ── Content-block renderer ───────────────────────────────────
function renderContentBlock(block) {
  const frag = document.createDocumentFragment();
  const type = block.type || 'text';

  if (type === 'text') {
    const text = (block.text || '').trim();
    if (text) frag.appendChild(renderMarkdown(text));

  } else if (type === 'thinking') {
    const inner = div('thinking-block');
    inner.appendChild(renderMarkdown(block.thinking || ''));
    frag.appendChild(makeDetails('🧠 Thinking', inner, false));

  } else if (type === 'tool_use') {
    const name   = block.name || 'unknown_tool';
    const toolId = block.id   || '';
    const inp    = block.input || {};

    const wrapper = div('');
    const header  = div('tool-call-block');
    header.innerHTML = `🔧 <strong>Tool call:</strong> <code>${esc(name)}</code>`
                     + `<span style="color:var(--text-muted);margin-left:8px">id=${esc(toolId)}</span>`;
    wrapper.appendChild(header);

    if (Object.keys(inp).length) {
      const body = div('');
      body.appendChild(jsonBox(inp));
      wrapper.appendChild(makeDetails('Input', body, false));
    }
    frag.appendChild(wrapper);

  } else if (type === 'tool_result') {
    const toolUseId = block.tool_use_id || '';
    const content   = block.content ?? '';

    const wrapper = div('');
    const header  = div('tool-res-block');
    header.innerHTML = `✅ <strong>Tool result</strong>`
                     + `<span style="color:var(--text-muted);margin-left:8px">id=${esc(toolUseId)}</span>`;
    wrapper.appendChild(header);

    const renderText = (txt) => {
      const el = txt.length > 2000
        ? makeDetails('Show full result', codeBlock(txt, true), false)
        : codeBlock(txt);
      wrapper.appendChild(el);
    };

    if (Array.isArray(content)) {
      for (const rb of content) {
        if (rb?.type === 'text') renderText(rb.text || '');
      }
    } else if (typeof content === 'string' && content) {
      renderText(content);
    } else if (content && typeof content === 'object') {
      wrapper.appendChild(jsonBox(content));
    }
    frag.appendChild(wrapper);

  } else {
    // Unknown block type – show as collapsible JSON
    const body = div('');
    body.appendChild(jsonBox(block));
    frag.appendChild(makeDetails(`${type} block`, body, false));
  }

  return frag;
}

// ── Message-chain renderer ───────────────────────────────────
function renderMessageChain(raw) {
  const container = div('');

  let messages = raw;
  if (typeof raw === 'string') {
    try { messages = JSON.parse(raw); }
    catch {
      container.appendChild(codeBlock(String(raw).substring(0, 2000)));
      return container;
    }
  }

  if (!Array.isArray(messages) || !messages.length) {
    container.appendChild(alert('No messages in chain.', 'info'));
    return container;
  }

  for (const msg of messages) {
    const role    = msg.role    || 'unknown';
    const content = msg.content ?? '';

    // System prompt → collapsible
    if (role === 'system') {
      const inner = div('');
      if (typeof content === 'string') {
        inner.appendChild(renderMarkdown(content));
      } else if (Array.isArray(content)) {
        for (const b of content) inner.appendChild(renderContentBlock(b));
      }
      container.appendChild(makeDetails('⚙️ System prompt', inner, false));
      continue;
    }

    const chatRole = role === 'user' ? 'user' : 'assistant';
    // Unknown roles (tool messages etc.) get a wrench avatar
    const avatar   = role === 'user' ? '👤' : (role === 'assistant' ? '🤖' : '🔧');

    const msgEl    = div(`chat-msg ${chatRole}`);
    const avatarEl = div('chat-avatar');
    avatarEl.textContent = avatar;
    const bubble   = div('chat-bubble');

    if (typeof content === 'string') {
      if (content.trim()) bubble.appendChild(renderMarkdown(content));
    } else if (Array.isArray(content)) {
      for (const block of content) {
        if (block && typeof block === 'object') {
          bubble.appendChild(renderContentBlock(block));
        } else {
          bubble.appendChild(document.createTextNode(String(block)));
        }
      }
    } else {
      bubble.textContent = JSON.stringify(content);
    }

    msgEl.appendChild(avatarEl);
    msgEl.appendChild(bubble);
    container.appendChild(msgEl);
  }

  return container;
}

// ── Session info card ────────────────────────────────────────
function renderSessionCard(session) {
  const card = div('info-card');
  const grid = div('info-grid');

  const mainFields = [
    ['Session ID',     'session_id'],
    ['User ID',        'user_id'],
    ['Title',          'title'],
    ['Task Type',      'task_type'],
    ['Mode',           'mode'],
    ['Question Type',  'question_type'],
    ['Created',        'create_time'],
    ['Updated',        'update_time'],
  ];

  for (const [label, key] of mainFields) {
    const val = session[key];
    if (val != null && val !== '' && val !== 'null' && val !== 'None') {
      const item = div('');
      item.innerHTML = `<div class="info-label">${esc(label)}</div>`
                     + `<div class="info-value">${esc(String(val))}</div>`;
      grid.appendChild(item);
    }
  }
  card.appendChild(grid);

  // Extra optional fields
  const extraKeys = ['ticket_id', 'active_skill_ids', 'pending_proxy', 'evidence', 'site_info'];
  const extras = {};
  for (const k of extraKeys) {
    const v = session[k];
    if (v != null && v !== '' && v !== 'null' && v !== 'None') extras[k] = v;
  }

  if (Object.keys(extras).length) {
    const inner = div('');
    for (const [k, v] of Object.entries(extras)) {
      const item = div('');
      item.style.marginBottom = '8px';
      let parsed = null;
      if (typeof v === 'string') try { parsed = JSON.parse(v); } catch {}
      else if (typeof v === 'object') parsed = v;

      if (parsed !== null) {
        const lbl = document.createElement('strong');
        lbl.textContent = k;
        item.appendChild(lbl);
        item.appendChild(jsonBox(parsed));
      } else {
        item.innerHTML = `<strong>${esc(k)}:</strong> ${esc(String(v))}`;
      }
      inner.appendChild(item);
    }
    card.appendChild(makeDetails('More fields', inner, false));
  }

  return card;
}

// ── Record renderer ──────────────────────────────────────────
const EMPTY_VALS = new Set(['null', 'None', '', '0', null, undefined]);

function isEmpty(v) {
  return v == null || EMPTY_VALS.has(String(v));
}

function renderRecord(idx, record, viewMode) {
  const frag = document.createDocumentFragment();

  const question    = record.question    || '';
  const answer      = record.answer      || '';
  const messagesRaw = record.messages    ?? '';
  const createTime  = record.create_time || '';
  const modelName   = record.model_name  || '';
  const like        = record.like;
  const hate        = record.hate;

  let feedbackIcons = '';
  if (!isEmpty(like)) feedbackIcons += ' 👍';
  if (!isEmpty(hate)) feedbackIcons += ' 👎';

  // ── Record header ──────────────────────────────────────────
  const header = div('record-header');
  const badge  = div('record-index');
  badge.textContent = String(idx + 1);
  header.appendChild(badge);

  if (createTime) {
    const t = document.createElement('span');
    t.textContent = String(createTime);
    header.appendChild(t);
  }
  if (modelName) {
    const m = document.createElement('span');
    m.innerHTML = `· <code>${esc(modelName)}</code>`;
    header.appendChild(m);
  }
  if (feedbackIcons) {
    const f = document.createElement('span');
    f.textContent = feedbackIcons;
    header.appendChild(f);
  }
  frag.appendChild(header);

  // ── Message body ───────────────────────────────────────────
  const hasMessages = messagesRaw
    && !['null', 'None', '[]', ''].includes(String(messagesRaw));

  if (viewMode === 'full' && hasMessages) {
    frag.appendChild(renderMessageChain(messagesRaw));
  } else {
    if (question) {
      const m = div('chat-msg user');
      m.innerHTML = `<div class="chat-avatar">👤</div>`;
      const b = div('chat-bubble');
      b.appendChild(renderMarkdown(question));
      m.appendChild(b);
      frag.appendChild(m);
    }
    if (answer) {
      const m = div('chat-msg assistant');
      m.innerHTML = `<div class="chat-avatar">🤖</div>`;
      const b = div('chat-bubble');
      b.appendChild(renderMarkdown(answer));
      m.appendChild(b);
      frag.appendChild(m);
    }
    if (viewMode === 'full' && !hasMessages) {
      const cap = document.createElement('p');
      cap.style.cssText = 'color:var(--text-muted);font-size:0.8rem;margin:4px 0';
      cap.textContent   = 'No detailed message chain stored for this record.';
      frag.appendChild(cap);
    }
  }

  // ── Record metadata ────────────────────────────────────────
  const META_FIELDS = [
    'question_id', 'answer_id', 'task_type', 'lang', 'version',
    'vector_topk', 'text_topk', 'rerank_topk', 'kb_id',
    'use_slow_sql_prompt', 'user_type', 'slow_sql_node',
    'backup_diag_step', 'feedback_info', 'hate_info', 'report_type',
    'report_info', 'model_config',
  ];
  const meta = {};
  for (const f of META_FIELDS) {
    const v = record[f];
    if (!isEmpty(v)) meta[f] = v;
  }

  if (Object.keys(meta).length) {
    const grid = div('meta-grid');
    for (const [k, v] of Object.entries(meta)) {
      const item = div('meta-item');
      let parsed = null;
      if (typeof v === 'string') try { parsed = JSON.parse(v); } catch {}
      else if (typeof v === 'object') parsed = v;

      if (parsed !== null) {
        const lbl = document.createElement('div');
        lbl.className   = 'meta-key';
        lbl.textContent = k;
        item.appendChild(lbl);
        item.appendChild(jsonBox(parsed));
      } else {
        item.innerHTML = `<span class="meta-key">${esc(k)}:</span> <code>${esc(String(v))}</code>`;
      }
      grid.appendChild(item);
    }
    frag.appendChild(makeDetails('Record metadata', grid, false));
  }

  return frag;
}

// ── Results renderer ─────────────────────────────────────────
function renderResults(data, viewMode) {
  const results = document.getElementById('results');
  results.innerHTML = '';

  const { session, records } = data;

  // Session info
  results.appendChild(makeDetails('📋 Session Info', renderSessionCard(session), true));

  // Section heading
  const heading = div('section-heading');
  heading.innerHTML = `Conversation <span class="section-count">(${records.length} records)</span>`;
  results.appendChild(heading);

  if (!records.length) {
    results.appendChild(alert('No records found for this session.', 'warn'));
    return;
  }

  const hasAnyMessages = records.some(r => {
    const m = r.messages;
    return m && !['null', 'None', '[]', ''].includes(String(m));
  });

  // View-mode toggle
  const toggle = div('view-toggle');

  const mkBtn = (label, mode) => {
    const btn = document.createElement('button');
    btn.className   = 'view-btn' + (viewMode === mode ? ' active' : '');
    btn.textContent = label;
    if (mode === 'full' && !hasAnyMessages) {
      btn.disabled = true;
      btn.title    = 'No message chain data stored for this session.';
    } else {
      btn.onclick = () => {
        if (currentViewMode !== mode) {
          currentViewMode = mode;
          renderResults(currentData, mode);
        }
      };
    }
    return btn;
  };

  toggle.appendChild(mkBtn('Simple (Q&A only)',        'simple'));
  toggle.appendChild(mkBtn('Full agent chain (messages)', 'full'));
  results.appendChild(toggle);
  results.appendChild(document.createElement('hr'));

  for (let i = 0; i < records.length; i++) {
    results.appendChild(renderRecord(i, records[i], viewMode));
  }
}

// ── API calls ────────────────────────────────────────────────
async function apiTest(cfg) {
  const res = await fetch('/api/db/test', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(cfg),
  });
  return res.json();
}

async function apiSession(sessionId, cfg) {
  const res = await fetch(`/api/session/${encodeURIComponent(sessionId)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(cfg),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || res.statusText);
  }
  return res.json();
}

// ── DB form helpers ──────────────────────────────────────────
function getFormCfg() {
  return {
    host:     document.getElementById('dbHost').value.trim() || 'localhost',
    port:     parseInt(document.getElementById('dbPort').value, 10) || 5432,
    dbname:   document.getElementById('dbName').value.trim(),
    user:     document.getElementById('dbUser').value.trim(),
    password: document.getElementById('dbPass').value,
  };
}

function fillForm(cfg) {
  if (cfg.host)   document.getElementById('dbHost').value = cfg.host;
  if (cfg.port)   document.getElementById('dbPort').value = cfg.port;
  if (cfg.dbname) document.getElementById('dbName').value = cfg.dbname;
  if (cfg.user)   document.getElementById('dbUser').value = cfg.user;
  if (cfg.password) document.getElementById('dbPass').value = cfg.password;
}

function setDbStatus(node) {
  const el = document.getElementById('dbStatus');
  el.innerHTML = '';
  if (node) el.appendChild(node);
}

// ── Load session ─────────────────────────────────────────────
async function loadSession() {
  const sessionId = document.getElementById('sessionInput').value.trim();
  if (!sessionId) return;

  const results = document.getElementById('results');
  const loading = div('loading-msg');
  loading.innerHTML = '<span class="spinner"></span>Fetching data …';
  results.innerHTML = '';
  results.appendChild(loading);

  const cfg = getFormCfg();
  if (!cfg.dbname || !cfg.user) {
    results.innerHTML = '';
    results.appendChild(alert('Please configure and connect to the database first (sidebar).', 'warn'));
    return;
  }

  try {
    const data = await apiSession(sessionId, cfg);
    currentData     = data;
    currentViewMode = 'simple';
    renderResults(data, 'simple');
  } catch (err) {
    results.innerHTML = '';
    results.appendChild(alert(`Error: ${err.message}`, 'err'));
  }
}

// ── Init ─────────────────────────────────────────────────────
async function init() {
  // 1. Try to restore non-sensitive fields from localStorage
  try {
    const saved = JSON.parse(localStorage.getItem(DB_STORAGE_KEY) || 'null');
    if (saved) fillForm(saved);
  } catch {}

  // 2. Fetch server-side defaults (including password from secrets.toml)
  try {
    const defaults = await fetch('/api/defaults').then(r => r.json());
    // Only fill fields that are still empty, so localStorage wins for host/port/dbname/user
    const cfg = getFormCfg();
    if (!cfg.host   || cfg.host   === 'localhost') if (defaults.host)   document.getElementById('dbHost').value = defaults.host;
    if (cfg.port    === 5432)                      if (defaults.port)   document.getElementById('dbPort').value = defaults.port;
    if (!cfg.dbname)                               if (defaults.dbname) document.getElementById('dbName').value = defaults.dbname;
    if (!cfg.user)                                 if (defaults.user)   document.getElementById('dbUser').value = defaults.user;
    // Always fill password from server secrets (not stored locally)
    if (defaults.password) document.getElementById('dbPass').value = defaults.password;

    // Auto-test if all required fields are filled
    const ready = getFormCfg();
    if (ready.dbname && ready.user) {
      const result = await apiTest(ready);
      if (result.ok) {
        setDbStatus(alert('✓ Connected', 'ok'));
        // Save non-sensitive fields
        localStorage.setItem(DB_STORAGE_KEY, JSON.stringify({
          host: ready.host, port: ready.port,
          dbname: ready.dbname, user: ready.user,
        }));
      }
    }
  } catch {}

  // DB form submission
  document.getElementById('dbForm').addEventListener('submit', async e => {
    e.preventDefault();
    const btn = document.getElementById('connectBtn');
    btn.disabled    = true;
    btn.textContent = 'Connecting…';
    setDbStatus(null);

    const cfg = getFormCfg();
    try {
      const result = await apiTest(cfg);
      if (result.ok) {
        setDbStatus(alert('✓ Connected', 'ok'));
        localStorage.setItem(DB_STORAGE_KEY, JSON.stringify({
          host: cfg.host, port: cfg.port,
          dbname: cfg.dbname, user: cfg.user,
        }));
      } else {
        setDbStatus(alert(`Connection failed: ${result.error}`, 'err'));
      }
    } catch (err) {
      setDbStatus(alert(`Error: ${err.message}`, 'err'));
    } finally {
      btn.disabled    = false;
      btn.textContent = 'Connect';
    }
  });

  // Load button + Enter key
  document.getElementById('loadBtn').addEventListener('click', loadSession);
  document.getElementById('sessionInput').addEventListener('keydown', e => {
    if (e.key === 'Enter') loadSession();
  });

  // Sidebar toggle
  document.getElementById('sidebarToggle').addEventListener('click', () => {
    const sidebar = document.getElementById('sidebar');
    const btn     = document.getElementById('sidebarToggle');
    sidebar.classList.toggle('collapsed');
    btn.textContent = sidebar.classList.contains('collapsed') ? '▶' : '◀';
  });
}

document.addEventListener('DOMContentLoaded', init);
