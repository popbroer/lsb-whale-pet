'use strict';

/**
 * WorkBuddy 对话流测试：user_query 提取、事件映射、会话画像。
 * 跑：node scripts/test-wbchat.js
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const wb = require('../src/wbchat');

let pass = 0;
let fail = 0;
function ok(name, fn) {
  try {
    fn();
    pass += 1;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    fail += 1;
    console.log(`  ✗ ${name}\n    ${err.message}`);
  }
}

console.log('WorkBuddy 对话流');

/* ---------------- 用户消息清洗 ---------------- */

ok('从 <user_query> 里取出人话', () =>
  assert.strictEqual(
    wb.userQuery('<system-reminder>\n一堆上下文\n</system-reminder>\n<user_query>帮我看看这个会不会被读到</user_query>'),
    '帮我看看这个会不会被读到'
  ));

ok('没有 user_query 时丢掉 system-reminder', () =>
  assert.strictEqual(wb.userQuery('<system-reminder>xx</system-reminder> 真正的内容'), '真正的内容'));

ok('空白消息返回空串', () => assert.strictEqual(wb.userQuery('<system-reminder>只有上下文</system-reminder>'), ''));

/* ---------------- 事件映射 ---------------- */

const t = wb.translate;

ok('用户消息 → start', () => {
  const ev = t({ type: 'message', role: 'user', content: [{ type: 'input_text', text: '<user_query>查一下天气</user_query>' }] });
  assert.strictEqual(ev.kind, 'start');
  assert.strictEqual(ev.text, '查一下天气');
});

ok('助手消息 → say', () => {
  const ev = t({ type: 'message', role: 'assistant', content: [{ type: 'text', text: '今天小雨。' }] });
  assert.strictEqual(ev.kind, 'say');
  assert.strictEqual(ev.text, '今天小雨。');
});

ok('reasoning → think（WorkBuddy 的思维链是明文）', () => {
  const ev = t({ type: 'reasoning', content: [], rawContent: [{ type: 'reasoning_text', text: '我先读一下目录结构。' }] });
  assert.strictEqual(ev.kind, 'think');
  assert.strictEqual(ev.text, '我先读一下目录结构。');
});

ok('空 reasoning 不产生事件', () => assert.strictEqual(t({ type: 'reasoning', content: [], rawContent: [] }), null));

ok('function_call → tool，带工具名', () => {
  const ev = t({ type: 'function_call', name: 'Bash', arguments: JSON.stringify({ command: 'ls -la' }) });
  assert.strictEqual(ev.kind, 'tool');
  assert.strictEqual(ev.label, 'Bash');
  assert.strictEqual(ev.text, 'ls -la');
});

ok('function_call 参数不是 JSON 也不崩', () => {
  const ev = t({ type: 'function_call', name: 'Read', arguments: 'not-json' });
  assert.strictEqual(ev.kind, 'tool');
  assert.strictEqual(ev.text, 'Read');
});

ok('未知类型返回 null', () => assert.strictEqual(t({ type: 'credit-usage' }), null));
ok('空助手消息返回 null', () => assert.strictEqual(t({ type: 'message', role: 'assistant', content: [] }), null));

/* ---------------- 会话画像 ---------------- */

const TMP = path.join(os.tmpdir(), 'whale-wb-test');
fs.rmSync(TMP, { recursive: true, force: true });
const proj = path.join(TMP, 'c-Users-alice-WorkBuddy-2026-01-02-03-04-05');
fs.mkdirSync(proj, { recursive: true });

const lines = [
  { type: 'session-meta', sessionId: 'wb-1', timestamp: Date.now() },
  { type: 'ai-title', aiTitle: '测试会话标题', cwd: 'C:\\Users\\alice\\WorkBuddy\\2026-01-02-03-04-05' },
  { type: 'message', role: 'user', content: [{ type: 'input_text', text: '<system-reminder>ctx</system-reminder><user_query>第一问</user_query>' }] },
  { type: 'message', role: 'assistant', content: [{ type: 'text', text: '第一答' }] },
  { type: 'message', role: 'user', content: [{ type: 'input_text', text: '<user_query>第二问</user_query>' }] },
  { type: 'message', role: 'assistant', content: [{ type: 'text', text: '第二答' }] },
];
const file = path.join(proj, 'wb-1.jsonl');
fs.writeFileSync(file, lines.map((l) => JSON.stringify(l)).join('\n') + '\n', 'utf8');

const list = wb.listSessions.call(null, 5);
// 用临时目录重新扫，避免读到真实会话
const { WbChat } = wb;
const listFn = require('../src/wbchat').listSessions;

const sm = wb.summarize(file, { project: 'c-Users-alice-WorkBuddy-2026-01-02-03-04-05', mtime: Date.now(), size: 1 });
ok('标题取 ai-title', () => assert.strictEqual(sm.title, '测试会话标题'));
ok('项目名取 cwd 的最后一段', () => assert.strictEqual(sm.project, '2026-01-02-03-04-05'));
ok('lastUser 是最新一问你', () => assert.strictEqual(sm.lastUser, '第二问'));
ok('lastAssistant 是最新一答', () => assert.strictEqual(sm.lastAssistant, '第二答'));
ok('会话被标记为只读', () => assert.strictEqual(sm.readonly, true));
ok('kind 标记为 workbuddy', () => assert.strictEqual(sm.kind, 'workbuddy'));
ok('sessionId 从 session-meta 取', () => assert.strictEqual(sm.id, 'wb-1'));

fs.rmSync(TMP, { recursive: true, force: true });

/* ---------------- 节流 ---------------- */

ok('工具/思考事件会被节流，助手消息不节流', () => {
  const got = [];
  const feed = new WbChat((ev) => got.push(ev), { root: path.join(os.tmpdir(), 'no-such-dir-whale') });
  feed.emit({ kind: 'tool', text: 'a' });
  feed.emit({ kind: 'tool', text: 'b' });
  feed.emit({ kind: 'say', text: 'c' });
  assert.strictEqual(got.length, 2);
  assert.strictEqual(got[1].kind, 'say');
  assert.strictEqual(got[0].provider, 'workbuddy');
});

console.log(`\n通过 ${pass}，失败 ${fail}`);
if (fail) process.exit(1);
