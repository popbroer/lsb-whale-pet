'use strict';

/**
 * 把回复灌回 Codex 当前会话。
 *
 * 走 `codex exec resume <session-id> --json -`：用 stdin 传 prompt，避开 Windows 引号地狱；
 * --json 按行吐事件，我们只关心 agent_message / turn.completed。
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const HOME = os.homedir();
const SESSIONS = process.env.WHALE_CODEX_SESSIONS || path.join(HOME, '.codex', 'sessions');

function walk(dir, out, depth = 0) {
  if (depth > 6) return;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (_) {
    return;
  }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out, depth + 1);
    else if (e.name.endsWith('.jsonl')) {
      try {
        const st = fs.statSync(p);
        out.push({ path: p, mtime: st.mtimeMs, size: st.size });
      } catch (_) {}
    }
  }
}

/** 最近的 Codex 会话：返回 id / cwd / 文件 */
function findLatestSession() {
  const all = [];
  walk(SESSIONS, all);
  if (!all.length) return null;
  all.sort((a, b) => b.mtime - a.mtime);
  const newest = all[0];

  let id = null;
  let cwd = null;
  try {
    const fd = fs.openSync(newest.path, 'r');
    const buf = Buffer.alloc(64 * 1024);
    const n = fs.readSync(fd, buf, 0, buf.length, 0);
    fs.closeSync(fd);
    const first = buf.slice(0, n).toString('utf8').split('\n')[0];
    const meta = JSON.parse(first);
    const p = meta.payload || {};
    id = p.session_id || p.id || null;
    cwd = p.cwd || null;
  } catch (_) {}

  if (!id) {
    const m = path.basename(newest.path).match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
    if (m) id = m[1];
  }

  return {
    id,
    cwd: cwd || HOME,
    path: newest.path,
    mtime: newest.mtime,
    idleMs: Date.now() - newest.mtime,
  };
}

/** 把用户消息里的系统包裹、附件清单、问答回执清掉，只留人话 */
function cleanUserText(text) {
  if (!text) return '';
  let t = String(text);

  t = t.replace(/<send_user_message_question_reply>[\s\S]*?<\/send_user_message_question_reply>/g, '（回答了一个选择）');
  t = t.replace(/<environment_context>[\s\S]*?<\/environment_context>/g, '');
  t = t.replace(/<turn_aborted>[\s\S]*?<\/turn_aborted>/g, '');
  t = t.replace(/<turn_aborted>[\s\S]*$/g, '');
  t = t.replace(/<[a-z_]{4,40}>\s*.*?interrupted.*?$/gim, '');
  t = t.replace(/<user_instructions>[\s\S]*?<\/user_instructions>/g, '');
  t = t.replace(/<[^>]{1,40}>[\s\S]*?<\/[^>]{1,40}>/g, (m) => (m.length > 400 ? '' : m));

  // AGENTS.md 是整段注入的仓库说明，不是用户说的话，整条丢掉
  if (/^\s*#\s*AGENTS\.md instructions/i.test(t)) return '';
  // 附件清单：只删清单本身，保留后面的正文
  t = t.replace(/^#\s*Files mentioned by the user:\s*$/gim, '');
  t = t.replace(/^## .*$/gm, '');
  t = t.replace(/^Image attachment:.*$/gm, '');
  t = t.replace(/^\s*\n/gm, '');

  t = t.replace(/[ \t]{2,}/g, ' ').replace(/\n{2,}/g, '\n').trim();

  if (!t || /^（?图片|附件/.test(t)) return '';
  return t;
}

function short(text, n) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n) + '…' : t;
}

function readPart(file, size, fromEnd) {
  let st;
  try {
    st = fs.statSync(file);
  } catch (_) {
    return '';
  }
  const len = Math.min(st.size, size);
  const buf = Buffer.alloc(len);
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    fs.readSync(fd, buf, 0, len, fromEnd ? Math.max(0, st.size - len) : 0);
  } catch (_) {
    return '';
  } finally {
    if (fd !== undefined) {
      try { fs.closeSync(fd); } catch (_) {}
    }
  }
  return buf.toString('utf8');
}

function textOfBlocks(blocks) {
  if (!Array.isArray(blocks)) return '';
  return blocks.map((b) => (typeof b === 'string' ? b : b.text || b.thinking || '')).filter(Boolean).join('\n');
}

