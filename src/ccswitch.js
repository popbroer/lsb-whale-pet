'use strict';

/**
 * cc-switch 数据桥
 * -------------------------------------------------
 * cc-switch 把供应商、健康状态、请求日志全部存在 ~/.cc-switch/cc-switch.db (SQLite)。
 * 这里只做两件事：
 *   1. 只读轮询，把「当前供应商 / 用量 / 报错」翻译成宠物的情绪；
 *   2. 在用户显式授权后，按 cc-switch 自己的规则写回配置并同步 is_current。
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

let DatabaseSync = null;
try {
  // Electron 45 内置 Node 24，node:sqlite 免安装原生模块
  ({ DatabaseSync } = require('node:sqlite'));
} catch (_) {
  DatabaseSync = null;
}

const HOME = os.homedir();
const CC_HOME = process.env.WHALE_CC_HOME || path.join(HOME, '.cc-switch');
const DB_PATH = path.join(CC_HOME, 'cc-switch.db');
const CC_SETTINGS_PATH = path.join(CC_HOME, 'settings.json');
const CC_EXE = process.env.WHALE_CC_EXE || 'E:\\cc\\cc-switch.exe';

const DIRS = {
  claude: process.env.WHALE_CLAUDE_DIR || path.join(HOME, '.claude'),
  codex: process.env.WHALE_CODEX_DIR || path.join(HOME, '.codex'),
  gemini: process.env.WHALE_GEMINI_DIR || path.join(HOME, '.gemini'),
};

const APP_LABEL = { claude: 'Claude Code', codex: 'Codex', gemini: 'Gemini CLI' };
const APP_ORDER = ['codex', 'claude', 'gemini'];
const USD_CNY = 7.1;

function hasSqlite() {
  return !!DatabaseSync;
}

function openRead() {
  const db = new DatabaseSync(DB_PATH, { readOnly: true });
  db.exec('PRAGMA busy_timeout = 3000');
  return db;
}

function openWrite() {
  const db = new DatabaseSync(DB_PATH);
  db.exec('PRAGMA busy_timeout = 5000');
  return db;
}

/** created_at 在库里混用秒和毫秒，统一成毫秒 */
function toMs(v) {
  const n = Number(v) || 0;
  return n > 1e12 ? n : n * 1000;
}

