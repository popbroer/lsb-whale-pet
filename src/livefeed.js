'use strict';

/**
 * 实时字幕源：跟踪 Codex 与 Claude Code 的会话日志，抽成宠物的「思考 / 说话 / 动作」事件。
 *
 * Codex：~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl
 *   - event_msg/item_completed → AgentMessage（旁白）、Reasoning（本账号 summary 为空）、
 *     CommandExecution、SubAgentActivity
 *   - event_msg/task_started / task_complete → 开始 / 结束
 *   - response_item/message(role=assistant) → 旁白文本
 *   注意：Codex 的思维链在日志里是加密的（encrypted_content），拿不到原文，只能拿到旁白与动作。
 *
 * Claude Code：~/.claude/projects/<project>/<session>.jsonl
 *   - assistant 消息里的 thinking 块是明文，可以真正「看到思考」
 *   - text 块 → 正在说的话；tool_use → 正在做的动作
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const HOME = os.homedir();
const SCAN_MS = 5000;
const TICK_MS = 400;
const MAX_TAIL = 256 * 1024;

const ROOTS = [
  { provider: 'codex', dir: process.env.WHALE_CODEX_SESSIONS || path.join(HOME, '.codex', 'sessions') },
  { provider: 'claude', dir: process.env.WHALE_CLAUDE_SESSIONS || path.join(HOME, '.claude', 'projects') },
];

const TOOL_LABEL = {
  exec: '运行命令',
  shell: '运行命令',
  bash: '运行命令',
  apply_patch: '修改文件',
  write_file: '写文件',
  read_file: '读文件',
  web_search: '搜索网页',
  update_plan: '更新计划',
  Skill: '调用技能',
  Task: '子代理',
  Read: '读文件',
  Edit: '改文件',
  Write: '写文件',
  Grep: '搜索代码',
  Glob: '找文件',
  Bash: '运行命令',
  WebFetch: '抓网页',
};

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

function joinBlocks(blocks) {
  if (!Array.isArray(blocks)) return '';
  return blocks
    .map((b) => {
      if (typeof b === 'string') return b;
      return b.text || b.thinking || b.summary_text || '';
    })
    .filter(Boolean)
    .join('\n');
}

/** 去掉 markdown 噪音，压成一段适合气泡显示的文本 */
function clean(text) {
  if (!text) return '';
  return String(text)
    .replace(/```[\s\S]*?```/g, ' … ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/`([^`]{1,80})`/g, '$1')
    .replace(/^#{1,6}\s*/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\s*\n\s*/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function shortCmd(cmd) {
  const s = Array.isArray(cmd) ? cmd.join(' ') : String(cmd || '');
  const stripped = s
    .replace(/^.*?(pwsh\.exe|powershell\.exe|cmd\.exe|bash\.exe)\S*\s*(-Command|-c)?\s*/i, '')
    .replace(/^"|"$/g, '')
    .trim();
  return stripped.slice(0, 70);
}

/** codex 行 → 事件 */
function fromCodex(obj, ts) {
  const type = obj.type;
  const p = obj.payload || {};

  if (type === 'event_msg') {
    if (p.type === 'task_started') return { kind: 'start', ts };
    if (p.type === 'task_complete') {
      return { kind: 'done', ts, text: clean(p.last_agent_message || ''), durationMs: p.duration_ms || 0 };
    }
    if (p.type === 'turn_aborted') return { kind: 'done', ts, text: '这一轮被打断了。', durationMs: 0 };
    if (p.type === 'item_completed') {
      const item = p.item || {};
      if (item.type === 'AgentMessage') {
        const text = clean(joinBlocks(item.content));
        if (text) return { kind: 'say', ts, text };
      }
      if (item.type === 'Reasoning') {
        const text = clean(joinBlocks(item.summary_text) || joinBlocks(item.raw_content));
        if (text) return { kind: 'think', ts, text };
      }
      if (item.type === 'CommandExecution') {
        const cmd = shortCmd((item.parsed_cmd && item.parsed_cmd[0] && item.parsed_cmd[0].cmd) || item.command);
        if (cmd) return { kind: 'tool', ts, text: cmd, label: '运行命令' };
      }
      if (item.type === 'SubAgentActivity') {
        return { kind: 'tool', ts, text: `子代理 ${item.kind || '活动'}`, label: '子代理' };
      }
    }
    return null;
  }

  if (type === 'response_item') {
    if (p.type === 'message' && p.role === 'assistant') {
      const text = clean(joinBlocks(p.content));
      if (text) return { kind: 'say', ts, text };
    }
    if (p.type === 'reasoning') {
      const text = clean(joinBlocks(p.summary));
      if (text) return { kind: 'think', ts, text };
    }
    if (p.type === 'function_call' || p.type === 'custom_tool_call') {
      const label = TOOL_LABEL[p.name] || `调用 ${p.name || '工具'}`;
      return { kind: 'tool', ts, text: label, label };
    }
  }
  return null;
}

/** claude 行 → 事件（可能一条消息里有多个块，返回数组） */
function fromClaude(obj, ts) {
  const type = obj.type;
  const msg = obj.message || {};

  if (type === 'assistant' && Array.isArray(msg.content)) {
    const out = [];
    for (const block of msg.content) {
      if (block.type === 'thinking') {
        const text = clean(block.thinking);
        if (text) out.push({ kind: 'think', ts, text });
      } else if (block.type === 'text') {
        const text = clean(block.text);
        if (text) out.push({ kind: 'say', ts, text });
      } else if (block.type === 'tool_use') {
        const label = TOOL_LABEL[block.name] || block.name;
        const hint = block.input && (block.input.file_path || block.input.path || block.input.skill || block.input.command);
        out.push({ kind: 'tool', ts, text: hint ? String(hint).slice(0, 60) : label, label });
      }
    }
    return out;
  }

  if (type === 'system' && obj.subtype === 'stop_hook_summary') return { kind: 'done', ts, text: '', durationMs: 0 };
  if (type === 'result') return { kind: 'done', ts, text: '', durationMs: obj.duration_ms || 0 };
  return null;
}

function parseLine(provider, line) {
  let obj;
  try {
    obj = JSON.parse(line);
  } catch (_) {
    return null;
  }
  const raw = obj.timestamp ? Date.parse(obj.timestamp) : 0;
  const ts = Number.isFinite(raw) && raw > 0 ? raw : Date.now();
  return provider === 'codex' ? fromCodex(obj, ts) : fromClaude(obj, ts);
}

class LiveFeed {
  constructor(onEvent, opts = {}) {
    this.onEvent = onEvent;
    this.maxTail = opts.maxTail || MAX_TAIL;
    this.current = null;
    this.offset = 0;
    this.carry = '';
    this.lastScan = 0;
    this.lastText = '';
    this.lastTextAt = 0;
    this.skipBefore = 0;
    this.timer = null;
  }

  start() {
    this.scan(true);
    this.timer = setInterval(() => this.tick(), TICK_MS);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** 找最近被写过的会话文件 */
  scan(initial) {
    this.lastScan = Date.now();
    const all = [];
    for (const root of ROOTS) {
      const out = [];
      walk(root.dir, out);
      for (const f of out) all.push({ ...f, provider: root.provider });
    }
    if (!all.length) {
      this.current = null;
      return;
    }
    all.sort((a, b) => b.mtime - a.mtime);
    const newest = all[0];

    // 超过 30 分钟没动静就不跟了，避免把旧会话当成实时
    if (!initial && Date.now() - newest.mtime > 30 * 60 * 1000) return;

    if (!this.current || this.current.path !== newest.path) {
      // 首次启动：直接跳到末尾，不回放历史；
      // 切到别的大会话：只读尾部；切到刚建的新会话：从头读。
      if (initial) {
        this.offset = newest.size;
        this.skipBefore = 0;
      } else if (newest.size > 2 * 1024 * 1024) {
        // 切到一个有历史的大会话：只读尾部，并且丢掉 10 分钟前的旧事件，避免回放
        this.offset = Math.max(0, newest.size - this.maxTail);
        this.skipBefore = Date.now() - 10 * 60 * 1000;
      } else {
        this.offset = 0;
        this.skipBefore = 0;
      }
      this.carry = '';
      this.current = newest;
      return;
    }
    this.current = newest;
  }

  tick() {
    if (Date.now() - this.lastScan > SCAN_MS) this.scan(false);
    if (!this.current) return;
    this.readAppended();
  }

  readAppended() {
    const f = this.current;
    let st;
    try {
      st = fs.statSync(f.path);
    } catch (_) {
      this.current = null;
      return;
    }
    if (st.size < this.offset) {
      // 文件被截断/重建
      this.offset = 0;
      this.carry = '';
    }
    if (st.size === this.offset) return;

    const len = Math.min(st.size - this.offset, this.maxTail);
    const buf = Buffer.alloc(len);
    let fd;
    try {
      fd = fs.openSync(f.path, 'r');
      fs.readSync(fd, buf, 0, len, st.size - len);
    } catch (_) {
      return;
    } finally {
      if (fd !== undefined) {
        try { fs.closeSync(fd); } catch (_) {}
      }
    }

    this.offset = st.size;
    const chunk = this.carry + buf.toString('utf8');
    const lines = chunk.split('\n');
    this.carry = lines.pop() || '';

    for (const line of lines) {
      if (!line.trim()) continue;
      const parsed = parseLine(f.provider, line);
      if (!parsed) continue;
      const list = Array.isArray(parsed) ? parsed : [parsed];
      for (const ev of list) this.emit(ev, f.provider);
    }
  }

  emit(ev, provider) {
    if (this.skipBefore && ev.kind !== 'start' && ev.ts && ev.ts < this.skipBefore) return;
    if (ev.kind === 'think' || ev.kind === 'say') {
      const key = ev.text.slice(0, 120);
      if (key === this.lastText && Date.now() - this.lastTextAt < 4000) return;
      this.lastText = key;
      this.lastTextAt = Date.now();
    }
    try {
      this.onEvent({ ...ev, provider });
    } catch (_) {}
  }
}

module.exports = { LiveFeed, parseLine, clean, ROOTS };
