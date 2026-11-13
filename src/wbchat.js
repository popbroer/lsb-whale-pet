'use strict';

/**
 * WorkBuddy 对话流（只读）。
 *
 * 之前只有 audit-log 可读，那里面只有「命令执行 / 文件访问 / 删除审批」，
 * 没有对话正文，所以看起来像「没对接 WorkBuddy」。
 *
 * 其实 WorkBuddy 会把完整会话写在
 *   ~/.workbuddy/projects/<工作区slug>/<sessionId>.jsonl
 * 格式和 Claude Code 很像：
 *   session-meta / message(role) / reasoning / function_call / function_call_result
 *   ai-title（AI 生成的干净标题）/ credit-usage
 *
 * 这里 tail 最新的那个文件，翻译成实时字幕事件。
 * 回复仍然做不到：本地没有任何可投递的入口（远程控制的 HTTP 服务要配对 token），
 * 所以只做「看」。
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const HOME = os.homedir();
const ROOT = process.env.WHALE_WB_PROJECTS || path.join(HOME, '.workbuddy', 'projects');
const TICK_MS = 800;
const SCAN_MS = 4000;
const TAIL_BYTES = 512 * 1024;

function short(text, n = 90) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n) + '…' : t;
}

/** 用户消息里除了 <user_query> 还有一大堆 system-reminder，只取人话 */
function userQuery(text) {
  const t = String(text || '');
  const m = /<user_query>([\s\S]*?)<\/user_query>/i.exec(t);
  if (m) return m[1].trim();
  // 没有 <user_query> 时，把注入块整体去掉
  return t
    .replace(/<system-reminder[\s\S]*?<\/system-reminder>/gi, ' ')
    .replace(/<[a-z_-]{4,40}>[\s\S]*?<\/[a-z_-]{4,40}>/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function blocksText(blocks) {
  if (!Array.isArray(blocks)) return '';
  return blocks
    .map((b) => (b && (b.text || b.content)) || '')
    .filter(Boolean)
    .join('\n');
}

/** 单行 JSON → 字幕事件 */
function translate(obj) {
  const type = obj.type;

  if (type === 'message') {
    const text = blocksText(obj.content);
    if (obj.role === 'user') {
      const q = userQuery(text);
      if (!q) return null;
      return { kind: 'start', text: short(q, 70) };
    }
    if (obj.role === 'assistant') {
      const t = blocksText(obj.content).trim();
      if (!t) return null;
      return { kind: 'say', text: t };
    }
    return null;
  }

  if (type === 'reasoning') {
    const t = blocksText(obj.rawContent) || blocksText(obj.content);
    if (!t.trim()) return null;
    return { kind: 'think', text: short(t, 160) };
  }

  if (type === 'function_call') {
    const name = obj.name || '工具';
    let arg = '';
    try {
      const a = typeof obj.arguments === 'string' ? JSON.parse(obj.arguments) : obj.arguments || {};
      arg = a.command || a.file_path || a.path || a.query || a.url || a.pattern || '';
    } catch (_) {}
    return { kind: 'tool', text: short(arg || name, 60), label: name };
  }

  return null;
}

function walkSessions(root, out = [], depth = 0) {
  if (depth > 3) return out;
  let entries = [];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch (_) {
    return out;
  }
  for (const e of entries) {
    const p = path.join(root, e.name);
    if (e.isDirectory()) walkSessions(p, out, depth + 1);
    else if (e.name.endsWith('.jsonl') && !e.name.includes('.file-rollback')) {
      try {
        const st = fs.statSync(p);
        out.push({ path: p, mtime: st.mtimeMs, size: st.size, project: path.basename(root) });
      } catch (_) {}
    }
  }
  return out;
}

function readHead(file, bytes = 96 * 1024) {
  try {
    const st = fs.statSync(file);
    const len = Math.min(st.size, bytes);
    const buf = Buffer.alloc(len);
    const fd = fs.openSync(file, 'r');
    try {
      fs.readSync(fd, buf, 0, len, 0);
    } finally {
      fs.closeSync(fd);
    }
    return buf.toString('utf8');
  } catch (_) {
    return '';
  }
}

function readTail(file, bytes = TAIL_BYTES) {
  try {
    const st = fs.statSync(file);
    const len = Math.min(st.size, bytes);
    const buf = Buffer.alloc(len);
    const fd = fs.openSync(file, 'r');
    try {
      fs.readSync(fd, buf, 0, len, Math.max(0, st.size - len));
    } finally {
      fs.closeSync(fd);
    }
    return buf.toString('utf8');
  } catch (_) {
    return '';
  }
}

/** 会话画像：标题、项目、最后一问一答 */
function summarize(file, meta) {
  const head = readHead(file);
  const tail = readTail(file);

  let title = '';
  let cwd = '';
  let sessionId = '';
  for (const line of head.split('\n')) {
    if (!line.trim()) continue;
    let o;
    try {
      o = JSON.parse(line);
    } catch (_) {
      continue;
    }
    if (o.type === 'ai-title' && o.aiTitle) title = String(o.aiTitle).trim();
    if (o.type === 'session-meta') {
      sessionId = o.sessionId || sessionId;
      cwd = (o.meta && o.meta.cwd) || o.cwd || cwd;
    }
    // cwd 散落在 message / ai-title 这类行里
    if (!cwd && o.cwd) cwd = o.cwd;
    if (title && sessionId) break;
  }

  let lastUser = '';
  let lastAssistant = '';
  let turns = 0;
  for (const line of tail.split('\n')) {
    if (!line.trim()) continue;
    let o;
    try {
      o = JSON.parse(line);
    } catch (_) {
      continue;
    }
    if (o.type !== 'message') continue;
    if (o.role === 'user') {
      const q = userQuery(blocksText(o.content));
      if (q) {
        turns += 1;
        lastUser = q;
      }
    } else if (o.role === 'assistant') {
      const t = blocksText(o.content).trim();
      if (t) lastAssistant = t;
    }
  }

  const project = cwd ? String(cwd).split(/[\\/]/).filter(Boolean).pop() : '';
  return {
    kind: 'workbuddy',
    id: sessionId || path.basename(file, '.jsonl'),
    path: file,
    cwd,
    project,
    title: short(title || lastUser || lastAssistant || '（WorkBuddy 会话）', 40),
    lastUser: short(lastUser, 160),
    lastAssistant: short(lastAssistant, 260),
    turns,
    mtime: meta.mtime,
    readonly: true,
  };
}

function listSessions(limit = 6) {
  const all = walkSessions(ROOT);
  all.sort((a, b) => b.mtime - a.mtime);
  const out = [];
  for (const f of all) {
    if (out.length >= limit) break;
    if (f.size < 1024) continue;
    const s = summarize(f.path, f);
    if (!s.lastUser && !s.lastAssistant) continue;
    out.push(s);
  }
  return out;
}

class WbChat {
  constructor(onEvent, opts = {}) {
    this.onEvent = onEvent;
    this.root = opts.root || ROOT;
    this.file = null;
    this.offset = 0;
    this.carry = '';
    this.timer = null;
    this.scanAt = 0;
    this.lastEmitAt = 0;
  }

  start() {
    this.open(true);
    this.timer = setInterval(() => this.tick(), TICK_MS);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** 找最近被写过的会话文件；initial 时直接跳到末尾，不回放历史 */
  open(initial) {
    const all = walkSessions(this.root);
    if (!all.length) return;
    all.sort((a, b) => b.mtime - a.mtime);
    const newest = all[0];
    if (this.file === newest.path) return;

    this.file = newest.path;
    this.carry = '';
    // 无论首次还是切换，都直接跳到末尾：字幕只播「现在正在发生」的，
    // 否则切到另一个会话时会把它的历史一次性回放出来
    this.offset = newest.size;
    this.scanAt = Date.now();
  }

  tick() {
    try {
      const now = Date.now();
      if (now - this.scanAt > SCAN_MS) {
        this.scanAt = now;
        this.open(false);
      }
      if (!this.file) {
        this.open(true);
        return;
      }

      let st;
      try {
        st = fs.statSync(this.file);
      } catch (_) {
        // 文件被归档/删除，重新找
        this.file = null;
        return;
      }
      if (st.size < this.offset) {
        this.offset = 0;
        this.carry = '';
      }
      if (st.size === this.offset) return;

      const len = st.size - this.offset;
      const buf = Buffer.alloc(len);
      const fd = fs.openSync(this.file, 'r');
      try {
        fs.readSync(fd, buf, 0, len, this.offset);
      } finally {
        fs.closeSync(fd);
      }
      this.offset = st.size;

      const chunk = this.carry + buf.toString('utf8');
      const lines = chunk.split('\n');
      this.carry = lines.pop() || '';

      for (const line of lines) {
        if (!line.trim()) continue;
        let obj;
        try {
          obj = JSON.parse(line);
        } catch (_) {
          continue;
        }
        const ev = translate(obj);
        if (!ev) continue;
        this.emit(ev);
      }
    } catch (_) {}
  }

  emit(ev) {
    const now = Date.now();
    // 工具/思考事件节流，避免一行一个事件刷屏
    if ((ev.kind === 'tool' || ev.kind === 'think') && now - this.lastEmitAt < 700) return;
    this.lastEmitAt = now;
    try {
      this.onEvent({ ...ev, provider: 'workbuddy', ts: now });
    } catch (_) {}
  }
}

module.exports = { WbChat, translate, listSessions, summarize, userQuery, ROOT };