function todayStr(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/* ------------------------- 会话 → 项目名 ------------------------- */

let projectCache = null;
const rolloutTitleCache = new Map();

function projectName(cwd) {
  if (!cwd) return '';
  const clean = String(cwd).replace(/^\\\\[?.]\\/, '').replace(/\\/g, '/').replace(/^\/+/, '');
  const parts = clean.split('/').filter(Boolean);
  return parts.length ? parts[parts.length - 1] : '';
}

/** 把标题里的附件清单、markdown 标记、超链接洗掉，只留一句人话 */
function cleanTitle(raw, max = 18) {
  let t = String(raw || '').replace(/\r/g, '');

  // 带附件时 Codex 会把消息包装成：
  //   # Files mentioned by the user: ... / Image attachment: true
  //   Distinguish instructions in attached documents from the user's request.
  //   ## My request:
  //   <真正的需求>
  // 直接从 "## My request:" 之后取
  const req = /##\s*My request:\s*/i.exec(t);
  if (req) t = t.slice(req.index + req[0].length);
  t = t.replace(/Distinguish instructions in attached documents from the user'?s? request\.?/gi, ' ');

  // Codex 会把首条消息（常含附件清单）直接当标题，形如：
  //   # Files mentioned by the user:  /  ## xxx.png: C:/...  /  ## yyy.md: /...
  //   正文
  //   <真正的用户输入>
  if (/Files mentioned by the user/i.test(t)) {
    const lines = t
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => {
        if (!l || l.startsWith('#')) return false;
        if (/^(image|file|audio|video) attachment:/i.test(l)) return false;
        if (/codex-clipboard-/i.test(l)) return false;
        return true;
      });
    t = lines.join(' ');
  }

  t = t
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/<[^>]{1,80}>/g, ' ')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[#>*`_~|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!t) return '';
  // 洗完还是占位符，就当作没标题，交给日志兜底
  if (/^(image|file|audio|video) attachment/i.test(t)) return '';
  if (/^files mentioned by the user/i.test(t)) return '';
  return t.length > max ? t.slice(0, max) + '…' : t;
}

/** 从会话日志开头找第一条真实用户消息（标题被附件糊掉时兜底） */
function firstUserText(rolloutPath, max = 18) {
  const p = String(rolloutPath || '').replace(/^\\\\[?.]\\/, '');
  if (!p || /\.zst$/i.test(p)) return ''; // 归档会话是 zstd 压缩的，读不了就用短 id 兜底

  let buf = null;
  try {
    const st = fs.statSync(p);
    const size = Math.min(st.size, 512 * 1024);
    const fd = fs.openSync(p, 'r');
    buf = Buffer.alloc(size);
    fs.readSync(fd, buf, 0, size, 0);
    fs.closeSync(fd);
  } catch (_) {
    return '';
  }

  for (const line of buf.toString('utf8').split('\n')) {
    if (!line.includes('UserMessage') && !line.includes('"role":"user"')) continue;
    let o;
    try {
      o = JSON.parse(line);
    } catch (_) {
      continue;
    }
    const pl = o.payload || {};
    let text = '';
    if (pl.type === 'item_completed' && pl.item && pl.item.type === 'UserMessage') {
      text = (pl.item.content || []).map((c) => c.text || '').join('\n');
    } else if (pl.type === 'message' && pl.role === 'user') {
      text = (pl.content || []).map((c) => c.text || '').join('\n');
    }
    if (!text) continue;

    // 系统注入的说明文件、环境上下文不是用户说的话
    if (/AGENTS\.md instructions|<INSTRUCTIONS>|environment_context|<user_instructions/i.test(text)) continue;

    // 逐行丢掉附件清单与占位符
    const kept = text
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => {
        if (!l) return false;
        if (/^#{1,6}\s/.test(l)) return false;
        if (/^(image|file|audio|video) attachment:/i.test(l)) return false;
        if (/codex-clipboard-/i.test(l)) return false;
        if (/^##?\s*\S+\.(png|jpe?g|webp|gif|md|pdf|txt)\s*:/i.test(l)) return false;
        return true;
      })
      .join(' ');

    const clean = cleanTitle(kept, max);
    if (clean && clean.length >= 2) return clean;
  }
  return '';
}

/** Codex 的会话标题存在 ~/.codex/state_5.sqlite 的 threads 表里 */
function codexThreads() {
  if (projectCache) return projectCache;
  const out = new Map();
  const dbPath = path.join(DIRS.codex, 'state_5.sqlite');
  if (!DatabaseSync || !fs.existsSync(dbPath)) return (projectCache = out);
  let db = null;
  try {
    db = new DatabaseSync(dbPath, { readOnly: true });
    for (const r of db.prepare('select id, cwd, title, rollout_path from threads').all()) {
      out.set(r.id, {
        cwd: r.cwd || '',
        rawTitle: r.title || '',
        title: cleanTitle(r.title),
        rollout: r.rollout_path || '',
        project: projectName(r.cwd),
      });
    }
  } catch (_) {
  } finally {
    try { if (db) db.close(); } catch (_) {}
  }
  return (projectCache = out);
}

function readState() {
  if (!fs.existsSync(DB_PATH)) {
    return { ok: false, reason: 'no-db', message: '没找到 ~/.cc-switch/cc-switch.db', apps: [], providers: [], unhealthy: [], stats: emptyStats(), activity: {} };
  }
  if (!DatabaseSync) {
    return { ok: false, reason: 'no-sqlite', message: '当前运行环境缺少 node:sqlite', apps: [], providers: [], unhealthy: [], stats: emptyStats(), activity: {} };
  }

  let db;
  try {
    db = openRead();

    const providers = db
      .prepare(
        `select id, app_type, name, is_current, category, provider_type, cost_multiplier
           from providers order by app_type, sort_index`
      )
      .all();

    let healthRows = [];
    try {
      healthRows = db
        .prepare('select provider_id, app_type, is_healthy, consecutive_failures, last_error, last_failure_at from provider_health')
        .all();
    } catch (_) {}

    const healthMap = new Map(healthRows.map((h) => [`${h.app_type}:${h.provider_id}`, h]));

    // 最近请求：按 rowid 取最新，再统一时间戳
    let recent = [];
    try {
      recent = db
        .prepare(
          `select rowid as rid, provider_id, app_type, model, status_code, total_cost_usd,
                  input_tokens, output_tokens, created_at, error_message
             from proxy_request_logs order by rowid desc limit 80`
        )
        .all();
    } catch (_) {}

    const recentTs = recent.map((r) => ({ ...r, ts: toMs(r.created_at) })).sort((a, b) => b.ts - a.ts);
    const last = recentTs[0] || null;
    const lastError = recentTs.find((r) => (r.status_code || 0) >= 400) || null;

    // 今日用量：优先读 cc-switch 自己的日汇总
    let rollups = [];
    try {
      rollups = db
        .prepare(
          `select app_type, provider_id, model, request_count, success_count,
                  input_tokens, output_tokens, total_cost_usd
             from usage_daily_rollups where date = ?`
        )
        .all(todayStr());
    } catch (_) {}

    let totalRequests = 0;
    try {
      totalRequests = Number(db.prepare('select count(*) as c from proxy_request_logs').get().c) || 0;
    } catch (_) {}

    // 请求日志既是「今日兜底」，也是近 7 天曲线的原料（日汇总经常滞后）
    let logFallback = null;
    const logByDate = new Map();
    try {
      const rows = db
        .prepare(
          'select created_at, input_tokens, output_tokens, status_code from proxy_request_logs order by rowid desc limit 4000'
        )
        .all();
      const start = new Date();
      start.setHours(0, 0, 0, 0);
      const startTs = start.getTime();
      const sinceTs = startTs - 6 * 24 * 3600 * 1000;

      logFallback = { requests: 0, tokens: 0 };
      for (const r of rows) {
        const ts = toMs(r.created_at);
        if (ts < sinceTs) continue;
        const key = todayStr(new Date(ts));
        const bucket = logByDate.get(key) || { requests: 0, tokens: 0 };
        bucket.requests += 1;
        bucket.tokens += (Number(r.input_tokens) || 0) + (Number(r.output_tokens) || 0);
        logByDate.set(key, bucket);

        if (ts >= startTs) {
          logFallback.requests += 1;
          logFallback.tokens += (Number(r.input_tokens) || 0) + (Number(r.output_tokens) || 0);
        }
      }
    } catch (_) {}

    // 近 7 天饭量：日汇总与日志取较大值，避免汇总滞后导致曲线只剩今天一根柱
    let daily = [];
    try {
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - 6);
      const since = todayStr(startDate);
      const rows = db
        .prepare(
          `select date,
                  sum(request_count) as requests,
                  sum(input_tokens + output_tokens) as tokens,
                  sum(cast(total_cost_usd as real)) as cost
             from usage_daily_rollups
            where date >= ?
            group by date`
        )
        .all(since);
      const map = new Map(rows.map((r) => [r.date, r]));
      for (let i = 6; i >= 0; i -= 1) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        const key = todayStr(d);
        const row = map.get(key);
        const logs = logByDate.get(key);
        const tokens = Math.max(row ? Number(row.tokens) || 0 : 0, logs ? logs.tokens : 0);
        daily.push({
          date: key,
          requests: Math.max(row ? Number(row.requests) || 0 : 0, logs ? logs.requests : 0),
          tokens,
          costUsd: row ? Number(row.cost) || 0 : 0,
        });
      }
    } catch (_) {
      daily = [];
    }

    // ---------- 缓存账单 + 会话账单 ----------
    const bills = { cache: null, sessions: [], changedAt: Date.now() };
    try {
      const startSec = Math.floor(new Date().setHours(0, 0, 0, 0) / 1000);

      const pickAgg = (row) => ({
        read: Number(row.c) || 0,
        input: Number(row.i) || 0,
        output: Number(row.o) || 0,
        creation: Number(row.w) || 0,
        requests: Number(row.n) || 0,
      });
      const withHit = (a) => ({
        ...a,
        // 命中率 = 命中缓存读 / (命中读 + 未命中输入)，避免被输出 token 稀释
        hit: a.read + a.input > 0 ? a.read / (a.read + a.input) : 0,
        savedTokens: a.read,
      });

      const todayAgg = db
        .prepare(
          `select coalesce(sum(cache_read_tokens),0) as c,
                  coalesce(sum(input_tokens),0) as i,
                  coalesce(sum(output_tokens),0) as o,
                  coalesce(sum(cache_creation_tokens),0) as w,
                  count(*) as n
             from proxy_request_logs where created_at >= ?`
        )
        .get(startSec);

      const allAgg = db
        .prepare(
          `select coalesce(sum(cache_read_tokens),0) as c,
                  coalesce(sum(input_tokens),0) as i,
                  coalesce(sum(output_tokens),0) as o,
                  coalesce(sum(cache_creation_tokens),0) as w,
                  count(*) as n
             from proxy_request_logs`
        )
        .get();

      bills.cache = { today: withHit(pickAgg(todayAgg)), all: withHit(pickAgg(allAgg)) };

      // 会话账单：按 token 总量排 top 5
      const rows = db
        .prepare(
          `select session_id,
                  coalesce(sum(input_tokens + output_tokens),0) as tokens,
                  coalesce(sum(cache_read_tokens),0) as cache,
                  count(*) as requests,
                  max(model) as model,
                  max(created_at) as last_at,
                  min(created_at) as first_at
             from proxy_request_logs
            where session_id is not null and session_id <> ''
            group by session_id
            order by tokens desc
            limit 5`
        )
        .all();

      const threads = codexThreads();
      const nowSec = Math.floor(Date.now() / 1000);
      bills.sessions = rows.map((r) => {
        const meta = threads.get(r.session_id) || null;
        const lastAt = toMs(r.last_at);
        let title = meta ? meta.title : '';
        if (!title && meta && meta.rollout && !rolloutTitleCache.has(r.session_id)) {
          title = firstUserText(meta.rollout);
          rolloutTitleCache.set(r.session_id, title);
        } else if (!title) {
          title = rolloutTitleCache.get(r.session_id) || '';
        }
        return {
          title,
          id: r.session_id,
          short: String(r.session_id).slice(0, 8),
          tokens: Number(r.tokens) || 0,
          cache: Number(r.cache) || 0,
          requests: Number(r.requests) || 0,
          model: r.model || '',
          project: meta ? meta.project : '',
          cwd: meta ? meta.cwd : '',
          lastAt,
          active: nowSec - Number(r.last_at) < 1800,
        };
      });
    } catch (_) {
      bills.error = String((_ && _.message) || _);
    }

    // ---------- 模型菜单（吃过哪些模型） ----------
    let menu = [];
    try {
      menu = db
        .prepare(
          `select model,
                  count(*) as n,
                  coalesce(sum(input_tokens + output_tokens), 0) as tokens,
                  min(created_at) as first_at,
                  max(created_at) as last_at
             from proxy_request_logs
            where model is not null and model <> ''
            group by model
            order by n desc`
        )
        .all()
        .map((r) => ({
          model: r.model,
          requests: Number(r.n) || 0,
          tokens: Number(r.tokens) || 0,
          firstAt: toMs(r.first_at),
          lastAt: toMs(r.last_at),
        }));
    } catch (_) {
      menu = [];
    }

    db.close();
    db = null;

    const stats = emptyStats();
    if (rollups.length) {
      for (const r of rollups) {
        stats.requests += Number(r.request_count) || 0;
        stats.tokens += (Number(r.input_tokens) || 0) + (Number(r.output_tokens) || 0);
        stats.costUsd += Number(r.total_cost_usd) || 0;
      }
    } else if (logFallback) {
      stats.requests = logFallback.requests;
      stats.tokens = logFallback.tokens;
    }

    const byApp = (appType) => providers.filter((p) => p.app_type === appType);

    const apps = APP_ORDER.filter((a) => byApp(a).length).map((a) => {
      const list = byApp(a).map((p) => {
        const h = healthMap.get(`${a}:${p.id}`);
        return {
          id: p.id,
          name: p.name,
          appType: a,
          category: p.category || '',
          isCurrent: !!p.is_current,
          healthy: h ? !!h.is_healthy : true,
          failures: h ? Number(h.consecutive_failures) || 0 : 0,
          lastError: h ? h.last_error || null : null,
        };
      });
      const current = list.find((p) => p.isCurrent) || null;
      const dayStats = rollups
        .filter((r) => r.app_type === a)
        .reduce(
          (acc, r) => {
            acc.requests += Number(r.request_count) || 0;
            acc.tokens += (Number(r.input_tokens) || 0) + (Number(r.output_tokens) || 0);
            acc.costUsd += Number(r.total_cost_usd) || 0;
            return acc;
          },
          { requests: 0, tokens: 0, costUsd: 0 }
        );
      return { appType: a, label: APP_LABEL[a] || a, providers: list, current, stats: dayStats };
    });

    const unhealthy = apps.flatMap((a) => a.providers.filter((p) => !p.healthy || p.failures > 0));

    return {
      ok: true,
      dbPath: DB_PATH,
      apps,
      providers: apps.flatMap((a) => a.providers),
      unhealthy,
      stats: { ...stats, totalRequests, level: Math.min(99, Math.floor(totalRequests / 500) + 1) },
      daily,
      bills,
      menu,
      activity: {
        lastAt: last ? last.ts : 0,
        lastModel: last ? last.model : null,
        lastApp: last ? last.app_type : null,
        lastProviderId: last ? last.provider_id : null,
        lastErrorAt: lastError ? lastError.ts : 0,
        lastError: lastError ? lastError.error_message || `HTTP ${lastError.status_code}` : null,
        lastErrorStatus: lastError ? lastError.status_code : 0,
      },
      updatedAt: Date.now(),
    };
  } catch (err) {
    if (db) {
      try { db.close(); } catch (_) {}
    }
    return { ok: false, reason: 'read-failed', message: String(err && err.message || err), apps: [], providers: [], unhealthy: [], stats: emptyStats(), activity: {} };
  }
}