/** 一个会话的画像：项目、首条需求、最后一句、最后回复、轮次 */
function summarizeSession(file, mtime) {
  const head = readPart(file, 160 * 1024, false);
  const tail = readPart(file, 1024 * 1024, true);

  let meta = null;
  for (const line of head.split('\n')) {
    if (!line.trim()) continue;
    let o;
    try {
      o = JSON.parse(line);
    } catch (_) {
      continue;
    }
    if (o.type === 'session_meta') {
      const p = o.payload || {};
      meta = { id: p.session_id || p.id, cwd: p.cwd, source: p.source, at: o.timestamp };
      break;
    }
  }

  /**
   * 同一个 rollout 里有两路消息：
   *   event_msg/item_completed  → 界面上真正发生的这一轮（新消息都走这里）
   *   response_item/message     → 模型请求里的原始对话（resume 时会把历史整段回放进来）
   * 两路混着读会重复、还会把回放的历史当成"刚说的"，所以优先只认 event_msg，
   * 没有 event_msg 的老文件才退回 response_item。
   */
  const evt = { users: [], assistants: [] };
  const raw = { users: [], assistants: [] };
  const completions = [];
  let turns = 0;
  let order = 0;

  let tailFirstUser = '';
  const push = (bucket, text, idx) => {
    if (!text) return;
    if (!tailFirstUser) tailFirstUser = text;
    bucket.push({ text, idx });
  };

  for (const line of tail.split('\n')) {
    if (!line.trim()) continue;
    order += 1;
    let o;
    try {
      o = JSON.parse(line);
    } catch (_) {
      continue;
    }
    const pl = o.payload || {};

    if (o.type === 'event_msg' && pl.type === 'item_completed' && pl.item) {
      const it = pl.item;
      if (it.type === 'UserMessage') {
        turns += 1;
        push(evt.users, cleanUserText(textOfBlocks(it.content)), order);
      } else if (it.type === 'AgentMessage') {
        const t = textOfBlocks(it.content).trim();
        if (t) evt.assistants.push({ text: t, idx: order });
      }
      continue;
    }
    // codex exec / resume 走的是 user_message / agent_message（没有 item_completed）
    if (o.type === 'event_msg' && pl.type === 'user_message' && pl.message) {
      turns += 1;
      push(evt.users, cleanUserText(pl.message), order);
      continue;
    }
    if (o.type === 'event_msg' && pl.type === 'agent_message' && pl.message) {
      evt.assistants.push({ text: String(pl.message).trim(), idx: order });
      continue;
    }
    if (o.type === 'event_msg' && pl.type === 'task_complete' && pl.last_agent_message) {
      completions.push({ text: pl.last_agent_message, idx: order });
      continue;
    }
    if (o.type === 'response_item' && pl.type === 'message') {
      const t = textOfBlocks(pl.content);
      if (pl.role === 'user') push(raw.users, cleanUserText(t), order);
      else if (pl.role === 'assistant' && t.trim()) raw.assistants.push({ text: t.trim(), idx: order });
    }
  }

  const useEvt = evt.users.length > 0;
  const users = useEvt ? evt.users : raw.users;
  const assistantPool = [...(useEvt ? evt.assistants : raw.assistants), ...completions].sort((a, b) => a.idx - b.idx);

  const lastOf = (arr) => (arr.length ? arr[arr.length - 1].text : '');
  const lastUser = lastOf(users);
  const lastAssistant = lastOf(assistantPool);

  // 标题取第一条真实用户消息（和 Codex 界面的会话名一致）
  let firstUser = '';
  for (const line of head.split('\n')) {
    if (!line.trim()) continue;
    let o;
    try {
      o = JSON.parse(line);
    } catch (_) {
      continue;
    }
    const pl = o.payload || {};
    let t = '';
    if (o.type === 'event_msg' && pl.type === 'item_completed' && pl.item && pl.item.type === 'UserMessage') {
      t = cleanUserText(textOfBlocks(pl.item.content));
    } else if (o.type === 'event_msg' && pl.type === 'user_message' && pl.message) {
      t = cleanUserText(pl.message);
    } else if (o.type === 'response_item' && pl.type === 'message' && pl.role === 'user') {
      t = cleanUserText(textOfBlocks(pl.content));
    }
    if (t) {
      firstUser = t;
      break;
    }
  }

  const cwd = (meta && meta.cwd) || '';
  const project = cwd
    ? cwd.replace(/\\/g, '/').replace(/^\/+/, '').split('/').filter(Boolean).slice(-1)[0]
    : '';

  return {
    id: (meta && meta.id) || null,
    path: file,
    cwd,
    project,
    source: (meta && meta.source) || null,
    // 头部窗口经常被 AGENTS.md 这类超长注入行占满，取不到第一条用户消息时
    // 用尾部扫描里见到的第一条兜底
    title: short(firstUser || tailFirstUser || lastUser || lastAssistant || '（空会话）', 40),
    lastUser: short(lastUser, 160),
    lastAssistant: short(lastAssistant, 260),
    turns,
    mtime,
    at: mtime,
  };
}

function listSessions(limit = 8) {
  const all = [];
  walk(SESSIONS, all);
  all.sort((a, b) => b.mtime - a.mtime);

  const out = [];
  const seenIds = new Set();
  for (const f of all) {
    if (out.length >= limit) break;
    if (f.size < 2 * 1024) continue;
    const s = summarizeSession(f.path, f.mtime);
    // 子代理线程不给回复用（source 里带 subagent 的通常不是主对话）
    if (s.source && typeof s.source === 'object' && s.source.subagent) continue;
    const key = s.id || f.path;
    if (seenIds.has(key)) continue;
    seenIds.add(key);
    if (!s.lastUser && !s.lastAssistant) continue;
    out.push(s);
  }
  return out;
}

