'use strict';

/**
 * 语音合成（Edge 神经网络音色）。
 *
 * Chromium 的 speechSynthesis 在 Windows 上只会用 SAPI 的老音色（Huihui），
 * 听起来像二十年前的导航仪。这里改走 edge-tts（免费的微软在线音色），
 * 拿到的 mp3 交给渲染层播放，音色可选晓晓 / 晓伊 / 晓涵等。
 *
 * 失败（没装 python、没网）时把 ok:false 抛回去，渲染层自动退回 speechSynthesis。
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

/** 音色清单：只放中文女声，外加一个粤语/台湾腔做彩蛋 */
const VOICES = [
  { id: 'zh-CN-XiaoxiaoNeural', name: '晓晓', desc: '温柔知性（推荐）' },
  { id: 'zh-CN-XiaoyiNeural', name: '晓伊', desc: '活泼少女' },
  { id: 'zh-CN-XiaohanNeural', name: '晓涵', desc: '沉稳御姐' },
  { id: 'zh-CN-XiaomengNeural', name: '晓梦', desc: '软糯童声' },
  { id: 'zh-CN-XiaoxuanNeural', name: '晓萱', desc: '干练爽利' },
  { id: 'zh-TW-HsiaoChenNeural', name: '晓臻', desc: '台湾腔' },
  { id: 'zh-HK-HiuMaanNeural', name: '曉曼', desc: '粤语' },
];

const DEFAULT_VOICE = 'zh-CN-XiaoxiaoNeural';
const MAX_CHARS = 160;
const TIMEOUT_MS = 25000;
const KEEP_FILES = 60;

let cacheDir = null;

function init(dir) {
  cacheDir = dir;
  setResolveFile(dir);
  try {
    fs.mkdirSync(cacheDir, { recursive: true });
  } catch (_) {}
}

function fileId(text, voice, rate) {
  return crypto.createHash('sha1').update(`${voice}|${rate}|${text}`).digest('hex').slice(0, 20);
}

function toUrl(absPath) {
  return 'file:///' + absPath.replace(/\\/g, '/').replace(/^\//, '');
}

/**
 * 找能跑 edge_tts 的 python。
 *
 * 坑：PATH 里的 python 很可能是 Python 2.7（这台机器就是），
 * 而 edge-tts 只装在别的 3.x 里。所以不能只 spawn('python')，
 * 要把常见安装位置都扫一遍，挑第一个真能 import 的，并把结果缓存下来。
 */

let resolved = null; // { cmd, args }
let resolveAt = 0;
let resolveFile = null;

function setResolveFile(dir) {
  resolveFile = path.join(dir, 'voice-python.json');
}

function loadCachedPython() {
  if (!resolveFile) return null;
  try {
    const d = JSON.parse(fs.readFileSync(resolveFile, 'utf8'));
    if (d && d.cmd && fs.existsSync(d.cmd)) return { cmd: d.cmd, args: d.args || [] };
  } catch (_) {}
  return null;
}

function saveCachedPython(found) {
  resolved = found;
  resolveAt = Date.now();
  if (!resolveFile || !found) return;
  try {
    fs.writeFileSync(resolveFile, JSON.stringify({ cmd: found.cmd, args: found.args || [], at: Date.now() }, null, 2));
  } catch (_) {}
}

/** 候选解释器：绝对路径扫描 + PATH 上的名字 */
function pythonCandidates() {
  const out = [];
  const push = (cmd, args) => {
    if (!cmd) return;
    if (!out.some((c) => c.cmd === cmd && c.args.join(' ') === args.join(' '))) out.push({ cmd, args });
  };

  if (process.env.WHALE_PYTHON) push(process.env.WHALE_PYTHON, []);

  if (process.platform === 'win32') {
    const home = os.homedir();
    const roots = [
      path.join(home, '.workbuddy', 'binaries', 'python', 'versions'),
      path.join(process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'), 'Programs', 'Python'),
      'C:/Python313',
      'C:/Python312',
      'C:/Python311',
      'C:/Python310',
      'C:/Python39',
      path.join(process.env.PROGRAMFILES || 'C:/Program Files', 'Python313'),
      path.join(process.env.PROGRAMFILES || 'C:/Program Files', 'Python312'),
      path.join(process.env.PROGRAMFILES || 'C:/Program Files', 'Python311'),
    ];
    for (const root of roots) {
      // 注意：版本目录常是符号链接，readdir 的 Dirent.isDirectory() 会返回 false，
      // 所以不能靠它过滤，直接探 python.exe 是否存在
      const direct = path.join(root, 'python.exe');
      if (fs.existsSync(direct)) push(direct, []);
      let names = [];
      try {
        names = fs.readdirSync(root);
      } catch (_) {
        names = [];
      }
      for (const name of names) {
        const exe = path.join(root, name, 'python.exe');
        if (fs.existsSync(exe)) push(exe, []);
      }
    }
    push('py', ['-3']);
    push('python3', []);
    push('python', []);
  } else {
    push('python3', []);
    push('python', []);
  }
  return out;
}

/** 试跑一次：必须是 py3 且能 import edge_tts */
function probe(cmd, args) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(cmd, [...args, '-c', 'import sys, edge_tts; sys.exit(0 if sys.version_info[0] >= 3 else 1)'], {
        windowsHide: true,
        stdio: 'ignore',
      });
    } catch (_) {
      resolve(false);
      return;
    }
    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch (_) {}
      resolve(false);
    }, 6000);
    child.on('error', () => {
      clearTimeout(timer);
      resolve(false);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve(code === 0);
    });
  });
}