function emptyStats() {
  return { requests: 0, tokens: 0, costUsd: 0, totalRequests: 0, level: 1 };
}

/* ---------------------------- 切换 ---------------------------- */

function readProvider(appType, providerId) {
  const db = openRead();
  try {
    return db
      .prepare('select id, app_type, name, settings_config, meta from providers where id = ? and app_type = ?')
      .get(providerId, appType);
  } finally {
    db.close();
  }
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function backupTo(backupDir, file) {
  if (!fs.existsSync(file)) return null;
  const dest = path.join(backupDir, path.basename(file) + '.' + Date.now() + '.bak');
  fs.copyFileSync(file, dest);
  return dest;
}

function writeAtomic(file, content) {
  ensureDir(path.dirname(file));
  const tmp = `${file}.whale-${process.pid}.tmp`;
  fs.writeFileSync(tmp, content, 'utf8');
  fs.renameSync(tmp, file);
}

function targetsFor(appType, parsed) {
  if (appType === 'claude') {
    return [{ file: path.join(DIRS.claude, 'settings.json'), content: JSON.stringify(parsed, null, 2) + '\n', label: '~/.claude/settings.json' }];
  }
  if (appType === 'codex') {
    const out = [];
    if (parsed && parsed.auth) out.push({ file: path.join(DIRS.codex, 'auth.json'), content: JSON.stringify(parsed.auth, null, 2) + '\n', label: '~/.codex/auth.json' });
    if (typeof parsed.config === 'string') out.push({ file: path.join(DIRS.codex, 'config.toml'), content: parsed.config, label: '~/.codex/config.toml' });
    return out;
  }
  if (appType === 'gemini') {
    return [{ file: path.join(DIRS.gemini, 'settings.json'), content: JSON.stringify(parsed, null, 2) + '\n', label: '~/.gemini/settings.json' }];
  }
  return [];
}

/**
 * 按 cc-switch 的规则切换供应商：
 *   1. 备份现有配置文件 + 数据库
 *   2. 把 settings_config 写进对应 CLI 的配置文件
 *   3. 同步数据库里的 is_current 与 settings.json 的 currentProvider*
 * 注意：写库后 cc-switch 若正在运行，建议重启它以刷新内存状态。
 */
function switchProvider(appType, providerId, backupRoot) {
  const row = readProvider(appType, providerId);
  if (!row) return { ok: false, message: '找不到这个供应商' };

  const parsed = JSON.parse(row.settings_config || '{}');
  const targets = targetsFor(appType, parsed);
  if (!targets.length) return { ok: false, message: `暂不支持 ${appType} 的切换` };

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupDir = path.join(backupRoot, `${stamp}-${appType}`);
  ensureDir(backupDir);

  const backups = [];
  for (const t of targets) {
    const b = backupTo(backupDir, t.file);
    if (b) backups.push(b);
  }
  const dbBackup = backupTo(backupDir, DB_PATH);
  if (dbBackup) backups.push(dbBackup);

  for (const t of targets) writeAtomic(t.file, t.content);

  // 同步数据库
  const db = openWrite();
  try {
    db.prepare('update providers set is_current = 0 where app_type = ?').run(appType);
    db.prepare('update providers set is_current = 1 where app_type = ? and id = ?').run(appType, providerId);
  } finally {
    db.close();
  }

  // 同步 cc-switch 自己的 settings.json
  try {
    const s = JSON.parse(fs.readFileSync(CC_SETTINGS_PATH, 'utf8'));
    const key = 'currentProvider' + appType.charAt(0).toUpperCase() + appType.slice(1);
    if (key in s) s[key] = providerId;
    fs.writeFileSync(CC_SETTINGS_PATH, JSON.stringify(s, null, 2), 'utf8');
  } catch (_) {}

  return {
    ok: true,
    name: row.name,
    appType,
    files: targets.map((t) => t.label),
    backupDir,
    backups: backups.length,
    restartHint: true,
  };
}

/** 给别的模块用：按会话 id 取标题 + 项目名 */
function sessionLabel(id) {
  if (!id) return null;
  const meta = codexThreads().get(id);
  if (!meta) return null;
  let title = meta.title;
  if (!title && meta.rollout) {
    title = rolloutTitleCache.has(id) ? rolloutTitleCache.get(id) : firstUserText(meta.rollout);
    rolloutTitleCache.set(id, title);
  }
  return { title: title || '', project: meta.project || '', cwd: meta.cwd || '' };
}

module.exports = {
  sessionLabel, readState, switchProvider, hasSqlite, CC_EXE, DB_PATH, APP_LABEL, USD_CNY, DIRS,
  __test: { cleanTitle, projectName, firstUserText },
};