/** 从会话日志尾部找最近一条助手输出（重启后也能立刻显示） */
function findLatestReply(sessionPath) {
  const p = sessionPath || (findLatestSession() || {}).path;
  if (!p) return null;
  let st;
  try {
    st = fs.statSync(p);
  } catch (_) {
    return null;
  }
  const size = Math.min(st.size, 512 * 1024);
  const buf = Buffer.alloc(size);
  let fd;
  try {
    fd = fs.openSync(p, 'r');
    fs.readSync(fd, buf, 0, size, Math.max(0, st.size - size));
  } catch (_) {
    return null;
  } finally {
    if (fd !== undefined) {
      try { fs.closeSync(fd); } catch (_) {}
    }
  }

  const lines = buf.toString('utf8').split('\n');
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i].trim();
    if (!line) continue;
    let o;
    try {
      o = JSON.parse(line);
    } catch (_) {
      continue;
    }
    const pl = o.payload || {};
    if (o.type === 'event_msg' && pl.type === 'task_complete' && pl.last_agent_message) {
      return { text: pl.last_agent_message, at: pl.completed_at ? pl.completed_at * 1000 : Date.now() };
    }
    if (o.type === 'event_msg' && pl.type === 'item_completed' && pl.item && pl.item.type === 'AgentMessage') {
      const text = (pl.item.content || []).map((c) => c.text || '').filter(Boolean).join('\n');
      if (text) return { text, at: o.timestamp ? Date.parse(o.timestamp) : Date.now() };
    }
    if (o.type === 'response_item' && pl.type === 'message' && pl.role === 'assistant') {
      const text = (pl.content || []).map((c) => c.text || '').filter(Boolean).join('\n');
      if (text) return { text, at: o.timestamp ? Date.parse(o.timestamp) : Date.now() };
    }
  }
  return null;
}

function codexCommand() {
  const exe = process.env.WHALE_CODEX_BIN || 'codex';
  return exe;
}

/**
 * 发一条回复。返回 { child, promise }
 * onEvent: ({type:'start'|'message'|'done'|'error'|'stderr', ...})
 */
function runCodex(args, { cwd, prompt, onEvent }) {
  const cmd = `${codexCommand()} ${args.join(' ')}`;
  const child = spawn(cmd, {
    cwd: cwd || process.cwd(),
    shell: true,
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  let buf = '';
  child.stdout.on('data', (chunk) => {
    buf += chunk.toString('utf8');
    let idx;
    while ((idx = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (!line) continue;
      let ev;
      try {
        ev = JSON.parse(line);
      } catch (_) {
        continue; // 忽略 "Reading additional input from stdin..." 这类提示
      }
      if (ev.type === 'item.completed' && ev.item && ev.item.type === 'agent_message') {
        onEvent({ type: 'message', text: ev.item.text || '' });
      } else if (ev.type === 'turn.completed') {
        onEvent({ type: 'done', usage: ev.usage || null });
      } else if (ev.type === 'thread.started') {
        onEvent({ type: 'thread', id: ev.thread_id });
      } else if (ev.type === 'error' || ev.type === 'turn.failed') {
        onEvent({ type: 'error', text: ev.message || ev.error || '执行失败' });
      }
    }
  });

  child.stderr.on('data', (chunk) => {
    const text = chunk.toString('utf8').trim();
    if (text) onEvent({ type: 'stderr', text });
  });

  child.on('error', (err) => onEvent({ type: 'error', text: String(err.message || err) }));
  child.on('close', (code) => onEvent({ type: 'exit', code }));

  try {
    child.stdin.write(prompt.endsWith('\n') ? prompt : prompt + '\n');
    child.stdin.end();
  } catch (_) {}

  return child;
}

function startReply(prompt, onEvent, opts = {}) {
  const session = opts.session || findLatestSession();
  if (!session || !session.id) {
    onEvent({ type: 'error', text: '没找到可续写的 Codex 会话' });
    return null;
  }
  onEvent({ type: 'start', sessionId: session.id, cwd: session.cwd });
  const child = runCodex(
    ['exec', 'resume', session.id, '--json', '--skip-git-repo-check', '-'],
    { cwd: session.cwd, prompt, onEvent }
  );
  return { child, session };
}

function findSessionById(id) {
  const all = [];
  walk(SESSIONS, all);
  const hit = all.find((f) => basenameSafe(f.path).includes(id));
  if (hit) return summarizeSession(hit.path, hit.mtime);
  return listSessions(20).find((x) => x.id === id) || null;
}

function basenameSafe(p) {
  return String(p).split(/[\\/]/).pop() || '';
}

module.exports = {
  findLatestSession,
  findLatestReply,
  listSessions,
  summarizeSession,
  findSessionById,
  summarizeSession,
  cleanUserText,
  startReply,
  runCodex,
};
