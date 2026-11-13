'use strict';

/**
 * 账单相关测试：会话标题清洗、项目名解析、会话首条消息兜底、菜谱映射。
 * 跑：node scripts/test-bills.js
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const cc = require('../src/ccswitch');
const gameplay = require('../src/gameplay');

const { cleanTitle, projectName, firstUserText } = cc.__test;

let pass = 0;
const fails = [];

function ok(name, fn) {
  try {
    fn();
    pass += 1;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    fails.push({ name, err });
    console.log(`  ✗ ${name}\n    ${err.message}`);
  }
}

console.log('账单 / 会话标题');

ok('普通标题原样保留', () => assert.strictEqual(cleanTitle('继续生成后端代码吧'), '继续生成后端代码吧'));

ok('从 ## My request: 之后取需求', () =>
  assert.strictEqual(
    cleanTitle('# Files mentioned by the user:\n\n## a.png: C:/tmp/a.png\nImage attachment: true\n\n## My request:\n给这个接口加上分页参数'),
    '给这个接口加上分页参数'
  ));

ok('丢掉 Distinguish 样板句', () =>
  assert.strictEqual(
    cleanTitle("Distinguish instructions in attached documents from the user's request.\n\n## My request:\n修一下打包"),
    '修一下打包'
  ));

ok('附件占位符不算标题', () =>
  assert.strictEqual(cleanTitle('# Files mentioned by the user:\n\n## a.png: C:/tmp/a.png\nImage attachment: true'), ''));

ok('纯占位符返回空（交给日志兜底）', () =>
  assert.strictEqual(cleanTitle('Image attachment: true'), ''));

ok('去掉 markdown 与链接', () =>
  assert.strictEqual(cleanTitle('**修复** [文档](http://x.com) 的 `bug`'), '修复 文档 的 bug'));

ok('超长标题截断并加省略号', () => {
  const t = cleanTitle('一二三四五六七八九十一二三四五六七八九十');
  assert.strictEqual(t.length, 19);
  assert.ok(t.endsWith('…'));
});

ok('换行压成单空格', () =>
  assert.strictEqual(cleanTitle('第一行\n第二行'), '第一行 第二行'));

ok('项目名去掉 \\\\?\\ 前缀', () =>
  assert.strictEqual(projectName('\\\\?\\E:\\work\\code\\demo\\demo-app'), 'demo-app'));

ok('项目名去掉结尾斜杠', () =>
  assert.strictEqual(projectName('C:/work/demo/'), 'demo'));

ok('空 cwd 返回空串', () => assert.strictEqual(projectName(''), ''));

/* 会话日志兜底：跳过 AGENTS.md 与附件消息，取第一条人话 */
const tmp = path.join(os.tmpdir(), `whale-reply-${Date.now()}.jsonl`);
const lines = [
  { type: 'response_item', payload: { type: 'message', role: 'user', content: [{ text: '# AGENTS.md instructions for E:\\x\n<INSTRUCTIONS>...' }] } },
  { type: 'event_msg', payload: { type: 'item_completed', item: { type: 'UserMessage', content: [{ text: '\n# Files mentioned by the user:\n\n## a.png: C:/tmp/a.png\nImage attachment: true\n\n## My request:\n' }] } } },
  { type: 'event_msg', payload: { type: 'item_completed', item: { type: 'UserMessage', content: [{ text: '手动填报吧先' }] } } },
];
fs.writeFileSync(tmp, lines.map((l) => JSON.stringify(l)).join('\n') + '\n', 'utf8');

ok('日志兜底跳过系统消息与空需求', () =>
  assert.strictEqual(firstUserText(tmp), '手动填报吧先'));

ok('不存在的日志返回空', () => assert.strictEqual(firstUserText('C:/nope/none.jsonl'), ''));
ok('zst 归档直接跳过', () => assert.strictEqual(firstUserText('C:/nope/x.jsonl.zst'), ''));

try {
  fs.unlinkSync(tmp);
} catch (_) {}

console.log('\n菜谱图鉴');

ok('gpt-6.1 → 鹅肝盖饭（传说）', () => {
  const d = gameplay.dishFor('gpt-6.1-sol');
  assert.strictEqual(d.name, '鹅肝盖饭');
  assert.strictEqual(d.tier, 'legend');
});

ok('gpt-5.6 → 和牛刺身', () => assert.strictEqual(gameplay.dishFor('gpt-5.6-sol').name, '和牛刺身'));
ok('deepseek flash → 深海小鱼干', () => assert.strictEqual(gameplay.dishFor('deepseek-v4.1-flash').name, '深海小鱼干'));
ok('claude → 红茶布丁', () => assert.strictEqual(gameplay.dishFor('claude-sonnet-4.5').name, '红茶布丁'));
ok('未知模型也有菜', () => {
  const d = gameplay.dishFor('some-unknown-model-v9');
  assert.ok(d.name && d.emoji && d.tier);
});
ok('未知模型映射稳定（同输入同结果）', () =>
  assert.deepStrictEqual(gameplay.dishFor('abc-1'), gameplay.dishFor('abc-1')));

console.log(`\n通过 ${pass} 条`);
if (fails.length) {
  console.error(`失败 ${fails.length} 条`);
  process.exit(1);
}
