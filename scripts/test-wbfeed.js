'use strict';

/** WorkBuddy 审计流测试（合成数据，不读真实审计日志） */

const fs = require('fs');
const os = require('os');
const path = require('path');

const { WbFeed, translate } = require('../src/wbfeed');

let pass = 0;
let fail = 0;
function ok(name, cond, extra) {
  if (cond) {
    pass += 1;
    console.log('  ✓', name);
  } else {
    fail += 1;
    console.log('  ✗', name, extra === undefined ? '' : JSON.stringify(extra));
  }
}

const NL = '\n';
const TMP = path.join(os.tmpdir(), 'whale-wb-test');
fs.rmSync(TMP, { recursive: true, force: true });
fs.mkdirSync(TMP, { recursive: true });

function dayKey(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
const file = path.join(TMP, `${dayKey()}.jsonl`);
fs.writeFileSync(file, '', 'utf8');

console.log('[类型映射]');
{
  const t1 = translate({ eventType: 'command-safety.sandbox-executed', commandPreview: 'npm test', timestamp: 1 });
  ok('命令执行 → tool/执行命令', t1.kind === 'tool' && t1.label === '执行命令' && t1.text === 'npm test', t1);

  const t2 = translate({ eventType: 'file-safety.allow-listed', commandPreview: 'src/app.js' });
  ok('文件访问 → tool/访问文件', t2.kind === 'tool' && t2.label === '访问文件', t2);

  const t3 = translate({ eventType: 'file-safety.bulk-delete.needs-approval', commandPreview: 'rm -rf build' });
  ok('待审批 → approval', t3.kind === 'approval' && t3.label === '等待审批', t3);

  const t4 = translate({ eventType: 'file-safety.bulk-delete.rejected' });
  ok('拒绝 → approval-done', t4.kind === 'approval-done' && t4.label === '已拒绝', t4);

  ok('未知类型忽略', translate({ eventType: 'config.migrated' }) === null);

  const long = translate({ eventType: 'command-safety.sandbox-executed', commandPreview: 'x'.repeat(200) });
  ok('长命令被截断', long.text.length <= 71, long.text.length);
}

console.log('[增量与去重]');
{
  const got = [];
  const feed = new WbFeed((ev) => got.push(ev), { dir: TMP });
  feed.open(true);
  ok('首次打开跳到末尾', feed.offset === 0);

  const append = (obj) => fs.appendFileSync(file, JSON.stringify(obj) + NL, 'utf8');

  append({ eventType: 'command-safety.sandbox-executed', toolCallId: 'c1', commandPreview: 'npm run build', timestamp: Date.now() });
  feed.tick();
  ok('读到命令事件', got.length === 1 && got[0].kind === 'tool', got);
  ok('带 provider 标记', got[0].provider === 'workbuddy');

  append({ eventType: 'command-safety.sandbox-executed', toolCallId: 'c1', commandPreview: 'npm run build', timestamp: Date.now() });
  feed.tick();
  ok('同一 toolCallId 去重', got.length === 1, got.length);

  append({ eventType: 'file-safety.bulk-delete.needs-approval', toolCallId: 'c2', commandPreview: 'rm -rf build', timestamp: Date.now() });
  feed.tick();
  ok('审批事件不被节流', got.length === 2 && got[1].kind === 'approval', got.map((g) => g.kind));

  const before = got.length;
  append({ eventType: 'file-safety.allow-listed', toolCallId: 'c3', commandPreview: 'a.js', timestamp: Date.now() });
  feed.tick();
  ok('工具事件被节流（800ms 内）', got.length === before, got.length);
}

console.log(`\n通过 ${pass}，失败 ${fail}`);
process.exit(fail === 0 ? 0 : 1);
