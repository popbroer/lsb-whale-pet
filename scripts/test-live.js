'use strict';

/** 实时字幕解析测试：合成 Codex / Claude 日志行，验证抽取结果 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const TMP = path.join(os.tmpdir(), 'whale-live-test');
fs.rmSync(TMP, { recursive: true, force: true });
fs.mkdirSync(path.join(TMP, 'codex', '2026', '11', '13'), { recursive: true });
fs.mkdirSync(path.join(TMP, 'claude', 'demo'), { recursive: true });

process.env.WHALE_CODEX_SESSIONS = path.join(TMP, 'codex');
process.env.WHALE_CLAUDE_SESSIONS = path.join(TMP, 'claude');

const { LiveFeed, parseLine, clean } = require('../src/livefeed');

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

const ts = (s) => JSON.stringify(new Date(s).toISOString());
const codexLine = (payload, iso) => JSON.stringify({ timestamp: iso, type: 'event_msg', payload });
const respLine = (payload, iso) => JSON.stringify({ timestamp: iso, type: 'response_item', payload });

console.log('[Codex]');
{
  const iso = '2026-11-13T10:00:00.000Z';
  const start = parseLine('codex', codexLine({ type: 'task_started', turn_id: 't1' }, iso));
  ok('task_started → start', start.kind === 'start');

  const agent = parseLine(
    'codex',
    codexLine(
      { type: 'item_completed', item: { type: 'AgentMessage', content: [{ type: 'Text', text: '我会先在代码里定位字段和计算逻辑，再汇总公式。' }] } },
      iso
    )
  );
  ok('AgentMessage → say 且保留中文', agent.kind === 'say' && agent.text.includes('定位字段'), agent);

  const cmd = parseLine(
    'codex',
    codexLine({ type: 'item_completed', item: { type: 'CommandExecution', command: ['pwsh.exe', '-Command', 'npm run build'], parsed_cmd: [{ cmd: 'npm run build' }] } }, iso)
  );
  ok('CommandExecution → tool 运行命令', cmd.kind === 'tool' && cmd.label === '运行命令' && cmd.text === 'npm run build', cmd);

  const reasoningEmpty = parseLine(
    'codex',
    respLine({ type: 'reasoning', summary: [], encrypted_content: 'xxxx' }, iso)
  );
  ok('空 summary 的 reasoning 不产生事件（CoT 加密）', reasoningEmpty === null);

  const assistantMsg = parseLine('codex', respLine({ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '已在前后端各自当前分支实现，未提交。' }] }, iso));
  ok('response_item/message(assistant) → say', assistantMsg.kind === 'say' && assistantMsg.text.startsWith('已在前后端'), assistantMsg);

  const done = parseLine('codex', codexLine({ type: 'task_complete', last_agent_message: '搞定，跑过了 18 项测试。', duration_ms: 326000 }, iso));
  ok('task_complete → done 带耗时', done.kind === 'done' && done.durationMs === 326000 && done.text.includes('18 项'), done);

  const subagent = parseLine('codex', codexLine({ type: 'item_completed', item: { type: 'SubAgentActivity', kind: 'interacted' } }, iso));
  ok('SubAgentActivity → tool 子代理', subagent.kind === 'tool' && subagent.label === '子代理');
}

console.log('[Claude Code]');
{
  const iso = '2026-11-13T10:00:00.000Z';
  const thinkLine = JSON.stringify({
    type: 'assistant',
    timestamp: iso,
    message: { role: 'assistant', content: [{ type: 'thinking', thinking: '用户想确认计提比例，先看 targetCost 字段。' }] },
  });
  const think = parseLine('claude', thinkLine);
  ok('thinking → think（真实思维链）', Array.isArray(think) && think[0].kind === 'think' && think[0].text.includes('targetCost'), think);

  const mixLine = JSON.stringify({
    type: 'assistant',
    timestamp: iso,
    message: {
      role: 'assistant',
      content: [
        { type: 'text', text: '我会先定位字段，再汇总公式。' },
        { type: 'tool_use', name: 'Grep', input: { pattern: 'targetCost' } },
      ],
    },
  });
  const mix = parseLine('claude', mixLine);
  ok('一条消息拆成 say + tool', mix.length === 2 && mix[0].kind === 'say' && mix[1].kind === 'tool' && mix[1].label === '搜索代码', mix);

  const toolResult = JSON.stringify({ type: 'user', timestamp: iso, message: { content: [{ type: 'tool_result', content: 'x' }] } });
  ok('tool_result 不上字幕', parseLine('claude', toolResult) === null || parseLine('claude', toolResult).length === 0);
}

console.log('[文本清洗]');
{
  ok('去代码块', clean('看这里：\n```js\nconst a=1\n```\n然后继续') === '看这里： … 然后继续', clean('看这里：\n```js\nconst a=1\n```\n然后继续'));
  ok('链接保留文字', clean('详见[验证记录](E:/x/y.md)。') === '详见验证记录。', clean('详见[验证记录](E:/x/y.md)。'));
  ok('压成单行', !clean('第一行\n\n第二行').includes('\n'));
}

console.log('[增量读取]');
{
  const dir = path.join(TMP, 'codex', '2026', '11', '13');
  const file = path.join(dir, 'rollout-fake.jsonl');
  fs.writeFileSync(file, codexLine({ type: 'task_started', turn_id: 'old' }, '2026-11-13T09:00:00.000Z') + '\n');

  const got = [];
  const feed = new LiveFeed((ev) => got.push(ev));
  feed.scan(true);
  ok('首次启动跳到末尾，不回放历史', got.length === 0);

  const append = (s) => fs.appendFileSync(file, s + '\n');
  append(codexLine({ type: 'task_started', turn_id: 't2' }, '2026-11-13T10:00:00.000Z'));
  append(codexLine({ type: 'item_completed', item: { type: 'AgentMessage', content: [{ type: 'Text', text: '开始处理这个需求。' }] } }, '2026-11-13T10:00:01.000Z'));
  append(codexLine({ type: 'item_completed', item: { type: 'CommandExecution', command: ['npm', 'test'], parsed_cmd: [{ cmd: 'npm test' }] } }, '2026-11-13T10:00:02.000Z'));

  feed.tick();
  ok('追加后读到 3 个事件', got.length === 3, got.map((g) => g.kind));
  ok('顺序正确', got[0].kind === 'start' && got[1].kind === 'say' && got[2].kind === 'tool', got.map((g) => g.kind));

  append(codexLine({ type: 'item_completed', item: { type: 'AgentMessage', content: [{ type: 'Text', text: '开始处理这个需求。' }] } }, '2026-11-13T10:00:03.000Z'));
  feed.tick();
  ok('重复文本被去重', got.length === 3, got.length);

  feed.stop();
}

console.log(`\n通过 ${pass}，失败 ${fail}`);
process.exit(fail === 0 ? 0 : 1);
