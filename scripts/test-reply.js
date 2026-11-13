'use strict';

/** 回复通道测试：会话发现 / 清洗 / 会话画像（不真的发消息，避免写用户会话） */

const fs = require('fs');
const os = require('os');
const path = require('path');

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
const TMP = path.join(os.tmpdir(), 'whale-reply-test');
fs.rmSync(TMP, { recursive: true, force: true });
fs.mkdirSync(path.join(TMP, '2026', '11', '13'), { recursive: true });

const SID = '01a1ffff-1111-7222-8333-444455556666';
const sessionFile = path.join(TMP, '2026', '11', '13', `rollout-2026-11-13T10-00-00-${SID}.jsonl`);

const meta = {
  timestamp: '2026-11-13T10:00:00.000Z',
  type: 'session_meta',
  payload: { session_id: SID, id: SID, cwd: 'E:\\work\\demo' },
};

const lines = [
  JSON.stringify(meta),
  JSON.stringify({ timestamp: '2026-11-13T10:00:01.000Z', type: 'event_msg', payload: { type: 'task_started' } }),
  JSON.stringify({
    timestamp: '2026-11-13T10:00:02.000Z',
    type: 'event_msg',
    payload: { type: 'item_completed', item: { type: 'AgentMessage', content: [{ type: 'Text', text: '旧的一条旁白' }] } },
  }),
  JSON.stringify({
    timestamp: '2026-11-13T10:05:00.000Z',
    type: 'event_msg',
    payload: { type: 'task_complete', last_agent_message: '最新结论：三个测试全过。', duration_ms: 300000, completed_at: 1794547500 },
  }),
];
fs.writeFileSync(sessionFile, lines.join(NL) + NL, 'utf8');

process.env.WHALE_CODEX_SESSIONS = TMP;
const reply = require('../src/reply');

console.log('[会话发现]');
{
  const s = reply.findLatestSession();
  ok('找到会话', !!s, s);
  ok('id 正确', s.id === SID, s.id);
  ok('cwd 正确', s.cwd === 'E:\\work\\demo', s.cwd);
  ok('路径指向伪造文件', s.path === sessionFile);
  ok('idleMs 是数字', typeof s.idleMs === 'number');
}

console.log('[最近回复]');
{
  const r = reply.findLatestReply(sessionFile);
  ok('取到最新回复', r && r.text === '最新结论：三个测试全过。', r);
  ok('带上时间戳', r && r.at === 1794547500000, r && r.at);

  const onlySay = path.join(TMP, 'only-say.jsonl');
  const rows = [
    JSON.stringify(meta),
    JSON.stringify({
      timestamp: '2026-11-13T10:01:00.000Z',
      type: 'event_msg',
      payload: { type: 'item_completed', item: { type: 'AgentMessage', content: [{ type: 'Text', text: '只有一条旁白' }] } },
    }),
  ];
  fs.writeFileSync(onlySay, rows.join(NL) + NL, 'utf8');
  const r2 = reply.findLatestReply(onlySay);
  ok('回退到 AgentMessage', r2 && r2.text === '只有一条旁白', r2);
}

console.log('[文本清洗]');
{
  const attachmentMsg = [
    '# Files mentioned by the user:',
    '',
    '## a.png: C:/tmp/a.png',
    'Image attachment: true',
    '',
    '看看这个报错',
  ].join(NL);

  const cases = [
    ['# AGENTS.md instructions for E:\\work\\demo' + NL + NL + '<INSTRUCTIONS>' + NL + '规则' + NL + '</INSTRUCTIONS>', ''],
    ['<turn_aborted>' + NL + 'The user interrupted the turn.' + NL, ''],
    [attachmentMsg, '看看这个报错'],
    ['<send_user_message_question_reply>[{"answer":"好"}]</send_user_message_question_reply>', '（回答了一个选择）'],
    ['正常的用户提问', '正常的用户提问'],
  ];

  for (const [input, want] of cases) {
    const got = reply.cleanUserText(input);
    ok(`清洗「${input.slice(0, 22).replace(/\n/g, ' ')}…」`, got === want, got);
  }
}

