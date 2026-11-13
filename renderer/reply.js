'use strict';

const api = window.replyApi;

const el = {
  sub: document.getElementById('bar-sub'),
  sessions: document.getElementById('sessions'),
  count: document.getElementById('sessions-count'),
  ctxUser: document.getElementById('ctx-user'),
  ctxAssistant: document.getElementById('ctx-assistant'),
  ctxMeta: document.getElementById('ctx-meta'),
  input: document.getElementById('input'),
  status: document.getElementById('status'),
  send: document.getElementById('send'),
  close: document.getElementById('close'),
};

let sessions = [];
let currentId = null;

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function ago(ms) {
  const d = Math.max(0, Date.now() - ms);
  const m = Math.round(d / 60000);
  if (m < 1) return '刚刚';
  if (m < 60) return `${m} 分钟前`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} 小时前`;
  return `${Math.round(h / 24)} 天前`;
}

function setStatus(text, kind) {
  el.status.textContent = text;
  el.status.className = 'status' + (kind ? ' ' + kind : '');
}

function tailPath(p, n = 3) {
  const parts = String(p || '').replace(/^\\\\\?\\/, '').replace(/\\/g, '/').split('/').filter(Boolean);
  return parts.slice(-n).join('/');
}

function isLive(s) {
  return s.mtime && Date.now() - s.mtime < 60 * 1000;
}

function render() {
  el.count.textContent = sessions.length ? `${sessions.length} 个` : '';
  if (!sessions.length) {
    el.sessions.innerHTML = '<div class="empty">没找到可续写的会话</div>';
    return;
  }
  el.sessions.innerHTML = sessions
    .map(
      (s) => `
      <button class="sess ${s.id === currentId ? 'sel' : ''} ${s.readonly ? 'ro' : ''}" data-id="${esc(s.id)}">
        <span class="sess-title">${isLive(s) ? '<i class="live-dot"></i>' : ''}${esc(s.title)}${s.readonly ? '<b class="ro-tag">只读</b>' : ''}</span>
        <span class="sess-meta">${s.kind === 'workbuddy' ? 'WorkBuddy' : esc(tailPath(s.cwd))} · ${ago(s.mtime)}${isLive(s) ? ' · 正在跑' : ''}</span>
      </button>`
    )
    .join('');
}

function select(id) {
  currentId = id;
  const s = sessions.find((x) => x.id === id);
  render();
  if (!s) return;

  el.ctxUser.textContent = s.lastUser || '（这个会话里没有找到你的文本消息）';
  el.ctxAssistant.textContent = s.lastAssistant || '（它还没回复过）';
  el.ctxMeta.textContent = `${s.project || ''} · ${ago(s.mtime)}`;
  el.sub.textContent = s.readonly
    ? `WorkBuddy · 只读（可以看上下文，不能发）`
    : `${s.project || '未知项目'} · 会话 ${s.id.slice(0, 8)} · ${s.lastUser ? '可以接着聊' : '上下文较少'}`;
  const hint = document.querySelector('.sync-hint');
  if (hint) hint.style.display = s.readonly ? 'none' : '';
  el.send.disabled = !!s.readonly;
  el.input.disabled = !!s.readonly;
  el.input.placeholder = s.readonly
    ? 'WorkBuddy 的对话只能看，不能从这里发'
    : '接着这个会话说点什么…（Ctrl+Enter 发送）';

  if (s.readonly) {
    setStatus('WorkBuddy 会话：本地只有记录，没有可投递的入口，所以只能看', 'bad');
    return;
  }
  if (isLive(s)) {
    setStatus('这个会话刚刚还在写，建议等它停下来再发，避免两边同时写同一个会话', 'bad');
  } else if (!el.status.classList.contains('bad')) {
    setStatus('会在后台用 codex exec 续写这个会话（消耗 token）');
  }
  el.input.focus();
}

async function load() {
  try {
    sessions = await api.list();
  } catch (_) {
    sessions = [];
  }
  render();
  if (sessions.length) select(sessions[0].id);
  else setStatus('没有找到 Codex 会话，先跑一次 codex 再回来', 'bad');
}

async function send() {
  const text = el.input.value.trim();
  if (!text) {
    setStatus('写点什么再发', 'bad');
    return;
  }
  if (!currentId) {
    setStatus('先选一个会话', 'bad');
    return;
  }
  const cur = sessions.find((x) => x.id === currentId);
  if (cur && cur.readonly) {
    setStatus('WorkBuddy 会话只能看，不能从这里发', 'bad');
    return;
  }

  el.send.disabled = true;
  setStatus('正在交给 Codex…');

  const r = await api.send({ id: currentId, text });
  el.send.disabled = false;

  if (r && r.ok) {
    const where = r.title ? `「${r.title}」` : `会话 ${String(r.sessionId || '').slice(0, 8)}`;
    setStatus(`已发到 ${where} · 回复会在桌面上实时显示；Codex 里切一下会话就能看到`, 'ok');
    el.input.value = '';
    setTimeout(() => api.close(), 1600);
    return;
  }
  if (r && r.canceled) {
    setStatus('好，那我不动你的会话。');
    return;
  }
  setStatus((r && r.message) || '发送失败', 'bad');
}

el.sessions.addEventListener('click', (e) => {
  const btn = e.target.closest('.sess');
  if (btn) select(btn.dataset.id);
});

el.send.addEventListener('click', send);
el.close.addEventListener('click', () => api.close());

el.input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    send();
  }
  if (e.key === 'Escape') api.close();
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') api.close();
});

load();
