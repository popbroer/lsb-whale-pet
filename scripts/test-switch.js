'use strict';

/**
 * 沙箱测试：把 cc-switch 的数据库和 CLI 配置复制到临时目录里跑一次切换，
 * 全程不碰用户真实配置。
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { DatabaseSync } = require('node:sqlite');

const ROOT = path.join(os.tmpdir(), 'whale-pet-sandbox');
const CC = path.join(ROOT, 'cc-switch');
const CLAUDE = path.join(ROOT, 'claude');
const CODEX = path.join(ROOT, 'codex');

fs.rmSync(ROOT, { recursive: true, force: true });
for (const d of [CC, CLAUDE, CODEX]) fs.mkdirSync(d, { recursive: true });

const realHome = path.join(os.homedir(), '.cc-switch');
fs.copyFileSync(path.join(realHome, 'cc-switch.db'), path.join(CC, 'cc-switch.db'));
fs.copyFileSync(path.join(realHome, 'settings.json'), path.join(CC, 'settings.json'));
fs.writeFileSync(path.join(CLAUDE, 'settings.json'), JSON.stringify({ env: { ANTHROPIC_BASE_URL: 'old' } }, null, 2));
fs.writeFileSync(path.join(CODEX, 'auth.json'), JSON.stringify({ OPENAI_API_KEY: 'old' }, null, 2));
fs.writeFileSync(path.join(CODEX, 'config.toml'), 'model = "old"\n');

process.env.WHALE_CC_HOME = CC;
process.env.WHALE_CLAUDE_DIR = CLAUDE;
process.env.WHALE_CODEX_DIR = CODEX;

const cc = require('../src/ccswitch');

const state = cc.readState();
console.log('[1] 读取副本:', state.ok, 'apps=', state.apps.length);

const claudeApp = state.apps.find((a) => a.appType === 'claude');
const target = claudeApp.providers.find((p) => !p.isCurrent);
const codexApp = state.apps.find((a) => a.appType === 'codex');
const codexTarget = codexApp.providers.find((p) => !p.isCurrent);

console.log('[2] 目标 claude:', target.name, '| codex:', codexTarget.name);

const r1 = cc.switchProvider('claude', target.id, path.join(ROOT, 'backups'));
console.log('[3] claude 切换:', JSON.stringify(r1));

const r2 = cc.switchProvider('codex', codexTarget.id, path.join(ROOT, 'backups'));
console.log('[4] codex 切换:', JSON.stringify(r2));

const after = cc.readState();
console.log(
  '[5] 切换后当前值: claude =',
  after.apps.find((a) => a.appType === 'claude').current.name,
  '| codex =',
  after.apps.find((a) => a.appType === 'codex').current.name
);

const written = JSON.parse(fs.readFileSync(path.join(CLAUDE, 'settings.json'), 'utf8'));
console.log('[6] ~/.claude/settings.json env keys:', Object.keys(written.env || {}).join(','));
console.log('[7] codex config.toml 首行:', fs.readFileSync(path.join(CODEX, 'config.toml'), 'utf8').split('\n')[0]);

const db = new DatabaseSync(path.join(CC, 'cc-switch.db'), { readOnly: true });
const rows = db.prepare('select app_type, count(*) c from providers where is_current = 1 group by app_type').all();
db.close();
console.log('[8] is_current 计数:', JSON.stringify(rows));

const backups = fs.readdirSync(path.join(ROOT, 'backups'));
console.log('[9] 备份目录:', backups.join(' | '));
console.log('[10] 备份文件数:', backups.map((b) => fs.readdirSync(path.join(ROOT, 'backups', b)).length).join(','));