async function detect(force) {
  if (!force && resolved) return true;
  if (!force && resolved === false && Date.now() - resolveAt < 60000) return false;

  const cached = loadCachedPython();
  if (cached && (await probe(cached.cmd, cached.args))) {
    saveCachedPython(cached);
    return true;
  }

  for (const c of pythonCandidates()) {
    // eslint-disable-next-line no-await-in-loop
    if (await probe(c.cmd, c.args)) {
      saveCachedPython(c);
      return true;
    }
  }

  resolved = false;
  resolveAt = Date.now();
  return false;
}

function prune() {
  try {
    const files = fs
      .readdirSync(cacheDir)
      .filter((f) => f.endsWith('.mp3'))
      .map((f) => {
        const p = path.join(cacheDir, f);
        return { p, t: fs.statSync(p).mtimeMs };
      })
      .sort((a, b) => b.t - a.t);
    for (const f of files.slice(KEEP_FILES)) {
      try {
        fs.unlinkSync(f.p);
      } catch (_) {}
    }
  } catch (_) {}
}

function rateArg(rate) {
  // rate 是倍速（1.05 = +5%），edge-tts 要百分比字符串
  const pct = Math.round((Number(rate) || 1) * 100) - 100;
  const sign = pct >= 0 ? '+' : '';
  return `--rate=${sign}${pct}%`;
}

/**
 * 合成一句话。
 * @returns {Promise<{ok:boolean, url?:string, file?:string, cached?:boolean, reason?:string}>}
 */
async function say(text, opts = {}) {
  const clean = String(text || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_CHARS);
  if (!clean) return { ok: false, reason: 'empty' };
  if (!cacheDir) return { ok: false, reason: 'not-init' };

  const voice = opts.voice || DEFAULT_VOICE;
  const rate = opts.rate || 1;

  const id = fileId(clean, voice, rate);
  const file = path.join(cacheDir, `${id}.mp3`);
  if (fs.existsSync(file) && fs.statSync(file).size > 800) {
    return { ok: true, url: toUrl(file), file, cached: true };
  }

  if (!(await detect())) return { ok: false, reason: 'no-edge-tts' };

  const args = ['-m', 'edge_tts', '--voice', voice, rateArg(rate), '--text', clean, '--write-media', file];

  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(resolved.cmd, [...(resolved.args || []), ...args], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    } catch (err) {
      resolve({ ok: false, reason: String(err && err.message) });
      return;
    }

    let err = '';
    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch (_) {}
      resolve({ ok: false, reason: 'timeout' });
    }, TIMEOUT_MS);

    child.stderr.on('data', (b) => {
      err += b.toString();
    });
    child.on('error', (e) => {
      clearTimeout(timer);
      resolve({ ok: false, reason: String(e && e.message) });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      let size = 0;
      try {
        size = fs.statSync(file).size;
      } catch (_) {}
      if (code === 0 && size > 800) {
        prune();
        resolve({ ok: true, url: toUrl(file), file, cached: false });
      } else {
        try {
          fs.unlinkSync(file);
        } catch (_) {}
        resolve({ ok: false, reason: (err || '').trim().slice(0, 200) || `exit ${code}` });
      }
    });
  });
}

function list() {
  return VOICES;
}

module.exports = { init, say, list, detect, VOICES, DEFAULT_VOICE };
