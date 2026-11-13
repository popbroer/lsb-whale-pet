'use strict';

/**
 * WorkBuddy 活动流（只读）。
 *
 * WorkBuddy 把「命令执行 / 文件访问 / 批量删除审批」写进
 * ~/.workbuddy/audit-log/YYYY-MM-DD.jsonl，这里 tail 它，翻译成宠物能播报的事件。
 * 注意：审计流只记录安全决策，不含对话正文；WorkBuddy 的对话在云端，本地没有可投递的入口，
 * 所以这个模块只做「看」，不做「回」。
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const HOME = os.homedir();
const AUDIT_DIR = process.env.WHALE_WB_AUDIT_DIR || path.join(HOME, '.workbuddy', 'audit-log');
const TICK_MS = 800;

function dayKey(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function short(text, n = 70) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n) + '…' : t;
}

/** 事件类型 → 宠物能念的一句话 */
function translate(obj) {
  const type = obj.eventType || '';
  const preview = short(obj.commandPreview || '');
  const at = Number(obj.timestamp) || Date.now();

  if (type === 'command-safety.sandbox-executed') {
    return { kind: 'tool', label: '执行命令', text: preview || '执行了一条命令', at, type };
  }
  if (type === 'file-safety.allow-listed') {
    return { kind: 'tool', label: '访问文件', text: preview || '访问了文件', at, type };
  }
  if (type === 'file-safety.bulk-delete.needs-approval') {
    return { kind: 'approval', label: '等待审批', text: preview || '有一个批量删除等你确认', at, type };
  }
  if (type === 'file-safety.bulk-delete.approved') {
    return { kind: 'approval-done', label: '已批准', text: preview || '批量删除已批准', at, type };
  }
  if (type === 'file-safety.bulk-delete.rejected') {
    return { kind: 'approval-done', label: '已拒绝', text: preview || '批量删除被拒绝了', at, type };
  }
  return null;
}

class WbFeed {
  constructor(onEvent, opts = {}) {
    this.onEvent = onEvent;
    this.dir = opts.dir || AUDIT_DIR;
    this.day = null;
    this.file = null;
    this.offset = 0;
    this.carry = '';
    this.seen = new Set();
    this.timer = null;
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

  open(initial) {
    const day = dayKey();
    const file = path.join(this.dir, `${day}.jsonl`);
    if (this.file === file && this.day === day) return;
    this.day = day;
    this.file = file;
    this.carry = '';
    try {
      // 首次启动直接跳到末尾，不回放历史
      this.offset = initial && fs.existsSync(file) ? fs.statSync(file).size : 0;
    } catch (_) {
      this.offset = 0;
    }
  }

  tick() {
    try {
      this.open(false);
      if (!this.file || !fs.existsSync(this.file)) return;
      const st = fs.statSync(this.file);
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
        const key = `${obj.toolCallId || ''}:${obj.eventType}`;
        if (obj.toolCallId && this.seen.has(key)) continue;
        if (obj.toolCallId) {
          if (this.seen.size > 500) this.seen.clear();
          this.seen.add(key);
        }

        const ev = translate(obj);
        if (!ev) continue;
        this.emit(ev);
      }
    } catch (_) {}
  }

  emit(ev) {
    // 审批事件不节流，其它工具事件至少间隔 800ms，避免刷屏
    const now = Date.now();
    if (ev.kind === 'tool' && now - this.lastEmitAt < 800) return;
    this.lastEmitAt = now;
    try {
      this.onEvent({ ...ev, provider: 'workbuddy' });
    } catch (_) {}
  }
}

module.exports = { WbFeed, translate, AUDIT_DIR };