console.log('[会话画像]');
{
  const SID2 = '01a1abcd-1234-7abc-8def-0123456789ab';
  const file = path.join(TMP, '2026', '11', '13', `rollout-2026-11-13T11-00-00-${SID2}.jsonl`);
  const rows = [
    JSON.stringify({ timestamp: '2026-11-13T11:00:00.000Z', type: 'session_meta', payload: { session_id: SID2, cwd: 'E:\\work\\code\\demo-app' } }),
    JSON.stringify({
      timestamp: '2026-11-13T11:00:01.000Z',
      type: 'event_msg',
      payload: {
        type: 'item_completed',
        item: {
          type: 'UserMessage',
          content: [
            {
              type: 'text',
              text: ['# Files mentioned by the user:', '', '## a.png', 'Image attachment: true', '', '帮我看看这个登录报错'].join(NL),
            },
          ],
        },
      },
    }),
    JSON.stringify({
      timestamp: '2026-11-13T11:00:02.000Z',
      type: 'event_msg',
      payload: { type: 'item_completed', item: { type: 'AgentMessage', content: [{ type: 'Text', text: '是 token 过期了。' }] } },
    }),
  ];
  fs.writeFileSync(file, rows.join(NL) + NL, 'utf8');

  const sum = reply.summarizeSession(file, fs.statSync(file).mtimeMs);
  ok('会话 id 解析', sum.id === SID2, sum.id);
  ok('项目名取最后一段', sum.project === 'demo-app', sum.project);
  ok('标题去掉附件清单', sum.title === '帮我看看这个登录报错', sum.title);
  ok('最后回复取到', sum.lastAssistant === '是 token 过期了。', sum.lastAssistant);
}

console.log('[接口]');
{
  ok('startReply 是函数', typeof reply.startReply === 'function');
  ok('runCodex 是函数', typeof reply.runCodex === 'function');
  ok('listSessions 是函数', typeof reply.listSessions === 'function');
  ok('空会话不崩', reply.findLatestReply(path.join(TMP, 'nope.jsonl')) === null);

  const list = reply.listSessions(5);
  ok('列表每一项都有 id', Array.isArray(list) && list.every((s) => s.id), list.length);
}

/* ---------------- 两路消息（event_msg vs response_item） ---------------- */

const { summarizeSession } = require('../src/reply');

function writeRollout(name, lines) {
  const p = path.join(TMP, '2026', '11', '13', name);
  const head = JSON.stringify({
    timestamp: '2026-11-13T10:00:00.000Z',
    type: 'session_meta',
    payload: { session_id: name.replace(/\.jsonl$/, ''), cwd: 'E:////work////demo' },
  });
  fs.writeFileSync(p, head + NL + lines.map((l) => JSON.stringify(l)).join(NL) + NL, 'utf8');
  return p;
}

const evtUser = (t) => ({ type: 'event_msg', payload: { type: 'item_completed', item: { type: 'UserMessage', content: [{ type: 'text', text: t }] } } });
const evtAgent = (t) => ({ type: 'event_msg', payload: { type: 'item_completed', item: { type: 'AgentMessage', content: [{ type: 'text', text: t }] } } });
const respUser = (t) => ({ type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'text', text: t }] } });
const respAgent = (t) => ({ type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'text', text: t }] } });

// 真实踩过的坑：resume 会把历史作为 response_item 回放，
// 而新消息走 event_msg。混着读会把「回放的历史」当成最后一句
const mixed = writeRollout('mixed.jsonl', [
  respUser('# AGENTS.md instructions for E:////work////demo' + NL + '<INSTRUCTIONS>...</INSTRUCTIONS>'),
  respUser('<environment_context>' + NL + '<current_date>2026-11-13</current_date>' + NL + '</environment_context>'),
  respUser('你好'),
  evtUser('你好'),
  evtAgent('你好！有什么需要我帮忙的？'),
  respAgent('你好！有什么需要我帮忙的？'),
  respUser('今天温度'),
  respAgent('你想查哪个城市今天的温度？'),
  respUser('你好'),
  evtUser('你好'),
  evtAgent('你好！今天想处理什么问题？'),
  respAgent('你好！今天想处理什么问题？'),
]);

const sm = summarizeSession(mixed, Date.now());
ok('混合文件：lastUser 取最新一条 event_msg（重复消息也要更新）', sm.lastUser === '你好', sm.lastUser);
ok('混合文件：不会把回放的历史当成最后一句', sm.lastUser !== '今天温度', sm.lastUser);
ok('混合文件：lastAssistant 是最新回复', sm.lastAssistant === '你好！今天想处理什么问题？', sm.lastAssistant);
ok('混合文件：标题取第一条真实用户消息', sm.title === '你好', sm.title);
ok('混合文件：只数 event_msg 的回合数', sm.turns === 2, sm.turns);
ok('混合文件：项目名解析正确', sm.project === 'demo', sm.project);

// 老文件只有 response_item（没有 event_msg），要能退回读取
const legacy = writeRollout('legacy.jsonl', [
  respUser('第一句需求'),
  respAgent('好的'),
  respUser('第二句需求'),
  respAgent('做完了'),
]);
const lg = summarizeSession(legacy, Date.now());
ok('纯 response_item 的文件：lastUser 正确', lg.lastUser === '第二句需求', lg.lastUser);
ok('纯 response_item 的文件：lastAssistant 正确', lg.lastAssistant === '做完了', lg.lastAssistant);
ok('纯 response_item 的文件：标题取首句', lg.title === '第一句需求', lg.title);

// 注入块不能被当成用户消息
const injected = writeRollout('injected.jsonl', [
  respUser('# AGENTS.md instructions' + NL + '<INSTRUCTIONS>规则</INSTRUCTIONS>'),
  respUser('<environment_context><current_date>2026-11-13</current_date></environment_context>'),
  evtUser('真正的需求'),
  evtAgent('收到'),
]);
const inj = summarizeSession(injected, Date.now());
ok('注入块被过滤：标题是真实需求', inj.title === '真正的需求', inj.title);

/* ---------------- exec 模式（user_message / agent_message） ---------------- */

const evtMsg = (t) => ({ type: 'event_msg', payload: { type: 'user_message', message: t + '\n' } });
const evtAgentMsg = (t) => ({ type: 'event_msg', payload: { type: 'agent_message', message: t, phase: 'final_answer' } });

const execRun = writeRollout('exec-run.jsonl', [
  respUser('<environment_context><current_date>2026-11-13</current_date></environment_context>'),
  respUser('你好'),
  evtUser('你好'),
  evtAgent('你好！有什么需要我帮忙的？'),
  evtMsg('只回复两个字：收到'),
  evtAgentMsg('收到'),
  { type: 'event_msg', payload: { type: 'task_complete', last_agent_message: '收到' } },
]);
const ex = summarizeSession(execRun, Date.now());
ok('exec 模式：user_message 被当成用户消息', ex.lastUser === '只回复两个字：收到', ex.lastUser);
ok('exec 模式：agent_message 被当成回复', ex.lastAssistant === '收到', ex.lastAssistant);
ok('exec 模式：标题仍取最早的用户消息', ex.title === '你好', ex.title);

/* ---------------- 头部被超长注入占满时的标题兜底 ---------------- */

const pad = '# AGENTS.md instructions' + NL + 'x'.repeat(200 * 1024);
const bigHead = writeRollout('big-head.jsonl', [
  respUser(pad),
  respUser('真正想做的第一件事'),
  respUser('第二件事'),
]);
const bh = summarizeSession(bigHead, Date.now());
ok('头部超出读取窗口：标题仍取第一条用户消息', bh.title === '真正想做的第一件事', bh.title);
ok('头部超出读取窗口：lastUser 是最新一条', bh.lastUser === '第二件事', bh.lastUser);

console.log(`\n通过 ${pass}，失败 ${fail}`);
process.exit(fail === 0 ? 0 : 1);
